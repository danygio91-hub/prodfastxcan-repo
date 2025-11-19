

"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { JobOrder, WorkGroup, Operator } from '@/lib/mock-data';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/components/auth/AuthProvider';

interface ActiveJobContextType {
  activeJob: JobOrder | null;
  setActiveJob: (job: JobOrder | null) => void;
  setActiveJobId: (jobId: string | null) => void;
  isLoading: boolean;
  isStatusBarHighlighted: boolean;
  setIsStatusBarHighlighted: (isHighlighted: boolean) => void;
}

const ActiveJobContext = createContext<ActiveJobContextType | undefined>(undefined);

export const ActiveJobProvider = ({ children }: { children: ReactNode }) => {
  const [activeJob, setActiveJobState] = useState<JobOrder | null>(null);
  const [activeJobId, setActiveJobIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { operator, loading: authLoading } = useAuth();
  const [isStatusBarHighlighted, setIsStatusBarHighlightedState] = useState(false);

  // This effect listens for changes on the operator's document in Firestore.
  // When activeJobId on the operator doc changes, it updates the local state.
  useEffect(() => {
    if (authLoading || !operator) {
      setIsLoading(false);
      setActiveJobIdState(null);
      setActiveJobState(null);
      return;
    }

    const operatorRef = doc(db, 'operators', operator.id);
    const unsubscribe = onSnapshot(operatorRef, (docSnap) => {
      if (docSnap.exists()) {
        const operatorData = docSnap.data() as Operator;
        // The source of truth for the active job ID is now the operator document.
        setActiveJobIdState(operatorData.activeJobId || null);
      } else {
        // If the operator doc is somehow deleted, clear the state.
        setActiveJobIdState(null);
      }
    }, (error) => {
      console.error("Error listening to operator document:", error);
    });

    return () => unsubscribe();
  }, [operator, authLoading]);

  const setActiveJobId = useCallback(async (jobId: string | null) => {
    if (!operator) return;
    try {
        const operatorRef = doc(db, "operators", operator.id);
        await updateDoc(operatorRef, { activeJobId: jobId || null });
        // The listener above will handle the state update.
    } catch (error) {
        console.error("Failed to update active job ID on operator profile", error);
    }
  }, [operator]);


  // This effect listens for real-time updates on the active job
  useEffect(() => {
    if (!activeJobId) {
        setActiveJobState(null);
        setIsLoading(false);
        return;
    }
    
    setIsLoading(true);
    
    const isWorkGroup = activeJobId.startsWith('group-');
    const collectionName = isWorkGroup ? 'workGroups' : 'jobOrders';
    const jobRef = doc(db, collectionName, activeJobId);

    const unsubscribe = onSnapshot(jobRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const jobWithDates: any = JSON.parse(JSON.stringify(data), (key, value) => {
                 if ((key === 'start' || key === 'end' || key === 'overallStartTime' || key === 'overallEndTime' || key === 'odlCreationDate' || key === 'createdAt') && value && value.seconds !== undefined) {
                    return new Date(value.seconds * 1000);
                 }
                 return value;
            });
            
             // For a group, we create a synthetic JobOrder-like object for the context
            const jobToSet: JobOrder = isWorkGroup 
              ? {
                  id: docSnap.id,
                  ordinePF: jobWithDates.jobOrderPFs?.join(', ') || 'Gruppo',
                  qta: jobWithDates.totalQuantity || 0,
                  cliente: jobWithDates.cliente,
                  department: jobWithDates.department,
                  details: jobWithDates.details,
                  numeroODLInterno: jobWithDates.numeroODLInterno,
                  numeroODL: jobWithDates.numeroODL,
                  dataConsegnaFinale: jobWithDates.dataConsegnaFinale,
                  postazioneLavoro: 'Multi-Commessa',
                  phases: jobWithDates.phases || [],
                  status: jobWithDates.status,
                  workCycleId: jobWithDates.workCycleId,
                  workGroupId: docSnap.id,
                  overallStartTime: jobWithDates.overallStartTime,
                  overallEndTime: jobWithDates.overallEndTime,
                  isProblemReported: jobWithDates.isProblemReported,
                  problemType: jobWithDates.problemType,
                  problemNotes: jobWithDates.problemNotes,
                  problemReportedBy: jobWithDates.problemReportedBy,
              }
              : jobWithDates;


            // If the job is no longer in a workable state, clear it.
            // This now allows completed jobs to be shown until explicitly cleared.
            if (!['production', 'suspended', 'paused', 'completed'].includes(jobToSet.status)) {
                 setActiveJobId(null);
                 setActiveJobState(null);
            } else {
                 setActiveJobState(jobToSet);
            }
        } else {
            // Document was deleted or doesn't exist.
            setActiveJobId(null);
            setActiveJobState(null);
        }
        setIsLoading(false);
    }, (error) => {
        console.error("Error listening to active job:", error);
        setIsLoading(false);
    });

    return () => unsubscribe();
  }, [activeJobId, setActiveJobId]);
  
  const setActiveJob = useCallback((job: JobOrder | null) => {
    setActiveJobState(job);
  }, []);

  const setIsStatusBarHighlighted = (isHighlighted: boolean) => {
    setIsStatusBarHighlightedState(isHighlighted);
    if (isHighlighted) {
        setTimeout(() => setIsStatusBarHighlightedState(false), 3000); // Auto-remove highlight after 3s
    }
  };

  return (
    <ActiveJobContext.Provider value={{ activeJob, setActiveJob, setActiveJobId, isLoading, isStatusBarHighlighted, setIsStatusBarHighlighted }}>
      {children}
    </ActiveJobContext.Provider>
  );
};

export const useActiveJob = (): ActiveJobContextType => {
  const context = useContext(ActiveJobContext);
  if (context === undefined) {
    throw new Error('useActiveJob must be used within an ActiveJobProvider');
  }
  return context;
};
