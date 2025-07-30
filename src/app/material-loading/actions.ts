

'use server';

import { collection, doc, getDoc, getDocs, query, where, runTransaction, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, NonConformityReport } from '@/lib/mock-data';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';

export async function getRawMaterialByCode(code: string): Promise<RawMaterial | { error: string; title?: string }> {
  const materialsRef = collection(db, "rawMaterials");
  const normalizedCode = code.trim().toLowerCase();
  
  if (!normalizedCode) {
     return {
      error: `Il codice inserito è vuoto.`,
      title: 'Codice Vuoto',
    };
  }
  
  const q = query(materialsRef, where("code_normalized", "==", normalizedCode));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) {
    return {
      error: `Materia prima con codice "${code}" non trovata. Verificare il codice o aggiungerla dall'area amministrazione.`,
      title: 'Materiale non Trovato',
    };
  }

  const docSnap = querySnapshot.docs[0];
  const material = docSnap.data() as RawMaterial;
  material.id = docSnap.id;

  return JSON.parse(JSON.stringify(material));
}

const batchFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  lotto: z.string().min(1, "Il lotto è obbligatorio."),
  date: z.string().min(1, "La data è obbligatoria."),
  ddt: z.string().optional(),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  unit: z.enum(['n', 'kg', 'mt']),
});

export async function addBatchToRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; updatedMaterial?: RawMaterial; errors?: any }> {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = batchFormSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return { success: false, message: 'Dati del lotto non validi.', errors: validatedFields.error.flatten().fieldErrors };
  }
  
  const { materialId, date, ddt, quantity, lotto, unit } = validatedFields.data;
  
  const materialRef = doc(db, "rawMaterials", materialId);
  
  try {
      const finalMaterialState = await runTransaction(db, async (transaction) => {
          const docSnap = await transaction.get(materialRef);
          if (!docSnap.exists()) {
            throw new Error('Materia prima non trovata.');
          }

          const material = docSnap.data() as RawMaterial;
          
          const newBatch: RawMaterialBatch = {
            id: `batch-${Date.now()}`,
            date: new Date(date).toISOString(),
            ddt: ddt || 'CARICO_RAPIDO',
            quantity: quantity,
            lotto: lotto || undefined,
          };

          const updatedBatches = [...existingBatches, newBatch];
          
          const currentStockUnits = material.currentStockUnits || 0;
          
          let unitsToAdd = 0;
          if (unit === 'kg') {
              // If loading by KG, we can only add units if there is a conversion factor.
              // Otherwise, we only add weight.
              unitsToAdd = material.conversionFactor && material.conversionFactor > 0 ? Math.round(quantity / material.conversionFactor) : 0;
          } else { // 'n' or 'mt'
              unitsToAdd = quantity;
          }
          const newStockUnits = currentStockUnits + unitsToAdd;
          
          let weightKgToAdd = 0;
          if (unit === 'kg') {
              weightKgToAdd = quantity;
          } else { // 'n' or 'mt'
              // If loading by units (n or mt), we can only add weight if there is a conversion factor.
              weightKgToAdd = material.conversionFactor && material.conversionFactor > 0 ? quantity * material.conversionFactor : 0;
          }
          const newWeightKg = (material.currentWeightKg || 0) + weightKgToAdd;

          transaction.update(materialRef, { 
              batches: updatedBatches,
              currentStockUnits: newStockUnits,
              currentWeightKg: newWeightKg,
          });

          return { 
              ...material, 
              batches: updatedBatches, 
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
        const reportData: Omit<NonConformityReport, 'id' | 'reportDate'> = {
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
