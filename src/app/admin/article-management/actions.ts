
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Article, BillOfMaterialsItem, JobOrder } from '@/lib/mock-data';
import * as z from 'zod';

const bomItemSchema = z.object({
  component: z.string().min(1, "Selezionare un componente valido."),
  unit: z.string().min(1, "L'unità di misura è obbligatoria."),
  quantity: z.coerce.number().positive("La quantità deve essere positiva."),
  size: z.string().optional(),
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
  const docRef = doc(db, 'articles', docId);
  const existingArticleSnap = await getDoc(docRef);

  const articleData: Article = {
    id: docId,
    code,
    // Filter out empty or invalid components that might come from the UI or import
    billOfMaterials: (billOfMaterials || []).filter(item => item.component && item.component.trim() !== '' && item.quantity > 0),
  };

  try {
    // setDoc without merge will create or completely overwrite the document.
    // This is the desired behavior for BOM management: an import replaces the old BOM.
    await setDoc(docRef, articleData);
    revalidatePath('/admin/article-management');
    return { success: true, message: `Articolo ${existingArticleSnap.exists() ? 'aggiornato' : 'creato'} con successo.` };
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
