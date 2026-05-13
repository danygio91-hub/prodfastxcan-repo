
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { JobOrder, WorkGroup, JobPhase, WorkPhaseTemplate, Article, PhaseType } from '@/types';
import { convertTimestampsToDates, parseRobustDate } from '@/lib/utils';

export async function updateArticleHistoricalTimes(articleCode: string, cachedData?: { templates?: Map<string, PhaseType>, minMs?: number }) {
    if (!articleCode) return;
    const trimmedCode = articleCode.trim();

    try {
        // 1. Fetch Article
        const articleSnap = await adminDb.collection("articles").where("code", "==", trimmedCode).limit(1).get();
        if (articleSnap.empty) return;
        const articleDoc = articleSnap.docs[0];
        const articleData = articleDoc.data() as Article;

        // 2. Fetch last 500 jobs for this article (Increased from 50)
        const jobsSnap = await adminDb.collection("jobOrders")
            .where("details", "==", trimmedCode)
            .orderBy("ordinePF", "desc") // Get most recent
            .limit(500)
            .get();

        if (jobsSnap.empty) {
            await articleDoc.ref.update({
                timesStatus: 'RED',
                historicalTimes: admin.firestore.FieldValue.delete()
            });
            return;
        }

        const jobs = jobsSnap.docs.map(doc => doc.data() as JobOrder);

        // 3. Setup settings and templates (Use cache if provided)
        let MIN_MS = cachedData?.minMs;
        if (MIN_MS === undefined) {
            const settingsDoc = await adminDb.collection('configuration').doc('timeTrackingSettings').get();
            const timeSettings = settingsDoc.exists ? settingsDoc.data() : { minimumPhaseDurationSeconds: 10 } as any;
            MIN_MS = (timeSettings.minimumPhaseDurationSeconds || 10) * 1000;
        }
        
        let typeMap = cachedData?.templates;
        if (!typeMap) {
            const tSnap = await adminDb.collection("workPhaseTemplates").get();
            typeMap = new Map<string, PhaseType>();
            tSnap.forEach(d => {
                const name = String(d.data().name || '').trim().toUpperCase();
                if (name) typeMap!.set(name, d.data().type);
            });
        }
        
        // 4. Fetch WorkGroups if any
        const workGroupIds = [...new Set(jobs.map(j => j.workGroupId).filter(Boolean))] as string[];
        const groupsMap = new Map<string, WorkGroup>();
        if (workGroupIds.length > 0) {
            for (let i = 0; i < workGroupIds.length; i += 30) {
                const chunk = workGroupIds.slice(i, i + 30);
                const snap = await adminDb.collection("workGroups").where(admin.firestore.FieldPath.documentId(), "in", chunk).get();
                snap.forEach(d => groupsMap.set(d.id, d.data() as WorkGroup));
            }
        }

        const phaseData: { [phaseKey: string]: { originalName: string, records: { min: number, qta: number }[], type: PhaseType } } = {};

        const calculateMs = (p: JobPhase) => {
            if (p.forced) return 0; // Exclude forced closures
            return (p.workPeriods || []).reduce((acc, wp) => {
                if (!wp.start || !wp.end) return acc;
                const start = parseRobustDate(wp.start);
                const end = parseRobustDate(wp.end);
                if (start && end) {
                    const diff = end.getTime() - start.getTime();
                    return diff > 0 ? acc + diff : acc;
                }
                return acc;
            }, 0);
        };

        for (const job of jobs) {
            if (job.qta <= 0) continue;

            let phasesWithDetails: Array<{ phase: JobPhase, timeMs: number }> = [];

            if (job.workGroupId && groupsMap.has(job.workGroupId)) {
                const group = groupsMap.get(job.workGroupId)!;
                phasesWithDetails = (group.phases || []).map(gp => ({ 
                    phase: gp, 
                    timeMs: (group.totalQuantity > 0 ? (calculateMs(gp) / group.totalQuantity) * job.qta : 0) 
                }));
            } else {
                phasesWithDetails = (job.phases || []).map(p => ({ phase: p, timeMs: calculateMs(p) }));
            }

            phasesWithDetails.forEach(p => {
                const normalizedName = String(p.phase.name || '').trim().toUpperCase();
                if (!normalizedName) return;

                const min = p.timeMs / 60000;
                
                if (p.timeMs >= MIN_MS!) {
                    if (!phaseData[normalizedName]) {
                        phaseData[normalizedName] = { 
                            originalName: p.phase.name,
                            records: [], 
                            type: typeMap!.get(normalizedName) || 'production' 
                        };
                    }
                    phaseData[normalizedName].records.push({ min, qta: job.qta });
                }
            });
        }

        const averagePhaseTimes = Object.entries(phaseData).map(([key, d]) => {
            let validRecords = d.records;
            
            // Outlier Filter (300% tolleranza) solo se N >= 5
            if (validRecords.length >= 5) {
                const minPerPieceArr = validRecords.map(r => r.min / r.qta).sort((a, b) => a - b);
                const median = minPerPieceArr[Math.floor(minPerPieceArr.length / 2)];
                const maxAllowed = median * 4; // > 300% tolleranza (media + 300%)
                
                validRecords = validRecords.filter(r => (r.min / r.qta) <= maxAllowed);
            }

            const totalMinutes = validRecords.reduce((sum, r) => sum + r.min, 0);
            const totalQuantity = validRecords.reduce((sum, r) => sum + r.qta, 0);

            return {
                name: d.originalName,
                averageMinutesPerPiece: totalQuantity > 0 ? totalMinutes / totalQuantity : 0,
                type: d.type
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        const averageMinutesPerPiece = averagePhaseTimes.reduce((acc, p) => acc + p.averageMinutesPerPiece, 0);

        // 5. Determine Status
        let timesStatus: 'GREEN' | 'AMBER' | 'RED' = 'RED';
        
        if (averagePhaseTimes.length > 0) {
            timesStatus = 'AMBER';
            
            if (articleData.workCycleId) {
                const cycleSnap = await adminDb.collection("workCycles").doc(articleData.workCycleId).get();
                if (cycleSnap.exists) {
                    const cycleData = cycleSnap.data();
                    const requiredPhaseIds = cycleData?.phaseTemplateIds || [];
                    
                    const templatesSnap = await adminDb.collection("workPhaseTemplates").get();
                    const requiredPhaseNames = templatesSnap.docs
                        .filter(d => requiredPhaseIds.includes(d.id) && d.data().tracksTime !== false)
                        .map(d => String(d.data().name || '').trim().toUpperCase());
                    
                    const existingPhaseKeys = Object.keys(phaseData);
                    const allPhasesPresent = requiredPhaseNames.every(name => existingPhaseKeys.includes(name));
                    
                    if (allPhasesPresent && requiredPhaseNames.length > 0) {
                        timesStatus = 'GREEN';
                    }
                }
            } else if (averageMinutesPerPiece > 0) {
                timesStatus = 'AMBER';
            }
        }

        // 6. Update Article
        await articleDoc.ref.update({
            historicalTimes: {
                averageMinutesPerPiece,
                averagePhaseTimes,
                lastUpdate: admin.firestore.Timestamp.now()
            },
            timesStatus
        });
    } catch (err) {
        console.error(`Error updating article ${articleCode}:`, err);
        // Do not throw, just log to allow bulk migration to continue
    }
}

/**
 * SMART REMAINDER LOGIC
 * Distributes total expected minutes among phases based on theoretical weights,
 * after subtracting phases that already have historical/real data.
 */
export function distributeTheoreticalTimes(
    totalMinutes: number,
    phases: JobPhase[],
    historicalAverages: Array<{ name: string; averageMinutesPerPiece: number }> = []
): JobPhase[] {
    if (totalMinutes <= 0) return phases;

    // 1. Map historical averages by normalized name
    const historyMap = new Map(
        historicalAverages.map(h => [h.name.trim().toUpperCase(), h.averageMinutesPerPiece])
    );

    // 2. Identify phases with history (B) and empty phases to be weighted
    let totalHistoricalMinutes = 0;
    const phasesToWeight: JobPhase[] = [];

    const updatedPhases = phases.map(phase => {
        const normalizedName = phase.name.trim().toUpperCase();
        const historicalTime = historyMap.get(normalizedName);

        // A phase has "history" if it's in the historical averages and > 0
        if (historicalTime !== undefined && historicalTime > 0) {
            totalHistoricalMinutes += historicalTime;
            return { ...phase, expectedMinutesPerPiece: historicalTime };
        } else {
            phasesToWeight.push(phase);
            return { ...phase, expectedMinutesPerPiece: 0 };
        }
    });

    // 3. Calculate Remainder (C = A - B)
    const remainingMinutes = Math.max(0, totalMinutes - totalHistoricalMinutes);

    if (remainingMinutes > 0 && phasesToWeight.length > 0) {
        // 4. Sum theoretical weights (fallback to 1 if missing or <= 0)
        const totalWeight = phasesToWeight.reduce((sum, p) => sum + Math.max(1, p.theoreticalWeight || 1), 0);

        // 5. Proportional distribution
        updatedPhases.forEach(phase => {
            const isToWeight = phasesToWeight.some(p => p.id === phase.id && p.name === phase.name && p.sequence === phase.sequence);
            if (isToWeight) {
                const weight = Math.max(1, phase.theoreticalWeight || 1);
                phase.expectedMinutesPerPiece = (remainingMinutes / totalWeight) * weight;
            }
        });
    }

    return updatedPhases;
}
