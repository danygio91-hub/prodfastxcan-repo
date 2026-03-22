
'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
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
 */
export async function getOpenPurchaseOrdersForMaterial(materialCode: string): Promise<PurchaseOrder[]> {
    const snapshot = await adminDb.collection("purchaseOrders").where("materialCode", "==", materialCode).get();
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
  const materialRef = adminDb.collection("rawMaterials").doc(materialId);
  
  try {
      const finalMaterialState = await adminDb.runTransaction(async (transaction) => {
          const docSnap = await transaction.get(materialRef);
          if (!docSnap.exists) throw new Error('Materia prima non trovata.');

          const material = docSnap.data() as RawMaterial;
          const existingBatches = material.batches || [];
          
          let tareWeight = 0;
          let validPackagingId: string | undefined = undefined;

          if (packagingId && packagingId !== 'none') {
            const packagingRef = adminDb.collection('packaging').doc(packagingId);
            const packagingSnap = await transaction.get(packagingRef);
            if (packagingSnap.exists) {
              tareWeight = (packagingSnap.data() as any).weightKg || 0;
              validPackagingId = packagingId;
            }
          }
          
          let netWeightKg: number;
          let unitsToAdd: number;

          if (unit === 'kg') {
              netWeightKg = quantity;
              if (material.unitOfMeasure === 'kg') {
                  unitsToAdd = netWeightKg;
              } else {
                  if (!material.conversionFactor || material.conversionFactor <= 0) {
                      throw new Error(`Impossibile convertire KG in ${material.unitOfMeasure} senza un fattore di conversione.`);
                  }
                  unitsToAdd = netWeightKg / material.conversionFactor;
              }
          } else { 
              unitsToAdd = quantity;
              if (material.unitOfMeasure === 'kg') {
                  netWeightKg = unitsToAdd;
              } else if (material.conversionFactor && material.conversionFactor > 0) {
                  netWeightKg = unitsToAdd * material.conversionFactor;
              } else if (material.unitOfMeasure === 'mt' && material.rapportoKgMt) {
                  netWeightKg = unitsToAdd * material.rapportoKgMt;
              } else {
                  netWeightKg = 0; 
              }
          }

          if (purchaseOrderId) {
              const poRef = adminDb.collection("purchaseOrders").doc(purchaseOrderId);
              const poSnap = await transaction.get(poRef);
              if (poSnap.exists) {
                  const poData = poSnap.data() as PurchaseOrder;
                  const newReceivedTotal = (poData.receivedQuantity || 0) + unitsToAdd;
                  const isFullyReceived = newReceivedTotal >= poData.quantity - 0.001;
                  transaction.update(poRef, {
                      receivedQuantity: newReceivedTotal,
                      status: isFullyReceived ? 'received' : 'partially_received'
                  });
              }
          }

          // Create batch object carefully avoiding undefined
          const newBatch: any = {
            id: `batch-load-${Date.now()}`,
            date: new Date(date).toISOString(),
            ddt: ddt || 'CARICO_RAPIDO',
            netQuantity: unitsToAdd, 
            tareWeight: tareWeight,
            grossWeight: netWeightKg + tareWeight,
            lotto: lotto || null,
          };
          
          if (purchaseOrderId) newBatch.purchaseOrderId = purchaseOrderId;
          if (validPackagingId) newBatch.packagingId = validPackagingId;
          
          const newStockUnits = (material.currentStockUnits || 0) + unitsToAdd;
          const newWeightKg = (material.currentWeightKg || 0) + netWeightKg;
          
          transaction.update(materialRef, { 
              batches: admin.firestore.FieldValue.arrayUnion(newBatch),
              currentStockUnits: newStockUnits,
              currentWeightKg: newWeightKg,
          });

          return { ...material, batches: [...existingBatches, newBatch], currentStockUnits: newStockUnits, currentWeightKg: newWeightKg };
      });
      
      revalidatePath('/admin/raw-material-management');
      revalidatePath('/admin/purchase-orders');
      return { success: true, message: 'Lotto aggiunto con successo.', updatedMaterial: finalMaterialState as RawMaterial };
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
    if (!validated.success) return { success: false, message: 'Dati non validi.' };
    
    try {
        const reportData: Omit<NonConformityReport, 'id'> = {
            ...validated.data,
            reportDate: new Date().toISOString(),
            status: 'pending',
        }
        await adminDb.collection("nonConformityReports").add(reportData);
        revalidatePath('/admin/non-conformity-reports');
        return { success: true, message: 'Segnalazione inviata.' };
    } catch (error) {
        return { success: false, message: "Errore durante il salvataggio." };
    }
}

export async function getPackagingItems(): Promise<Packaging[]> {
  const snap = await adminDb.collection('packaging').orderBy("name").get();
  return snap.docs.map(doc => doc.data() as Packaging);
}
