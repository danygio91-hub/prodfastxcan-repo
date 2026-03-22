
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { Article, ArticlePhaseTime, WorkCycle } from '@/lib/mock-data';
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
    workCycleId: z.string().optional(),
    secondaryWorkCycleId: z.string().optional(),
    expectedMinutesDefault: z.coerce.number().optional(),
    expectedMinutesSecondary: z.coerce.number().optional(),
});

export async function getArticles(searchTerm?: string, lastCode?: string, limitCount: number = 50): Promise<Article[]> {
    let q: admin.firestore.Query = adminDb.collection('articles');
    const searchPart = (searchTerm || '').toUpperCase().trim();
    if (searchPart.length >= 2) {
        q = q.where('code', '>=', searchPart).where('code', '<=', searchPart + '\uf8ff').limit(100);
    } else if (searchTerm !== undefined && searchTerm.trim() !== '') {
        return [];
    } else {
        q = q.orderBy("code");
        if (lastCode) {
            q = q.startAfter(lastCode.toUpperCase().trim());
        }
        q = q.limit(limitCount);
    }
    const articlesSnapshot = await q.get();
    const articles = articlesSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Article));
    return articles;
}

export async function saveArticle(data: z.infer<typeof articleSchema>): Promise<{ success: boolean; message: string; }> {
    const validatedFields = articleSchema.safeParse(data);
    if (!validatedFields.success) return { success: false, message: 'Dati non validi.' };

    const { code, billOfMaterials, workCycleId, secondaryWorkCycleId, expectedMinutesDefault, expectedMinutesSecondary } = validatedFields.data;

    const uniqueCodes = [...new Set(billOfMaterials.map(i => i.component).filter(Boolean))];
    const materialCodes = new Set<string>();
    
    for (let i = 0; i < uniqueCodes.length; i += 30) {
        const chunk = uniqueCodes.slice(i, i + 30);
        const snap = await adminDb.collection("rawMaterials").where("code", "in", chunk).get();
        snap.forEach(d => materialCodes.add(d.data().code.toUpperCase()));
    }

    const invalid = billOfMaterials.filter(item => item.component && !materialCodes.has(item.component.toUpperCase()));
    if (invalid.length > 0) {
        return { success: false, message: `Componenti non trovati in anagrafica: ${invalid.map(i => i.component).join(', ')}` };
    }

    const docId = code.toUpperCase();
    const articleData: Partial<Article> = {
        id: docId,
        code: docId,
        billOfMaterials,
        workCycleId,
        secondaryWorkCycleId,
        expectedMinutesDefault,
        expectedMinutesSecondary
    };

    try {
        await adminDb.collection('articles').doc(docId).set(articleData, { merge: true });
        revalidatePath('/admin/article-management');
        return { success: true, message: `Articolo ${docId} salvato.` };
    } catch (error) {
        return { success: false, message: "Errore durante il salvataggio." };
    }
}

export async function deleteArticle(id: string): Promise<{ success: boolean; message: string; }> {
    await adminDb.collection("articles").doc(id).delete();
    revalidatePath('/admin/article-management');
    return { success: true, message: 'Articolo eliminato.' };
}

export async function validateArticlesImport(articles: Omit<Article, 'id'>[]) {
    const allImportedComponents = new Set<string>();
    articles.forEach(art => art.billOfMaterials?.forEach(item => { if (item.component) allImportedComponents.add(item.component.toUpperCase()) }));
    const uniqueComponents = [...allImportedComponents];
    
    const validCodes = new Set<string>();
    for (let i = 0; i < uniqueComponents.length; i += 30) {
        const chunk = uniqueComponents.slice(i, i + 30);
        const snap = await adminDb.collection("rawMaterials").where("code", "in", chunk).get();
        snap.forEach(d => validCodes.add(d.data().code.toUpperCase()));
    }

    const existingArticlesSnap = await adminDb.collection("articles").get();
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
                if (!validCodes.has(item.component.toUpperCase())) errors.push(`Componente riga ${idx + 1} non in anagrafica: ${item.component}`);
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
    const batch = adminDb.batch();
    articles.forEach(art => {
        const id = art.code.toUpperCase();
        batch.set(adminDb.collection('articles').doc(id), { ...art, id, code: id }, { merge: true });
    });
    await batch.commit();
    revalidatePath('/admin/article-management');
    return { success: true, message: `${articles.length} articoli elaborati.` };
}

