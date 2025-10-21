
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Article, BillOfMaterialsItem } from '@/lib/mock-data';
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
  const articlesCol = collection(db, 'articles');
  const snapshot = await getDocs(articlesCol);
  if (snapshot.empty) {
    return [];
  }
  return snapshot.docs.map(d => ({...d.data(), id: d.id }) as Article);
}

export async function saveArticle(data: z.infer<typeof articleSchema>): Promise<{ success: boolean; message: string; }> {
  const validatedFields = articleSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: 'Dati non validi.' };
  }

  const { id, code, billOfMaterials } = validatedFields.data;
  const docId = id || code;
  const docRef = doc(db, 'articles', docId);

  const articleData: Article = {
    id: docId,
    code,
    billOfMaterials,
  };

  try {
    await setDoc(docRef, articleData, { merge: true });
    revalidatePath('/admin/article-management');
    return { success: true, message: `Articolo ${id ? 'aggiornato' : 'creato'} con successo.` };
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
