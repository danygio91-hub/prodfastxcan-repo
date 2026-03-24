import { JobOrder, Operator, JobPhase, Article, OperatorAssignment } from './mock-data';
import { ProductionSettings } from '@/app/admin/production-settings/actions';
import { subtractWorkingMinutes, snapToPreviousWorkingTime } from './calendar-utils';
import { estimatePhaseTime } from './gantt-utils';
import { isBefore, isAfter, max, min, format } from 'date-fns';

export interface TimeSlot {
  start: Date;
  end: Date;
  jobId: string;
  phaseId: string;
}

export class OperatorCalendar {
  operatorId: string;
  slots: TimeSlot[] = [];

  constructor(operatorId: string) {
    this.operatorId = operatorId;
  }

  addSlot(slot: TimeSlot) {
    this.slots.push(slot);
    // Keep slots sorted chronologically
    this.slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  /**
   * Trova l'allocazione temporale per una fase, muovendosi a ritroso partendo da `deadline`.
   * Salta i weekend, le notti (usando le funzioni del calendar-utils) e salta gli SLOT già occupati.
   */
  allocateBackward(deadline: Date, requiredMinutes: number, jobId: string, phaseId: string): TimeSlot[] {
    let remainingMinutes = requiredMinutes;
    let currentEnd = snapToPreviousWorkingTime(deadline);
    const allocated: TimeSlot[] = [];

    // Prendi tutti gli slot futuri o passati, ma noi andiamo a ritroso, quindi ci interessano gli slot che finiscono prima della nostra partenza (o che si accavallano)
    // Ordiniamo gli slot decrescenti per comodità di scansione all'indietro
    const sortedSlots = [...this.slots].sort((a, b) => b.end.getTime() - a.end.getTime());

    while (remainingMinutes > 0) {
      // 1. Troviamo se la currentEnd cade dentro uno slot occupato
      const overlappingSlot = sortedSlots.find(s => currentEnd.getTime() > s.start.getTime() && currentEnd.getTime() <= s.end.getTime());
      
      if (overlappingSlot) {
        // Salta indietro prima dell'inizio dello slot occupato
        currentEnd = snapToPreviousWorkingTime(overlappingSlot.start);
        continue;
      }

      // 2. Troviamo il prossimo ostacolo a ritroso (uno slot occupato che inizia prima di currentEnd)
      const previousSlot = sortedSlots.find(s => s.end.getTime() <= currentEnd.getTime());
      
      // Calcoliamo la data di inizio teorica se non ci fossero ostacoli 
      const idealStart = subtractWorkingMinutes(currentEnd, remainingMinutes);
      
      if (previousSlot && previousSlot.end.getTime() > idealStart.getTime()) {
        let testStart = currentEnd;
        let iterMinutes = 0;
        let gapDuration = 0;
        let safeStart = currentEnd;
        while (testStart.getTime() > previousSlot.end.getTime() && iterMinutes < remainingMinutes) {
          testStart = subtractWorkingMinutes(currentEnd, iterMinutes + 1);
          if (testStart.getTime() >= previousSlot.end.getTime()) {
            gapDuration++;
            iterMinutes++;
            safeStart = testStart;
          } else {
            break; // Abbiamo colpito l'ostacolo
          }
        }
        
        if (gapDuration > 0) {
          allocated.push({
            start: safeStart,
            end: currentEnd,
            jobId,
            phaseId
          });
          remainingMinutes -= gapDuration;
        }
        currentEnd = snapToPreviousWorkingTime(previousSlot.start);
      } else {
        // Nessun ostacolo interferisce
        allocated.push({
          start: idealStart,
          end: currentEnd,
          jobId,
          phaseId
        });
        remainingMinutes -= remainingMinutes; // 0
      }
    }

    return allocated;
  }
}

export class GanttScheduler {
  operators: Operator[];
  assignments: OperatorAssignment[];
  calendars: Map<string, OperatorCalendar> = new Map();
  settings: ProductionSettings;

  constructor(operators: Operator[], assignments: OperatorAssignment[], settings: ProductionSettings) {
    this.operators = operators;
    this.assignments = assignments;
    this.settings = settings;
    operators.forEach(op => {
      this.calendars.set(op.id, new OperatorCalendar(op.id));
    });
  }

