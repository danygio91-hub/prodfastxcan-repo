
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { Article, ArticlePhaseTime, WorkCycle } from '@/types';
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
    attachments: z.array(z.object({
        name: z.string().min(1, "Nome allegato obbligatorio"),
        url: z.string().url("URL non valido")
    })).optional().default([]),
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

export async function saveArticle(data: any): Promise<{ success: boolean; message: string; }> {
    try {
        // Filter out empty components before validation to allow partial forms
        if (data.billOfMaterials && Array.isArray(data.billOfMaterials)) {
            data.billOfMaterials = data.billOfMaterials.filter((item: any) => item.component && item.component.trim() !== '');
        }

        const validatedFields = articleSchema.safeParse(data);
        if (!validatedFields.success) {
            console.error('Validation error:', validatedFields.error.format());
            return { success: false, message: 'Dati non validi: ' + validatedFields.error.errors.map(e => e.message).join(', ') };
        }

        const { 
            code, billOfMaterials, workCycleId, secondaryWorkCycleId, 
            expectedMinutesDefault, expectedMinutesSecondary, attachments 
        } = validatedFields.data;

        // Check if components exist in rawMaterials
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
        
        // Build articleData carefully to avoid undefined values
        const articleData: any = {
            id: docId,
            code: docId,
            billOfMaterials: billOfMaterials,
        };
        
        if (workCycleId !== undefined) articleData.workCycleId = workCycleId;
        if (secondaryWorkCycleId !== undefined) articleData.secondaryWorkCycleId = secondaryWorkCycleId;
        if (expectedMinutesDefault !== undefined) articleData.expectedMinutesDefault = expectedMinutesDefault;
        if (expectedMinutesSecondary !== undefined) articleData.expectedMinutesSecondary = expectedMinutesSecondary;
        if (attachments !== undefined) articleData.attachments = attachments;

        await adminDb.collection('articles').doc(docId).set(articleData, { merge: true });
        revalidatePath('/admin/article-management');
        return { success: true, message: `Articolo ${docId} salvato.` };
    } catch (error: any) {
        console.error('Error in saveArticle:', error);
        return { success: false, message: "Errore durante il salvataggio: " + (error.message || "Errore sconosciuto") };
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

    const existingCodes = new Set<string>();
    const importedCodes = articles.map(a => a.code.toUpperCase()).filter(Boolean);
    
    for (let i = 0; i < importedCodes.length; i += 30) {
        const chunk = importedCodes.slice(i, i + 30);
        const snap = await adminDb.collection("articles").where("code", "in", chunk).get();
        snap.forEach(d => existingCodes.add(d.data().code.toUpperCase()));
    }

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
    const codes = [...new Set(rows.map(row => 
        String(row['CODICE ARTICOLO'] || row['codice articolo'] || '').trim().toUpperCase()
    ).filter(Boolean))];

    const articlesMap = new Map<string, Article>();
    for (let i = 0; i < codes.length; i += 30) {
        const chunk = codes.slice(i, i + 30);
        const snap = await adminDb.collection("articles").where("code", "in", chunk).get();
        snap.forEach(d => articlesMap.set(d.data().code.toUpperCase(), d.data() as Article));
    }

    const [cyclesSnap, phasesSnap] = await Promise.all([
        adminDb.collection("workCycles").get(),
        adminDb.collection("workPhaseTemplates").get()
    ]);
    const cyclesMap = new Map<string, WorkCycle>(cyclesSnap.docs.map(d => [String(d.data().name).toUpperCase(), { ...d.data(), id: d.id } as WorkCycle]));
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

        const cycleDef = cycleDefName ? cyclesMap.get(cycleDefName) : undefined;
        const cycleSec = cycleSecName ? cyclesMap.get(cycleSecName) : undefined;

        if (cycleDefName && !cycleDef) {
            invalidRows.push({ code, reason: `Ciclo Predefinito "${cycleDefName}" non trovato.` });
            continue;
        }

        const primaryCycleId = cycleDef?.id || article.workCycleId;
        const activeCycle = primaryCycleId && primaryCycleId !== 'manual' ? cyclesMap.get([...cyclesMap.keys()].find(k => cyclesMap.get(k)?.id === primaryCycleId) || '') : null;
        const allowedPhaseIds = activeCycle ? new Set(activeCycle.phaseTemplateIds) : null;

        const secCycleId = cycleSec?.id || article.secondaryWorkCycleId;
        const activeSecCycle = secCycleId && secCycleId !== 'manual' ? cyclesMap.get([...cyclesMap.keys()].find(k => cyclesMap.get(k)?.id === secCycleId) || '') : null;
        const allowedSecPhaseIds = activeSecCycle ? new Set(activeSecCycle.phaseTemplateIds) : null;

        // Filtriamo phaseTimes (Default)
        const phaseTimes: Record<string, ArticlePhaseTime> = {};
        if (article.phaseTimes) {
            Object.entries(article.phaseTimes).forEach(([pid, pdata]) => {
                if (!allowedPhaseIds || allowedPhaseIds.has(pid)) {
                    phaseTimes[pid] = { ...pdata };
                }
            });
        }

        // Filtriamo phaseTimesSecondary (Secondario)
        const phaseTimesSecondary: Record<string, ArticlePhaseTime> = {};
        if (article.phaseTimesSecondary) {
            Object.entries(article.phaseTimesSecondary).forEach(([pid, pdata]) => {
                if (!allowedSecPhaseIds || allowedSecPhaseIds.has(pid)) {
                    phaseTimesSecondary[pid] = { ...pdata };
                }
            });
        }

        let hasPhaseUpdates = false;

        // Cerca colonne dinamiche "TEMPO FASE: NOME_FASE"
        const rowKeys = Object.keys(row);
        for (const key of rowKeys) {
            const upKey = key.toUpperCase().trim();
            if (upKey.startsWith('TEMPO FASE:')) {
                const phaseName = upKey.replace('TEMPO FASE:', '').trim();
                const mappedPhaseId = phasesMap.get(phaseName);
                if (mappedPhaseId) {
                    // Aggiorniamo i tempi solo se la fase è nel ciclo attivo (o se siamo in manuale)
                    if (!allowedPhaseIds || allowedPhaseIds.has(mappedPhaseId)) {
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
        }

        const updateObj: Partial<Article> = {
            id: code,
            code: code,
            workCycleId: cycleDef?.id || article.workCycleId,
            secondaryWorkCycleId: cycleSec?.id || article.secondaryWorkCycleId,
            phaseTimes: phaseTimes,
            phaseTimesSecondary: phaseTimesSecondary
        };

        const expectedDef = Number(row['TEMPO PREVISTO CICLO PREDEFINITO'] || row['tempo previsto ciclo predefinito']);
        if (!isNaN(expectedDef) && expectedDef > 0) updateObj.expectedMinutesDefault = expectedDef;
        
        const expectedSec = Number(row['TEMPO PREVISTO CICLO SECONDARIO'] || row['tempo previsto ciclo secondario']);
        if (!isNaN(expectedSec) && expectedSec > 0) updateObj.expectedMinutesSecondary = expectedSec;

        validUpdates.push(updateObj);
    }

    return { validUpdates, invalidRows };
}

export async function bulkUpdateArticleSettings(updates: Partial<Article>[]) {
    const batch = adminDb.batch();
    updates.forEach(upd => {
        if (upd.id) {
            const { id, ...data } = upd;
            // Usiamo update invece di set(..., {merge:true}) per SOSTITUIRE le mappe phaseTimes/phaseTimesSecondary
            // Questo garantisce che le fasi rimosse dal ciclo spariscano effettivamente da Firestore.
            batch.update(adminDb.collection('articles').doc(id), data as any);
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

export async function getWorkCycles(): Promise<WorkCycle[]> {
    const snap = await adminDb.collection("workCycles").orderBy("name").get();
    return snap.docs.map(d => ({ ...d.data(), id: d.id } as WorkCycle));
}
