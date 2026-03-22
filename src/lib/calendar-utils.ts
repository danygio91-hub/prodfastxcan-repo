import { startOfDay, addDays, subDays, getDay, setHours, setMinutes, setSeconds, isBefore, isAfter, differenceInMinutes } from 'date-fns';

/**
 * Standard working hours for the factory:
 * Morning: 08:00 - 12:00
 * Afternoon: 13:00 - 17:00
 * Work days: Monday to Friday
 */

const WORK_START_H = 8;
const WORK_START_M = 0;
const LUNCH_START_H = 12;
const LUNCH_START_M = 0;
const LUNCH_END_H = 13;
const LUNCH_END_M = 0;
const WORK_END_H = 17;
const WORK_END_M = 0;

function isWeekend(date: Date): boolean {
  const day = getDay(date);
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

function getWorkBlocksForDay(date: Date) {
  const dayStart = startOfDay(date);
  const morningStart = setSeconds(setMinutes(setHours(dayStart, WORK_START_H), WORK_START_M), 0);
  const morningEnd = setSeconds(setMinutes(setHours(dayStart, LUNCH_START_H), LUNCH_START_M), 0);
  const afternoonStart = setSeconds(setMinutes(setHours(dayStart, LUNCH_END_H), LUNCH_END_M), 0);
  const afternoonEnd = setSeconds(setMinutes(setHours(dayStart, WORK_END_H), WORK_END_M), 0);

  return [
    { start: morningStart, end: morningEnd },
    { start: afternoonStart, end: afternoonEnd }
  ];
}

/**
 * Normalizza una data mettendola dentro il blocco lavorativo valido più vicino,
 * guardando "all'indietro" (per la schedulazione backward).
 */
export function snapToPreviousWorkingTime(date: Date): Date {
  let snapped = new Date(date);

  // Se è weekend, porta al venerdì alle 17:00
  while (isWeekend(snapped)) {
    snapped = subDays(snapped, 1);
    snapped = setSeconds(setMinutes(setHours(snapped, WORK_END_H), WORK_END_M), 0);
  }

  const blocks = getWorkBlocksForDay(snapped);
  const morning = blocks[0];
  const afternoon = blocks[1];

  // Prima di inizio mattina -> ieri alle 17:00
  if (isBefore(snapped, morning.start)) {
    let yesterday = subDays(snapped, 1);
    while (isWeekend(yesterday)) {
      yesterday = subDays(yesterday, 1);
    }
    return setSeconds(setMinutes(setHours(yesterday, WORK_END_H), WORK_END_M), 0);
  }
  // Durante pausa pranzo -> fine mattina
  if (isAfter(snapped, morning.end) && isBefore(snapped, afternoon.start)) {
    return new Date(morning.end);
  }
  // Dopo fine lavoro -> oggi alle 17:00
  if (isAfter(snapped, afternoon.end)) {
    return new Date(afternoon.end);
  }

  return snapped;
}

/**
 * Normalizza una data mettendola dentro il blocco lavorativo valido più vicino,
 * guardando "in avanti" (per la schedulazione forward o se è finita troppo prima).
 */
export function snapToNextWorkingTime(date: Date): Date {
  let snapped = new Date(date);

  while (isWeekend(snapped)) {
    snapped = addDays(snapped, 1);
    snapped = setSeconds(setMinutes(setHours(snapped, WORK_START_H), WORK_START_M), 0);
  }

  const blocks = getWorkBlocksForDay(snapped);
  const morning = blocks[0];
  const afternoon = blocks[1];

  if (isBefore(snapped, morning.start)) return new Date(morning.start);
  if (isAfter(snapped, morning.end) && isBefore(snapped, afternoon.start)) return new Date(afternoon.start);
  if (isAfter(snapped, afternoon.end)) {
    let tomorrow = addDays(snapped, 1);
    while (isWeekend(tomorrow)) tomorrow = addDays(tomorrow, 1);
    return setSeconds(setMinutes(setHours(tomorrow, WORK_START_H), WORK_START_M), 0);
  }

  return snapped;
}

/**
 * Sottrae minuti lavorativi effettivi partendo da una data finale. (Backward Scheduling)
 */
export function subtractWorkingMinutes(endDate: Date, totalMinutes: number): Date {
  if (totalMinutes <= 0) return endDate;
  
  let current = snapToPreviousWorkingTime(endDate);
  let remainingMinutes = totalMinutes;

  while (remainingMinutes > 0) {
    const blocks = getWorkBlocksForDay(current);
    const morning = blocks[0];
    const afternoon = blocks[1];

    let currentBlock = null;

    if (current.getTime() > afternoon.start.getTime() && current.getTime() <= afternoon.end.getTime()) {
      currentBlock = afternoon;
    } else if (current.getTime() > morning.start.getTime() && current.getTime() <= morning.end.getTime()) {
      currentBlock = morning;
    } else {
      // Dovrebbe essere già snap-tato, ma per sicurezza:
      current = snapToPreviousWorkingTime(current);
      continue;
    }

    const availableMinutesInBlock = differenceInMinutes(current, currentBlock.start);

    if (remainingMinutes <= availableMinutesInBlock) {
      return new Date(current.getTime() - remainingMinutes * 60000);
    } else {
      remainingMinutes -= availableMinutesInBlock;
      // Salto al blocco precedente
      if (currentBlock === afternoon) {
        current = new Date(morning.end);
      } else {
        // Da mattina salto al giorno precedente pomeriggio
        let prevDay = subDays(current, 1);
        while (isWeekend(prevDay)) {
          prevDay = subDays(prevDay, 1);
        }
        current = setSeconds(setMinutes(setHours(prevDay, WORK_END_H), WORK_END_M), 0);
      }
    }
  }

  return current;
}

/**
 * Aggiunge minuti lavorativi effettivi partendo da una data di inizio. (Forward Scheduling)
 */
export function addWorkingMinutes(startDate: Date, totalMinutes: number): Date {
  if (totalMinutes <= 0) return startDate;

  let current = snapToNextWorkingTime(startDate);
  let remainingMinutes = totalMinutes;

  while (remainingMinutes > 0) {
    const blocks = getWorkBlocksForDay(current);
    const morning = blocks[0];
    const afternoon = blocks[1];

    let currentBlock = null;

    if (current.getTime() >= morning.start.getTime() && current.getTime() < morning.end.getTime()) {
      currentBlock = morning;
    } else if (current.getTime() >= afternoon.start.getTime() && current.getTime() < afternoon.end.getTime()) {
      currentBlock = afternoon;
    } else {
      current = snapToNextWorkingTime(current);
      continue;
    }

    const availableMinutesInBlock = differenceInMinutes(currentBlock.end, current);

    if (remainingMinutes <= availableMinutesInBlock) {
      return new Date(current.getTime() + remainingMinutes * 60000);
    } else {
      remainingMinutes -= availableMinutesInBlock;
      // Salto al blocco successivo
      if (currentBlock === morning) {
        current = new Date(afternoon.start);
      } else {
        // Da pomeriggio salto alla mattina del giorno dopo
        let nextDay = addDays(current, 1);
        while (isWeekend(nextDay)) {
          nextDay = addDays(nextDay, 1);
        }
        current = setSeconds(setMinutes(setHours(nextDay, WORK_START_H), WORK_START_M), 0);
      }
    }
  }

  return current;
}
