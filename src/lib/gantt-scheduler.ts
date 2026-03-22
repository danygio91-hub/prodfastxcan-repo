import { JobOrder, Operator, JobPhase, Article } from './mock-data';
import { ProductionSettings } from '@/app/admin/production-settings/actions';
import { subtractWorkingMinutes, snapToPreviousWorkingTime } from './calendar-utils';
import { estimatePhaseTime } from './gantt-utils';
import { isBefore, isAfter, max, min } from 'date-fns';

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
      // (ma limitata al blocco lavorativo corrente gestito da subtractWorkingMinutes)
      // Attenzione: subtractWorkingMinutes restituisce la start date sottratti i minuti.
      // Se c'è un prevSlot molto vicino, non possiamo usare tutti i remainingMinutes.
      
      // Approccio passo-passo (minuto per minuto o per blocchi per semplicità)
      // Per ottimizzare, troviamo la start date come se non ci fossero job
      const idealStart = subtractWorkingMinutes(currentEnd, remainingMinutes);
      
      if (previousSlot && previousSlot.end.getTime() > idealStart.getTime()) {
        // L'ostacolo interferisce con il nostro blocco ideale.
        // Calcoliamo quanti minuti lavorativi effettivi ci sono tra currentEnd e previousSlot.end
        // Poiché è complicato calcolare i minuti esatti inversi saltando i weekend senza una funzione apposita, 
        // usiamo un trucco: scendiamo esattamente alla fine dell'ostacolo.
        // Ma non sappiamo quanti minuti lavorativi sono. 
        // Facciamo il calcolo inverso:
        // C'è un gap lavorativo tra previousSlot.end e currentEnd.
        // Lo riempiamo!
        
        let testStart = currentEnd;
        let iterMinutes = 0;
        // Misuriamo quanti minuti lavorativi effettivi ha questo gap 
        // spostando indietro di 1 minuto alla volta (non efficientissimo, ma sicuro per i test).
        // (Ottimizzazione futura: usare math puro).
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
  calendars: Map<string, OperatorCalendar> = new Map();
  settings: ProductionSettings;

  constructor(operators: Operator[], settings: ProductionSettings) {
    this.operators = operators;
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

      // 1. Trova il tempo stimato per questa fase
      // Dato che executeTask non supporta chiamate asincrone complesse in map, mockiamo il teorico temporaneamente
      const theo = article?.phaseTimes?.[phase.name]?.expectedMinutesPerPiece || 10;
      // Il calcolo preciso `estimatePhaseTime` richiede DB, lo assumeremo già passato o calcolato
      const estimatedMinutesPerPiece = theo; // Assunzione per ora
      let totalRequiredMinutes = estimatedMinutesPerPiece * job.qta;
      
      // Applica Capacity Buffer globale
      const buffer = this.settings.capacityBufferPercent || 100;
      totalRequiredMinutes = totalRequiredMinutes / (buffer / 100);

      // 2. Trova gli operatori compatibili con questa fase (Hard Skill / Soft Skill)
      const capableOperators = this.operators.filter(op => 
        op.skills?.some(s => s.phaseId === phase.name) // Use phase name or ID, assumiamo ID
      );

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
