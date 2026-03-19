
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, setDoc, deleteDoc, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { CalendarException } from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';
import { startOfWeek, endOfWeek, eachDayOfInterval, format, isWithinInterval, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { getWorkingHoursConfig } from '../working-hours/actions';
import { getOperators } from '../operator-management/actions';

export async function getCalendarExceptions(): Promise<CalendarException[]> {
  const col = collection(db, "calendarExceptions");
  const q = query(col, orderBy("startDate", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({
    ...d.data(),
    id: d.id,
    createdAt: d.data().createdAt?.toDate().toISOString() || null
  } as CalendarException));
}

export async function saveCalendarException(data: Omit<CalendarException, 'id' | 'createdAt' | 'createdBy'>, uid: string) {
  try {
    await ensureAdmin(uid);
    const newId = `exc-${Date.now()}`;
    const docRef = doc(db, "calendarExceptions", newId);
    
    const fullData = {
      ...data,
      createdAt: Timestamp.now(),
      createdBy: uid,
    };

    await setDoc(docRef, fullData);
    revalidatePath('/admin/attendance-calendar');
    return { success: true, message: 'Eccezione registrata con successo.' };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Errore salvataggio.' };
  }
}

export async function deleteCalendarException(id: string, uid: string) {
  try {
    await ensureAdmin(uid);
    await deleteDoc(doc(db, "calendarExceptions", id));
    revalidatePath('/admin/attendance-calendar');
    return { success: true, message: 'Eccezione eliminata.' };
  } catch (error) {
    return { success: false, message: 'Errore durante l\'eliminazione.' };
  }
}

export type DailyCapacity = {
    date: string;
    dayName: string;
    isWorkingDay: boolean;
    standardHours: number;
    effectiveHours: number;
    exceptions: CalendarException[];
};

export type OperatorCapacity = {
    operatorId: string;
    operatorName: string;
    dailyCapacities: DailyCapacity[];
    totalWeeklyHours: number;
};

export async function getWeeklyCapacityReport(targetDateIso: string): Promise<OperatorCapacity[]> {
    const referenceDate = targetDateIso ? parseISO(targetDateIso) : new Date();
    const start = startOfWeek(referenceDate, { weekStartsOn: 1 });
    const end = endOfWeek(referenceDate, { weekStartsOn: 1 });
    const daysInWeek = eachDayOfInterval({ start, end });

    const [config, operators, exceptions] = await Promise.all([
        getWorkingHoursConfig(),
        getOperators(),
        getCalendarExceptions()
    ]);

    let dailyStandardMinutes = 0;
    config.shifts.forEach(shift => {
        const [startH, startM] = shift.startTime.split(':').map(Number);
        const [endH, endM] = shift.endTime.split(':').map(Number);
        const diff = (endH * 60 + endM) - (startH * 60 + startM);
        dailyStandardMinutes += Math.max(0, diff - (shift.breakMinutes || 0));
    });

    const efficiencyFactor = (config.efficiencyPercentage || 100) / 100;
    const dailyEffectiveHours = (dailyStandardMinutes / 60) * efficiencyFactor;

    const report: OperatorCapacity[] = operators
        .filter(op => op.role !== 'admin' && op.isReal !== false)
        .map(op => {
            let totalWeeklyHours = 0;
            const dailyCapacities: DailyCapacity[] = daysInWeek.map(day => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const dayOfWeek = day.getDay() === 0 ? 7 : day.getDay();
                const isWorkingDay = config.workingDays.includes(dayOfWeek);
                
                const dayExceptions = exceptions.filter(ex => 
                    ex.targetId === op.id && 
                    isWithinInterval(day, { 
                        start: startOfDay(parseISO(ex.startDate)), 
                        end: endOfDay(parseISO(ex.endDate)) 
                    })
                );

                let effectiveHours = isWorkingDay ? dailyEffectiveHours : 0;
                
                dayExceptions.forEach(ex => {
                    if (ex.hoursLost !== undefined && ex.hoursLost !== null) {
                        effectiveHours = Math.max(0, effectiveHours - ex.hoursLost);
                    } else {
                        effectiveHours = 0;
                    }
                });

                totalWeeklyHours += effectiveHours;

                return {
                    date: dateStr,
                    dayName: format(day, 'EEEE', { locale: it }),
                    isWorkingDay,
                    standardHours: isWorkingDay ? dailyStandardMinutes / 60 : 0,
                    effectiveHours,
                    exceptions: dayExceptions
                };
            });

            return {
                operatorId: op.id,
                operatorName: op.nome,
                dailyCapacities,
                totalWeeklyHours
            };
        });

    return JSON.parse(JSON.stringify(report));
}

function startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}
