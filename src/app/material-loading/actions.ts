
'use server';

import { collection, doc, runTransaction, getDocs, query, orderBy, addDoc, Timestamp, getDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, NonConformityReport, Packaging, PurchaseOrder } from '@/lib/mock-data';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';

const batchFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  lotto: z.string().min(1, "Il lotto è obbligatorio."),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Data non valida"}),
  ddt: z.string().optional(),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  unit: z.enum(['n', 'kg', 'mt']),
  packagingId: z.string().optional(),
  purchaseOrderId: z.string().optional(),
});

/**
 * Fetches open purchase orders for a specific material code.
 * Optimized to avoid composite index requirement by filtering in memory.
 */
export async function getOpenPurchaseOrdersForMaterial(materialCode: string): Promise<PurchaseOrder[]> {
    const col = collection(db, "purchaseOrders");
    
    // We fetch by material code (which has a standard index)
    // and handle status filtering and ordering in memory to avoid "Query requires an index" error.
    const q = firestoreQuery(col, 
        where("materialCode", "==", materialCode)
    );
    
    const snapshot = await getDocs(q);
    const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as PurchaseOrder);
    
    return orders
        .filter(o => o.status === 'pending' || o.status === 'partially_received')
        .sort((a, b) => a.expectedDeliveryDate.localeCompare(b.expectedDeliveryDate));
}

export async function addBatchToRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; updatedMaterial?: RawMaterial; errors?: any }> {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = batchFormSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return { success: false, message: 'Dati del lotto non validi.', errors: validatedFields.error.flatten().fieldErrors };
  }
  
  const { materialId, date, ddt, quantity, lotto, packagingId, unit, purchaseOrderId } = validatedFields.data;
  
  const materialRef = doc(db, "rawMaterials", materialId);
  
  try {
      const finalMaterialState = await runTransaction(db, async (transaction) => {
          const docSnap = await transaction.get(materialRef);
          if (!docSnap.exists()) {
            throw new Error('Materia prima non trovata.');
          }

          const material = docSnap.data() as RawMaterial;
          const existingBatches = material.batches || [];
          
          let tareWeight = 0;
          let validPackagingId: string | undefined = undefined;

          if (packagingId && packagingId !== 'none') {
            const packagingRef = doc(db, 'packaging', packagingId);
            const packagingSnap = await transaction.get(packagingRef);
            if (packagingSnap.exists()) {
              tareWeight = packagingSnap.data().weightKg || 0;
              validPackagingId = packagingId;
            }
          }
          
          let netWeightKg: number;
          let unitsToAdd: number;
          const netQuantityInput = quantity;

          if (unit === 'kg') {
              netWeightKg = netQuantityInput;
              if (material.unitOfMeasure === 'kg') {
                  unitsToAdd = netWeightKg;
              } else {
                  if (!material.conversionFactor || material.conversionFactor <= 0) {
                      throw new Error(`Impossibile convertire KG in ${material.unitOfMeasure} senza un fattore di conversione per ${material.code}.`);
                  }
                  unitsToAdd = netWeightKg / material.conversionFactor;
              }
          } else { 
              unitsToAdd = netQuantityInput;
              if (material.unitOfMeasure === 'kg') {
                  netWeightKg = unitsToAdd;
              } else if (material.conversionFactor && material.conversionFactor > 0) {
                  netWeightKg = unitsToAdd * material.conversionFactor;
              } else {
                  netWeightKg = 0; 
              }
          }

          // --- Purchase Order Update Logic ---
          if (purchaseOrderId) {
              const poRef = doc(db, "purchaseOrders", purchaseOrderId);
              const poSnap = await transaction.get(poRef);
              if (poSnap.exists()) {
                  const poData = poSnap.data() as PurchaseOrder;
                  const currentReceived = poData.receivedQuantity || 0;
                  // Quantity added is always in the primary UOM of the material (which should match PO)
                  const newReceivedTotal = currentReceived + unitsToAdd;
                  
                  const isFullyReceived = newReceivedTotal >= poData.quantity - 0.001; // Tiny margin for floating point
                  
                  transaction.update(poRef, {
                      receivedQuantity: newReceivedTotal,
                      status: isFullyReceived ? 'received' : 'partially_received'
                  });
              }
          }

          const newBatch: RawMaterialBatch = {
            id: `batch-${Date.now()}`,
            date: new Date(date).toISOString(),
            ddt: ddt || 'CARICO_RAPIDO',
            netQuantity: unitsToAdd, 
            tareWeight: tareWeight,
            grossWeight: netWeightKg + tareWeight,
            lotto: lotto || null,
            purchaseOrderId: purchaseOrderId || undefined,
          };
          
          if (validPackagingId) {
            newBatch.packagingId = validPackagingId;
          }

          const newStockUnits = (material.currentStockUnits || 0) + unitsToAdd;
          const newWeightKg = (material.currentWeightKg || 0) + netWeightKg;
          
          transaction.update(materialRef, { 
              batches: [...existingBatches, newBatch],
              currentStockUnits: newStockUnits,
              currentWeightKg: newWeightKg,
          });

          return { 
              ...material, 
              batches: [...existingBatches, newBatch], 
              currentStockUnits: newStockUnits, 
              currentWeightKg: newWeightKg,
          };
      });
      
      revalidatePath('/admin/raw-material-management');
      revalidatePath('/admin/purchase-orders');
      revalidatePath('/admin/batch-management');
      
      return { success: true, message: 'Lotto aggiunto con successo. Stock e Ordine Fornitore aggiornati.', updatedMaterial: finalMaterialState as RawMaterial };

  } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "Errore sconosciuto." };
  }
}


const ncReportSchema = z.object({
    materialId: z.string(),
    materialCode: z.string(),
    lotto: z.string(),
    quantity: z.coerce.number().positive("La quantità è obbligatoria."),
    reason: z.string(),
    notes: z.string().optional(),
    operatorId: z.string(),
    operatorName: z.string(),
});

export async function reportNonConformity(data: z.infer<typeof ncReportSchema>): Promise<{ success: boolean; message: string; }> {
    const validated = ncReportSchema.safeParse(data);
    if (!validated.success) {
        return { success: false, message: 'Dati per la segnalazione non validi.' };
    }
    
    try {
        const ncCollectionRef = collection(db, "nonConformityReports");
        const reportData: Omit<NonConformityReport, 'id'> = {
            ...validated.data,
            reportDate: Timestamp.now(),
            status: 'pending',
        }
        await addDoc(ncCollectionRef, reportData);
        
        revalidatePath('/admin/non-conformity-reports');
        return { success: true, message: 'Segnalazione inviata con successo.' };
    } catch (error) {
        return { success: false, message: "Impossibile salvare la segnalazione di non conformità." };
    }
}


export async function getPackagingItems(): Promise<Packaging[]> {
  const packagingCol = collection(db, 'packaging');
  const q = query(packagingCol, orderBy("name"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as Packaging);
}

function firestoreQuery(...args: any[]) {
    return (firestoreQuery as any).originalQuery(...args);
}
(firestoreQuery as any).originalQuery = firestoreQuery;
