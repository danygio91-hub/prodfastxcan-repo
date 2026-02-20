
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
  const articlesCol = collection(db, 'articles');
  const articlesSnapshot = await getDocs(articlesCol);
  const existingArticles = new Map(articlesSnapshot.docs.map(d => [d.data().code, { ...d.data(), id: d.id } as Article]));

  const jobsCol = collection(db, 'jobOrders');
  const jobsSnapshot = await getDocs(jobsCol);
  const jobs = jobsSnapshot.docs.map(d => d.data() as JobOrder);

  const articleCodesFromJobs = new Set(jobs.map(job => job.details));

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

/**
 * Validates a list of articles for import.
 * Returns detailed info about valid and invalid items.
 */
export async function validateArticlesImport(articlesToImport: Omit<Article, 'id'>[]): Promise<{
    success: boolean;
    validArticles: Omit<Article, 'id'>[];
    invalidArticles: { code: string; errors: string[] }[];
}> {
    try {
        const materialsSnapshot = await getDocs(collection(db, "rawMaterials"));
        const validMaterialCodes = new Set(materialsSnapshot.docs.map(doc => doc.data().code));
        
        const validArticles: Omit<Article, 'id'>[] = [];
        const invalidArticles: { code: string; errors: string[] }[] = [];

        for (const article of articlesToImport) {
            const errors: string[] = [];
            
            if (!article.code || article.code.length < 3) {
                errors.push("Codice articolo mancante o troppo corto.");
            }

            if (!article.billOfMaterials || article.billOfMaterials.length === 0) {
                errors.push("Distinta base vuota.");
            } else {
                article.billOfMaterials.forEach((item, index) => {
                    if (!validMaterialCodes.has(item.component)) {
                        errors.push(`Componente non valido alla riga ${index + 1}: "${item.component}" non esiste in anagrafica.`);
                    }
                });
            }

            if (errors.length > 0) {
                invalidArticles.push({ code: article.code || 'N/D', errors });
            } else {
                validArticles.push(article);
            }
        }

        return {
            success: true,
            validArticles,
            invalidArticles
        };
    } catch (error) {
        return { success: false, validArticles: [], invalidArticles: [] };
    }
}

/**
 * Saves a list of articles in bulk and updates associated jobs.
 */
export async function bulkSaveArticles(articles: Omit<Article, 'id'>[]): Promise<{ success: boolean; message: string }> {
    if (articles.length === 0) return { success: false, message: "Nessun articolo da salvare." };

    try {
        const batch = writeBatch(db);
        let updatedJobsTotal = 0;

        for (const articleData of articles) {
            const docId = articleData.code;
            const articleRef = doc(db, 'articles', docId);
            
            const fullArticle: Article = {
                id: docId,
                ...articleData,
            };
            
            batch.set(articleRef, fullArticle);

            // Update associated jobs
            const jobsQuery = query(collection(db, "jobOrders"), where("details", "==", articleData.code));
            const jobsSnapshot = await getDocs(jobsQuery);
            
            if (!jobsSnapshot.empty) {
                const newJobBOM: JobBillOfMaterialsItem[] = articleData.billOfMaterials.map(item => ({
                    ...item,
                    status: 'pending',
                    isFromTemplate: true,
                }));

                jobsSnapshot.forEach(jobDoc => {
                    batch.update(jobDoc.ref, { billOfMaterials: newJobBOM });
                    updatedJobsTotal++;
                });
            }
        }

        await batch.commit();
        revalidatePath('/admin/article-management');
        revalidatePath('/admin/production-console');

        return { 
            success: true, 
            message: `${articles.length} articoli salvati/aggiornati. ${updatedJobsTotal} commesse aggiornate.` 
        };
    } catch (error) {
        return { success: false, message: "Errore durante il salvataggio massivo." };
    }
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
    batch.set(articleRef, articleData);
    
    const jobsQuery = query(collection(db, "jobOrders"), where("details", "==", code));
    const jobsSnapshot = await getDocs(jobsQuery);
    
    let updatedJobsCount = 0;
    if (!jobsSnapshot.empty) {
        const newJobBOM: JobBillOfMaterialsItem[] = newBOM.map(item => ({
            ...item,
            status: 'pending',
            isFromTemplate: true,
        }));

        jobsSnapshot.forEach(jobDoc => {
            batch.update(jobDoc.ref, { billOfMaterials: newJobBOM });
            updatedJobsCount++;
        });
    }

    await batch.commit();

    revalidatePath('/admin/article-management');
    revalidatePath('/admin/production-console');
    
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
