
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Article, ArticlePhaseTime } from '@/lib/mock-data';
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
  const articles = articlesSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Article));
  return articles.sort((a, b) => a.code.localeCompare(b.code));
}

export async function saveArticle(data: z.infer<typeof articleSchema>): Promise<{ success: boolean; message: string; }> {
  const validatedFields = articleSchema.safeParse(data);
  if (!validatedFields.success) return { success: false, message: 'Dati non validi.' };

  const { code, billOfMaterials } = validatedFields.data;
  
  const materialsSnap = await getDocs(collection(db, "rawMaterials"));
  const materialCodes = new Set(materialsSnap.docs.map(doc => doc.data().code.toUpperCase()));
  
  const invalid = billOfMaterials.filter(item => item.component && !materialCodes.has(item.component.toUpperCase()));
  if (invalid.length > 0) {
    return { success: false, message: `Componenti non trovati in anagrafica: ${invalid.map(i => i.component).join(', ')}` };
  }

  const docId = code.toUpperCase();
  const articleRef = doc(db, 'articles', docId);
  const articleData: Partial<Article> = { id: docId, code: docId, billOfMaterials };

  try {
    await setDoc(articleRef, articleData, { merge: true });
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
    
    const existingArticlesSnap = await getDocs(collection(db, "articles"));
    const existingCodes = new Set(existingArticlesSnap.docs.map(doc => doc.data().code.toUpperCase()));

    const newArticles: Omit<Article, 'id'>[] = [];
    const updatedArticles: Omit<Article, 'id'>[] = [];
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
        
        if (errors.length > 0) {
            invalidArticles.push({ code: art.code || 'N/D', errors });
        } else {
            if (existingCodes.has(art.code.toUpperCase())) {
                updatedArticles.push(art);
            } else {
                newArticles.push(art);
            }
        }
    }
    return { success: true, newArticles, updatedArticles, invalidArticles };
}

export async function bulkSaveArticles(articles: Omit<Article, 'id'>[]) {
    const batch = writeBatch(db);
    articles.forEach(art => {
        const id = art.code.toUpperCase();
        batch.set(doc(db, 'articles', id), { ...art, id, code: id }, { merge: true });
    });
    await batch.commit();
    revalidatePath('/admin/article-management');
    return { success: true, message: `${articles.length} articoli elaborati.` };
}

export async function saveArticlePhaseTimes(articleId: string, phaseTimes: Record<string, ArticlePhaseTime>, workCycleId: string) {
    const articleRef = doc(db, 'articles', articleId);
    try {
        await setDoc(articleRef, { phaseTimes, workCycleId }, { merge: true });
        revalidatePath('/admin/article-management');
        return { success: true, message: 'Tempi e Ciclo aggiornati con successo.' };
    } catch (e) {
        return { success: false, message: 'Errore durante il salvataggio.' };
    }
}
