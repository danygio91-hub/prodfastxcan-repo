
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Article, BillOfMaterialsItem, JobOrder } from '@/lib/mock-data';
import * as z from 'zod';

const bomItemSchema = z.object({
  component: z.string().min(1, "Il nome del componente è obbligatorio."),
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
        id: code,
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

  const { id, code, billOfMaterials } = validatedFields.data;
  
  // Use the article code as the primary ID to ensure uniqueness.
  // This is crucial for the "create or update" logic.
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
    // setDoc with merge:true will create the document if it doesn't exist,
    // or update it if it does. This handles both creating and updating articles.
    await setDoc(docRef, articleData, { merge: true });
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
