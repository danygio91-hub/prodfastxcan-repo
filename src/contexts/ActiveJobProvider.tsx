
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { JobOrder, WorkGroup, Operator } from '@/types';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/components/auth/AuthProvider';


interface ActiveJobContextType {
  activeJob: JobOrder | null;
  setActiveJob: (job: JobOrder | null) => void;
  setActiveJobId: (jobId: string | null) => void;
  isLoading: boolean;
  isStatusBarHighlighted: boolean;
  setIsStatusBarHighlighted: (isHighlighted: boolean) => void;
  refreshJob: () => void;
  hasPendingUpdates: boolean;
  clearUpdatesIndicator: () => void;
}



const ActiveJobContext = createContext<ActiveJobContextType | undefined>(undefined);

export const ActiveJobProvider = ({ children }: { children: ReactNode }) => {
  const [activeJob, setActiveJobState] = useState<JobOrder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { operator, loading: authLoading } = useAuth();
  const [isStatusBarHighlighted, setIsStatusBarHighlightedState] = useState(false);
  const [hasPendingUpdates, setHasPendingUpdates] = useState(false);
  const syncPulseRef = React.useRef<number | undefined>(operator?.syncPulse);

  
  // The source of truth for the active job ID is now the operator context
  const activeJobId = operator?.activeJobId || null;

  const setActiveJobId = useCallback(async (jobId: string | null) => {
    if (!operator) return;
    try {
        const operatorRef = doc(db, "operators", operator.id);
        await updateDoc(operatorRef, { activeJobId: jobId || null });
        // The onSnapshot listener in AuthProvider will handle the state update.
    } catch (error) {
        console.error("Failed to update active job ID on operator profile", error);
    }
  }, [operator]);


  const [refreshKey, setRefreshKey] = useState(0);

  const fetchJobById = useCallback(async (id: string) => {
    setIsLoading(true);
    try {
        const isWorkGroup = id.startsWith('group-');
        const collectionName = isWorkGroup ? 'workGroups' : 'jobOrders';
        const jobRef = doc(db, collectionName, id);
        const docSnap = await getDoc(jobRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const jobWithDates: any = JSON.parse(JSON.stringify(data), (key, value) => {
                 if ((key === 'start' || key === 'end' || key === 'overallStartTime' || key === 'overallEndTime' || key === 'odlCreationDate' || key === 'createdAt') && value && value.seconds !== undefined) {
                    return new Date(value.seconds * 1000);
                 }
                 return value;
            });
            
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
                  jobOrderIds: jobWithDates.jobOrderIds || [],
                  jobOrderPFs: jobWithDates.jobOrderPFs || [],
                  overallStartTime: jobWithDates.overallStartTime,
                  overallEndTime: jobWithDates.overallEndTime,
                  isProblemReported: jobWithDates.isProblemReported,
                  problemType: jobWithDates.problemType,
                  problemNotes: jobWithDates.problemNotes,
                  problemReportedBy: jobWithDates.problemReportedBy,
              }
              : jobWithDates;

            setActiveJobState(jobToSet);
        } else {
            setActiveJobId(null);
            setActiveJobState(null);
        }
    } catch (error) {
        console.error("Error fetching active job:", error);
    } finally {
        setIsLoading(false);
    }
  }, [setActiveJobId]);

  const refreshJob = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  // Update context type to include refreshJob
  // ... (this will be handled by updating the interface)

  useEffect(() => {
    if (authLoading) {
      setIsLoading(true);
      return;
    }

    if (!activeJobId) {
        setActiveJobState(null);
        setIsLoading(false);
        return;
    }
    
    fetchJobById(activeJobId);
  }, [activeJobId, fetchJobById, authLoading, refreshKey]);

  
  const setActiveJob = useCallback((job: JobOrder | null) => {
    setActiveJobState(job);
  }, []);

  const setIsStatusBarHighlighted = (isHighlighted: boolean) => {
    setIsStatusBarHighlightedState(isHighlighted);
    if (isHighlighted) {
        setTimeout(() => setIsStatusBarHighlightedState(false), 3000); // Auto-remove highlight after 3s
    }
  };

  const clearUpdatesIndicator = useCallback(() => {
    setHasPendingUpdates(false);
    if (operator) syncPulseRef.current = operator.syncPulse;
  }, [operator]);

  // Effect to watch for syncPulse from admin
  useEffect(() => {
    if (!operator || authLoading) return;
    
    // Initial mount or session change
    if (syncPulseRef.current === undefined) {
      syncPulseRef.current = operator.syncPulse;
      return;
    }
    
    // Pulse detected
    if (operator.syncPulse && operator.syncPulse !== syncPulseRef.current) {
        setHasPendingUpdates(true);
        syncPulseRef.current = operator.syncPulse;
    }
  }, [operator?.syncPulse, authLoading]);


  return (
    <ActiveJobContext.Provider value={{ 
      activeJob, 
      setActiveJob, 
      setActiveJobId, 
      isLoading, 
      isStatusBarHighlighted, 
      setIsStatusBarHighlighted, 
      refreshJob,
      hasPendingUpdates,
      clearUpdatesIndicator
    }}>

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