export async function validateArticleSettingsImport(rows: any[]) {
    const [articlesSnap, cyclesSnap, phasesSnap] = await Promise.all([
        adminDb.collection("articles").get(),
        adminDb.collection("workCycles").get(),
        adminDb.collection("workPhaseTemplates").get()
    ]);

    const articlesMap = new Map<string, Article>(articlesSnap.docs.map(d => [d.id.toUpperCase(), d.data() as Article]));
    const cyclesMap = new Map<string, string>(cyclesSnap.docs.map(d => [String(d.data().name).toUpperCase(), d.id]));
    const phasesMap = new Map<string, string>(phasesSnap.docs.map(d => [String(d.data().name).toUpperCase(), d.id]));

    const validUpdates: Partial<Article>[] = [];
    const invalidRows: { code: string; reason: string }[] = [];

    for (const row of rows) {
        const code = String(row['CODICE ARTICOLO'] || row['codice articolo'] || '').trim().toUpperCase();
        if (!code) continue;

        const article = articlesMap.get(code);
        if (!article) {
            invalidRows.push({ code, reason: "Articolo non trovato in anagrafica." });
            continue;
        }

        const cycleDefName = String(row['CICLO PREDEFINITO'] || row['ciclo predefinito'] || '').trim().toUpperCase();
        const cycleSecName = String(row['CICLO SECONDARIO'] || row['ciclo secondario'] || '').trim().toUpperCase();

        const cycleDefId = cycleDefName ? cyclesMap.get(cycleDefName) : undefined;
        const cycleSecId = cycleSecName ? cyclesMap.get(cycleSecName) : undefined;

        if (cycleDefName && !cycleDefId) {
            invalidRows.push({ code, reason: `Ciclo Predefinito "${cycleDefName}" non trovato.` });
            continue;
        }

        const phaseTimes: Record<string, ArticlePhaseTime> = { ...(article.phaseTimes || {}) };
        let hasPhaseUpdates = false;

        // Cerca colonne dinamiche "TEMPO FASE: NOME_FASE"
        const rowKeys = Object.keys(row);
        for (const key of rowKeys) {
            const upKey = key.toUpperCase().trim();
            if (upKey.startsWith('TEMPO FASE:')) {
                const phaseName = upKey.replace('TEMPO FASE:', '').trim();
                const mappedPhaseId = phasesMap.get(phaseName);
                if (mappedPhaseId) {
                    const minutesStr = row[key];
                    if (minutesStr !== undefined && minutesStr !== null && minutesStr !== '') {
                        const mins = Number(minutesStr);
                        if (!isNaN(mins)) {
                            phaseTimes[mappedPhaseId] = {
                                expectedMinutesPerPiece: mins,
                                detectedMinutesPerPiece: phaseTimes[mappedPhaseId]?.detectedMinutesPerPiece || 0,
                                enabled: true
                            };
                            hasPhaseUpdates = true;
                        }
                    }
                }
            }
        }

        const updateObj: Partial<Article> = {
            id: code,
            code: code,
            workCycleId: cycleDefId || article.workCycleId,
            secondaryWorkCycleId: cycleSecId || article.secondaryWorkCycleId,
        };

        const expectedDef = Number(row['TEMPO PREVISTO CICLO PREDEFINITO'] || row['tempo previsto ciclo predefinito']);
        if (!isNaN(expectedDef) && expectedDef > 0) updateObj.expectedMinutesDefault = expectedDef;
        
        const expectedSec = Number(row['TEMPO PREVISTO CICLO SECONDARIO'] || row['tempo previsto ciclo secondario']);
        if (!isNaN(expectedSec) && expectedSec > 0) updateObj.expectedMinutesSecondary = expectedSec;

        if (hasPhaseUpdates) {
            updateObj.phaseTimes = phaseTimes;
        }

        validUpdates.push(updateObj);
    }

    return { validUpdates, invalidRows };
}

export async function bulkUpdateArticleSettings(updates: Partial<Article>[]) {
    const batch = adminDb.batch();
    updates.forEach(upd => {
        if (upd.id) {
            batch.set(adminDb.collection('articles').doc(upd.id), upd, { merge: true });
        }
    });
    await batch.commit();
    revalidatePath('/admin/article-management');
    revalidatePath('/admin/data-management');
    return { success: true, message: `${updates.length} articoli aggiornati.` };
}

export async function saveArticleStandardTimes(articleId: string, data: Partial<Article>) {
    try {
        await adminDb.collection('articles').doc(articleId).set(data, { merge: true });
        revalidatePath('/admin/article-management');
        return { success: true, message: 'Standard Tempi e Cicli aggiornati con successo.' };
    } catch (e) {
        return { success: false, message: 'Errore durante il salvataggio.' };
    }
}
