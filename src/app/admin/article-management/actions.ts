'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Article, JobBillOfMaterialsItem } from '@/lib/mock-data';
import * as z from 'zod';

const bomItemSchema = z.object({
  component: z.string().min(1, "Componente obbligatorio."),
  unit: z.enum(['n', 'mt', 'kg']),
  quantity: z.coerce.number().positive("Quantità obbligatoria."),
  lunghezzaTaglioMm: z.coerce.number().optional(),
  note: z.string().optional(),
});

const articleSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(3, "Il codice articolo è obbligatorio."),
  billOfMaterials: z.array(bomItemSchema).optional().default([]),
});

export async function getArticles(): Promise<Article[]> {
  const articlesCol = collection(db, 'articles');
  const articlesSnapshot = await getDocs(articlesCol);
  
  // Return ONLY the articles present in the dedicated collection.
  // We no longer automatically pull in codes from existing jobs to ensure data quality.
  const articles = articlesSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Article));
  return articles.sort((a, b) => a.code.localeCompare(b.code));
}

export async function saveArticle(data: z.infer<typeof articleSchema>): Promise<{ success: boolean; message: string; }> {
  const validatedFields = articleSchema.safeParse(data);
  if (!validatedFields.success) return { success: false, message: 'Dati non validi.' };

  const { code, billOfMaterials } = validatedFields.data;
  
  // Validation: Check if components exist
  const materialsSnap = await getDocs(collection(db, "rawMaterials"));
  const materialCodes = new Set(materialsSnap.docs.map(doc => doc.data().code.toUpperCase()));
  
  const invalid = billOfMaterials.filter(item => item.component && !materialCodes.has(item.component.toUpperCase()));
  if (invalid.length > 0) {
    return { success: false, message: `Componenti non trovati in anagrafica: ${invalid.map(i => i.component).join(', ')}` };
  }

  const docId = code.toUpperCase();
  const articleRef = doc(db, 'articles', docId);
  const articleData: Article = { id: docId, code: docId, billOfMaterials };

  try {
    await setDoc(articleRef, articleData);
    revalidatePath('/admin/article-management');
    return { success: true, message: `Articolo ${docId} salvato.` };
  } catch (error) {
    return { success: false, message: "Errore durante il salvataggio." };
  }
}

export async function deleteArticle(id: string): Promise<{ success: boolean; message: string; }> {
  await deleteDoc(doc(db, "articles", id));
  revalidatePath('/admin/article-management');
  return { success: true, message: 'Articolo eliminato.' };
}

export async function validateArticlesImport(articles: Omit<Article, 'id'>[]) {
    const materialsSnap = await getDocs(collection(db, "rawMaterials"));
    const validCodes = new Set(materialsSnap.docs.map(doc => doc.data().code.toUpperCase()));
    const validArticles: Omit<Article, 'id'>[] = [];
    const invalidArticles: { code: string; errors: string[] }[] = [];

    for (const art of articles) {
        const errors: string[] = [];
        if (!art.code || art.code.length < 3) errors.push("Codice troppo corto.");
        if (!art.billOfMaterials || art.billOfMaterials.length === 0) errors.push("Distinta vuota.");
        else {
            art.billOfMaterials.forEach((item, idx) => {
                if (!validCodes.has(item.component.toUpperCase())) errors.push(`Componente riga ${idx+1} non in anagrafica: ${item.component}`);
            });
        }
        if (errors.length > 0) invalidArticles.push({ code: art.code || 'N/D', errors });
        else validArticles.push(art);
    }
    return { success: true, validArticles, invalidArticles };
}

export async function bulkSaveArticles(articles: Omit<Article, 'id'>[]) {
    const batch = writeBatch(db);
    articles.forEach(art => {
        const id = art.code.toUpperCase();
        batch.set(doc(db, 'articles', id), { ...art, id, code: id });
    });
    await batch.commit();
    revalidatePath('/admin/article-management');
    return { success: true, message: `${articles.length} articoli importati.` };
}
