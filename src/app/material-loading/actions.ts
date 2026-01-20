

'use server';

import { collection, doc, getDoc, getDocs, query, where, runTransaction, addDoc, Timestamp, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, NonConformityReport, Packaging } from '@/lib/mock-data';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';
import { format } from 'date-fns';

const batchFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  lotto: z.string().min(1, "Il lotto è obbligatorio."),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Data non valida"}),
  ddt: z.string().optional(),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  unit: z.enum(['n', 'kg', 'mt']),
  packagingId: z.string().optional(),
});

export async function addBatchToRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; updatedMaterial?: RawMaterial; errors?: any }> {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = batchFormSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return { success: false, message: 'Dati del lotto non validi.', errors: validatedFields.error.flatten().fieldErrors };
  }
  
  const { materialId, date, ddt, quantity, lotto, packagingId, unit } = validatedFields.data;
  
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
          if (packagingId && packagingId !== 'none') {
            const packagingRef = doc(db, 'packaging', packagingId);
            const packagingSnap = await transaction.get(packagingRef);
            if (packagingSnap.exists()) {
              tareWeight = packagingSnap.data().weightKg || 0;
            }
          }
          
          let netWeight: number;
          let grossWeight: number;
          let unitsToAdd: number;

          if (unit === 'kg') {
              grossWeight = quantity; // Input is gross weight
              netWeight = grossWeight - tareWeight;
              if (netWeight < 0) {
                throw new Error("Il peso netto è negativo. Controllare peso lordo e tara.");
              }
              // Calculate units from net weight
              if (material.unitOfMeasure === 'kg') {
                  unitsToAdd = netWeight;
              } else if (material.conversionFactor && material.conversionFactor > 0) {
                  unitsToAdd = netWeight / material.conversionFactor;
              } else {
                  unitsToAdd = 0; // Cannot determine units if no conversion factor
              }
          } else { // unit is 'n' or 'mt'
              unitsToAdd = quantity; // Input is net units
              // Calculate weight from units
              if (material.unitOfMeasure === 'kg') {
                netWeight = unitsToAdd;
              } else if (material.conversionFactor && material.conversionFactor > 0) {
                netWeight = unitsToAdd * material.conversionFactor;
              } else {
                netWeight = 0;
              }
              grossWeight = netWeight + tareWeight;
          }

          const newBatch: RawMaterialBatch = {
            id: `batch-${Date.now()}`,
            date: new Date(date).toISOString(),
            ddt: ddt || 'CARICO_RAPIDO',
            netQuantity: unitsToAdd,
            tareWeight: tareWeight,
            grossWeight: grossWeight,
            packagingId: packagingId || null,
            lotto: lotto || null,
          };

          const newStockUnits = (material.currentStockUnits || 0) + unitsToAdd;
          const newWeightKg = (material.currentWeightKg || 0) + netWeight;
          
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
              stock: newStockUnits
          };
      });
      
      revalidatePath('/admin/raw-material-management');
      revalidatePath('/raw-material-scan');
      return { success: true, message: 'Lotto aggiunto con successo. Stock aggiornato.', updatedMaterial: finalMaterialState };

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
            reportDate: Timestamp.now() as any, // Cast to any to satisfy type temporarily
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
