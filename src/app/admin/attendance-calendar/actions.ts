'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { CalendarException } from '@/types';
import { ensureAdmin } from '@/lib/server-auth';
import { startOfWeek, endOfWeek, eachDayOfInterval, format, isWithinInterval, parseISO, startOfDay, endOfDay, addWeeks } from 'date-fns';
import { it } from 'date-fns/locale';
import { getWorkingHoursConfig } from '../working-hours/actions';
import { getOperators } from '../operator-management/actions';
import { isItalianHoliday } from '@/lib/holiday-utils';

export async function getCalendarExceptions(): Promise<CalendarException[]> {
  const snapshot = await adminDb.collection("calendarExceptions").orderBy("startDate", "desc").get();
  return snapshot.docs.map(d => ({
    ...d.data(),
    id: d.id,
    createdAt: (d.data().createdAt as admin.firestore.Timestamp)?.toDate().toISOString() || null
  } as CalendarException));
}

/**
 * Saves a new calendar exception.
 * createdBy is populated server-side from the auth UID.
 */
export async function saveCalendarException(data: Omit<CalendarException, 'id' | 'createdAt' | 'createdBy'>, uid: string) {
  try {
    await ensureAdmin(uid);
    const newId = `exc-${Date.now()}`;
    const docRef = adminDb.collection("calendarExceptions").doc(newId);
    
    const fullData = {
      ...data,
      id: newId,
      createdAt: admin.firestore.Timestamp.now(),
      createdBy: uid,
    };

    await docRef.set(fullData);
    revalidatePath('/admin/attendance-calendar');
    return { success: true, message: 'Eccezione registrata con successo.' };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Errore salvataggio.' };
  }
}

export async function deleteCalendarException(id: string, uid: string) {
  try {
    await ensureAdmin(uid);
    await adminDb.collection("calendarExceptions").doc(id).delete();
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

export async function getWeeklyCapacityReport(targetDateIso: string, weeks: number = 1): Promise<OperatorCapacity[]> {
    const referenceDate = targetDateIso ? parseISO(targetDateIso) : new Date();
    const start = startOfWeek(referenceDate, { weekStartsOn: 1 });
    const end = endOfWeek(addWeeks(start, weeks - 1), { weekStartsOn: 1 });
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
                const holidayCheck = isItalianHoliday(day);
                
                const dayExceptions = exceptions.filter(ex => 
                    (ex.targetId === op.id || ex.resourceType === 'company') && 
                    isWithinInterval(day, { 
                        start: startOfDay(parseISO(ex.startDate)), 
                        end: endOfDay(parseISO(ex.endDate)) 
                    })
                );

                let effectiveHours = (isWorkingDay && !holidayCheck.isHoliday) ? dailyEffectiveHours : 0;
                
                // Add holiday as a virtual exception for display if needed
                if (holidayCheck.isHoliday) {
                    dayExceptions.push({
                        id: `holiday-${dateStr}`,
                        resourceType: 'company',
                        targetId: 'all',
                        targetName: 'Azienda',
                        exceptionType: 'other',
                        startDate: dateStr,
                        endDate: dateStr,
                        notes: holidayCheck.name,
                        createdAt: new Date().toISOString(),
                        createdBy: 'system'
                    });
                }
                
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

export async function checkAttendanceDeclared(dateStr: string): Promise<boolean> {
    const doc = await adminDb.collection("attendanceDeclarations").doc(dateStr).get();
    return doc.exists;
}

export async function bulkDeclareAttendance(dateStr: string, uid: string, operatorStatuses: { operatorId: string, operatorName: string, isPresent: boolean, reason?: string }[]) {
    try {
        await ensureAdmin(uid);
        
        // 1. Create exceptions for absent operators ONLY if they don't already have one
        const absentOperators = operatorStatuses.filter(os => !os.isPresent);
        const existingExceptions = await getCalendarExceptions();
        
        for (const os of absentOperators) {
            const alreadyException = existingExceptions.some(ex => 
                ex.targetId === os.operatorId && 
                ex.startDate === dateStr && ex.endDate === dateStr
            );

            if (!alreadyException) {
                await saveCalendarException({
                    resourceType: 'operator',
                    targetId: os.operatorId,
                    targetName: os.operatorName,
                    exceptionType: (os.reason as any) || 'vacation',
                    startDate: dateStr,
                    endDate: dateStr,
                    notes: `Dichiarato da foglio presenze giornaliero`
                }, uid);
            }
        }


        // 2. Mark day as declared
        await adminDb.collection("attendanceDeclarations").doc(dateStr).set({
            declaredAt: admin.firestore.Timestamp.now(),
            declaredBy: uid,
            totalOperators: operatorStatuses.length,
            absentCount: absentOperators.length
        });

        revalidatePath('/admin/dashboard');
        revalidatePath('/admin/attendance-calendar');
        return { success: true };
    } catch (error) {
        console.error("Bulk declare error:", error);
        return { success: false, message: 'Errore durante la dichiarazione massiva.' };
    }
}