  /**
   * Schedula un ordine di lavoro a ritroso partendo dalla sua data di consegna
   */
  async scheduleJobBackward(job: JobOrder, articles: Article[]): Promise<{ job: JobOrder, isDelayed: boolean }> {
    if (!job.dataConsegnaFinale) return { job, isDelayed: false };
    
    const deadline = snapToPreviousWorkingTime(new Date(job.dataConsegnaFinale));
    let currentDeadline = deadline;
    let isDelayed = false;

    // Ordina le fasi in sequenza decrescente (dall'ultima alla prima)
    const phases = [...(job.phases || [])].sort((a, b) => b.sequence - a.sequence);
    const article = articles.find(a => a.code === job.details);

    for (let phase of phases) {
      if (phase.status === 'completed' || phase.status === 'skipped') continue;

      const theo = article?.phaseTimes?.[phase.name]?.expectedMinutesPerPiece || 10;
      let totalRequiredMinutes = theo * job.qta;
      
      const buffer = this.settings.capacityBufferPercent || 100;
      totalRequiredMinutes = totalRequiredMinutes / (buffer / 100);

      // 2. Trova gli operatori compatibili basandosi su Skills E Assegnazione al Reparto ODL
      const capableOperators = this.operators.filter(op => {
        // Skill check: Sa fare questa fase?
        const hasSkill = op.skills?.some(s => s.phaseId === phase.name);
        if (!hasSkill) return false;

        // Assignment check: E' assegnato al reparto di questo ODL?
        const dateStr = format(currentDeadline, 'yyyy-MM-dd');
        const activeAssign = this.assignments.find(a => 
            a.operatorId === op.id && 
            dateStr >= a.startDate && 
            dateStr <= a.endDate
        );

        const currentDept = activeAssign ? activeAssign.departmentCode : (op.reparto && op.reparto.length > 0 ? op.reparto[0] : null);
        
        return currentDept === job.department;
      });

      if (capableOperators.length === 0) {
        // Nessun operatore capace! Segna un alert sulla fase.
        continue;
      }

      // 3. Cerca l'operatore che offre la collocazione "più vicina" alla currentDeadline
      let bestAllocation: TimeSlot[] = [];
      let bestOpId = '';
      let bestEndDiff = Infinity; // Differenza tra currentDeadline e la fine dell'allocazione

      for (let op of capableOperators) {
        const skill = op.skills?.find(s => s.phaseId === phase.name);
        if (!skill) continue;

        const effectiveMinutes = totalRequiredMinutes / (skill.efficiencyPercent / 100);
        
        // Simula allocazione
        const cal = this.calendars.get(op.id);
        if (cal) {
          const alloc = cal.allocateBackward(currentDeadline, effectiveMinutes, job.id, phase.id);
          if (alloc.length > 0) {
            // L'"ultima" operazione (cioè quella che finisce più tardi, quindi la più vicina alla deadline)
            const overallEnd = alloc[0].end; 
            const diff = currentDeadline.getTime() - overallEnd.getTime();
            
            // Criterio utente: "distribuire gli operatori, non è detto che il migliore sia quello disponibile"
            // Selezioniamo chi ci permette di finire il lavoro "più vicino" (minimizza gap) 
            if (diff >= 0 && diff < bestEndDiff) {
              bestEndDiff = diff;
              bestAllocation = alloc;
              bestOpId = op.id;
            }
          }
        }
      }

      if (bestAllocation.length > 0 && bestOpId) {
        // Conferma allocazione nel calendario
        const cal = this.calendars.get(bestOpId);
        bestAllocation.forEach(slot => cal?.addSlot(slot));

        // Aggiorna phase con i predicted WorkPeriods basati sull'allocazione
        // (L'allocazione è in ordine inverso, sortiamo chronologicamente)
        bestAllocation.sort((a, b) => a.start.getTime() - b.start.getTime());
        phase.workPeriods = bestAllocation.map(slot => ({
          start: slot.start,
          end: slot.end,
          operatorId: bestOpId
        }));

        // La nuova deadline per la fase N-1 è l'INIZIO della prima sotto-fase di questa
        currentDeadline = bestAllocation[0].start;

        if (isBefore(currentDeadline, new Date())) {
          isDelayed = true; // Sforamento oltre la data di oggi!
        }
      }
    }

    return { job, isDelayed };
  }
}
