
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
  batchId: z.string().optional(), // Not used for new batches, but good for consistency
  lotto: z.string().optional(),
  date: z.string().min(1, "La data è obbligatoria."),
  ddt: z.string().min(1, "Il DDT è obbligatorio."),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
});

export async function addBatchToRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; updatedMaterial?: RawMaterial; }> {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = batchFormSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return { success: false, message: 'Dati del lotto non validi.', errors: validatedFields.error.flatten().fieldErrors };
  }
  
  const { materialId, date, ddt, quantity, lotto } = validatedFields.data;
  
  const materialRef = doc(db, "rawMaterials", materialId);
  
  try {
      const finalMaterialState = await runTransaction(db, async (transaction) => {
          const docSnap = await transaction.get(materialRef);
          if (!docSnap.exists()) {
            throw new Error('Materia prima non trovata.');
          }

          const material = docSnap.data() as RawMaterial;
          const existingBatches = material.batches || [];
          
          const newBatch: RawMaterialBatch = {
            id: `batch-${Date.now()}`,
            date: new Date(date).toISOString(),
            ddt,
            quantity,
            lotto: lotto || undefined,
          };

          const updatedBatches = [...existingBatches, newBatch];
          
          const currentStockUnits = material.currentStockUnits || 0;
          const currentWeightKg = material.currentWeightKg || 0;
          const newStockUnits = currentStockUnits + quantity;
          
          let newWeightKg = currentWeightKg;
          if (material.unitOfMeasure === 'kg') {
              newWeightKg = newStockUnits;
          } else if (material.conversionFactor && material.conversionFactor > 0) {
              newWeightKg = newStockUnits * material.conversionFactor;
          }

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
