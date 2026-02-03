

'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, setDoc, deleteDoc, getDoc, query, where, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Article, BillOfMaterialsItem, JobOrder, JobBillOfMaterialsItem } from '@/lib/mock-data';
import * as z from 'zod';

const bomItemSchema = z.object({
  component: z.string().min(1, "Selezionare un componente valido."),
  unit: z.enum(['n', 'mt', 'kg']),
  quantity: z.coerce.number().positive("La quantità deve essere positiva."),
  lunghezzaTaglioMm: z.coerce.number().optional(),
  note: z.string().optional(),
});

const articleSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(3, "Il codice articolo è obbligatorio."),
  billOfMaterials: z.array(bomItemSchema).optional().default([]),
});

export async function getArticles(): Promise<Article[]> {
  // First, get articles already defined in the 'articles' collection
  const articlesCol = collection(db, 'articles');
  const articlesSnapshot = await getDocs(articlesCol);
  const existingArticles = new Map(articlesSnapshot.docs.map(d => [d.data().code, { ...d.data(), id: d.id } as Article]));

  // Then, find all unique article codes from existing job orders
  const jobsCol = collection(db, 'jobOrders');
  const jobsSnapshot = await getDocs(jobsCol);
  const jobs = jobsSnapshot.docs.map(d => d.data() as JobOrder);

  const articleCodesFromJobs = new Set(jobs.map(job => job.details));

  // Merge the two lists, giving priority to already defined articles
  articleCodesFromJobs.forEach(code => {
    if (!existingArticles.has(code)) {
      existingArticles.set(code, {
        id: code, // Use code as ID for jobs that don't have a formal article entry yet
        code: code,
        billOfMaterials: [],
      });
    }
  });

  const sortedArticles = Array.from(existingArticles.values()).sort((a, b) => a.code.localeCompare(b.code));
  
  return sortedArticles;
}

export async function saveArticle(data: z.infer<typeof articleSchema>): Promise<{ success: boolean; message: string; }> {
  const validatedFields = articleSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: 'Dati non validi.' };
  }

  const { code, billOfMaterials } = validatedFields.data;

  // --- Server-side validation of components ---
  const materialsSnapshot = await getDocs(collection(db, "rawMaterials"));
  const materialCodeSet = new Set(materialsSnapshot.docs.map(doc => doc.data().code));
  
  const invalidComponents = (billOfMaterials || [])
    .filter(item => item.component && item.component.trim() !== '')
    .filter(item => !materialCodeSet.has(item.component));

  if (invalidComponents.length > 0) {
    const invalidCodes = invalidComponents.map(c => c.component).join(', ');
    return {
      success: false,
      message: `I seguenti componenti non esistono: ${invalidCodes}. Aggiungili prima di creare la distinta base.`
    };
  }
  // --- End Validation ---
  
  const docId = code;
  const articleRef = doc(db, 'articles', docId);

  const newBOM = (billOfMaterials || []).filter(item => item.component && item.component.trim() !== '' && item.quantity > 0);

  const articleData: Article = {
    id: docId,
    code,
    billOfMaterials: newBOM,
  };

  try {
    const batch = writeBatch(db);
    
    // 1. Save the article itself
    batch.set(articleRef, articleData);
    
    // 2. Find and update associated job orders
    const jobsQuery = query(collection(db, "jobOrders"), where("details", "==", code));
    const jobsSnapshot = await getDocs(jobsQuery);
    
    let updatedJobsCount = 0;
    if (!jobsSnapshot.empty) {
        const newJobBOM: JobBillOfMaterialsItem[] = newBOM.map(item => ({
            ...item,
            status: 'pending', // Reset status on update
            isFromTemplate: true,
        }));

        jobsSnapshot.forEach(jobDoc => {
            // Update all jobs, regardless of status, as per user's implicit request
            batch.update(jobDoc.ref, { billOfMaterials: newJobBOM });
            updatedJobsCount++;
        });
    }

    await batch.commit();

    revalidatePath('/admin/article-management');
    revalidatePath('/admin/production-console'); // Revalidate console to reflect changes
    
    let message = `Articolo ${code} salvato con successo.`;
    if (updatedJobsCount > 0) {
        message += ` ${updatedJobsCount} commesse associate sono state aggiornate con la nuova distinta base.`;
    }

    return { success: true, message: message };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore sconosciuto.";
    return { success: false, message: errorMessage };
  }
}

export async function deleteArticle(id: string): Promise<{ success: boolean; message: string; }> {
  try {
    await deleteDoc(doc(db, "articles", id));
    revalidatePath('/admin/article-management');
    return { success: true, message: 'Articolo eliminato con successo.' };
  } catch (error) {
    return { success: false, message: 'Errore durante l\'eliminazione dell\'articolo.' };
  }
}
