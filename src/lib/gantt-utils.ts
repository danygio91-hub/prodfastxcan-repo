import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, WorkCycle, ProductionSettings } from '@/types';
import { getTimeTrackingSettings } from '@/app/admin/time-tracking-settings/actions';

export interface PhaseTimeEstimate {
  estimatedTimeSeconds: number;
  isBasedOnActual: boolean;
  actualSampleSize?: number;
  confidenceWarning?: string;
}

export async function estimatePhaseTime(
  articleCode: string, 
  phaseName: string, 
  theoreticalTimeSeconds: number, 
  settings: ProductionSettings,
  unitQty: number = 1
): Promise<PhaseTimeEstimate> {
  
  if (!settings.prioritizeActualTime) {
    return {
      estimatedTimeSeconds: theoreticalTimeSeconds * unitQty,
      isBasedOnActual: false
    };
  }

  // 1. Get Time Tracking Validation rules (to filter out bad data)
  const validationRules = await getTimeTrackingSettings().catch(() => ({ minimumPhaseDurationSeconds: 10 }));

  // 2. Query completed JobOrders for the same article
  const jobsRef = collection(db, "jobOrders");
  const q = query(
    jobsRef,
    where("details", "==", articleCode),
    where("status", "==", "completed")
  );

  const snap = await getDocs(q);
  const completedJobs = snap.docs.map(d => d.data() as JobOrder);

  let validActualTimes: number[] = [];

  for (const job of completedJobs) {
    if (!job.phases || !job.qta) continue;
    
    // Trova la fase corrispondente
    const matchingPhase = job.phases.find(p => p.name === phaseName && p.status === 'completed');
    if (!matchingPhase) continue;

    const actualDurationMs = (matchingPhase.workPeriods || []).reduce((acc, wp) => {
      const start = wp.start && typeof wp.start === 'object' && 'seconds' in wp.start 
          ? new Date((wp.start as any).seconds * 1000) 
          : new Date(wp.start);
      const end = wp.end && typeof wp.end === 'object' && 'seconds' in wp.end 
          ? new Date((wp.end as any).seconds * 1000) 
          : (wp.end ? new Date(wp.end) : new Date());
          
      if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
          return acc + (end.getTime() - start.getTime());
      }
      return acc;
    }, 0);
    const actualDuration = Math.floor(actualDurationMs / 1000);
    
    // Validation: skip if too short
    if (actualDuration < validationRules.minimumPhaseDurationSeconds) continue;

    // Normalizziamo per pezzo
    const timePerUnit = actualDuration / job.qta;
    validActualTimes.push(timePerUnit);
  }

  // 3. Calcolo
  if (validActualTimes.length === 0) {
    return {
      estimatedTimeSeconds: theoreticalTimeSeconds * unitQty,
      isBasedOnActual: false,
      confidenceWarning: "Nessuno storico affidabile. Utilizzo tempo teorico."
    };
  }

  // Rimuovi outlier: IQR Filter o semplicemente Media
  validActualTimes.sort((a, b) => a - b);
  // Rimuovi il 10% inferiore e superiore se abbiamo abbastanza campioni per evitare estremi
  let timesToMap = validActualTimes;
  if (validActualTimes.length > 5) {
      const dropCount = Math.floor(validActualTimes.length * 0.1);
      timesToMap = validActualTimes.slice(dropCount, validActualTimes.length - dropCount);
  }
  
  const avgTimePerUnit = timesToMap.reduce((a, b) => a + b, 0) / timesToMap.length;

  return {
    estimatedTimeSeconds: avgTimePerUnit * unitQty,
    isBasedOnActual: true,
    actualSampleSize: validActualTimes.length,
    // Se lo scarto tra reale e teorico è enorme, lancia un warning
    confidenceWarning: (avgTimePerUnit > theoreticalTimeSeconds * 2 || avgTimePerUnit < theoreticalTimeSeconds * 0.5) 
      ? "L'effettivo si discosta oltre il 50% dal Teorico!" 
      : undefined
  };
}
