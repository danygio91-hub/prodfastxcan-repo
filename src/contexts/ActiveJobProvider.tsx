

"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { JobOrder } from '@/lib/mock-data';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, collection } from 'firebase/firestore';
import { useAuth } from '@/components/auth/AuthProvider';

const ACTIVE_JOB_ID_STORAGE_KEY_PREFIX = 'prodtime_tracker_active_job_id_';

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

  // Effect to load the active job ID from local storage when the operator logs in
  useEffect(() => {
    if (authLoading) return;
    if (!operator) {
      setActiveJobIdState(null);
      setActiveJobState(null);
      setIsLoading(false);
      return;
    }

    const storageKey = `${ACTIVE_JOB_ID_STORAGE_KEY_PREFIX}${operator.id}`;
    const storedJobId = localStorage.getItem(storageKey);
    setActiveJobIdState(storedJobId);
  }, [operator, authLoading]);

  const setActiveJobId = useCallback((jobId: string | null) => {
    if (!operator) return; 

    setActiveJobIdState(jobId);
    try {
      const storageKey = `${ACTIVE_JOB_ID_STORAGE_KEY_PREFIX}${operator.id}`;
      if (jobId) {
        localStorage.setItem(storageKey, jobId);
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.error("Failed to save active job ID to localStorage", error);
    }
  }, [operator]);

  // Effect to listen for real-time updates on the active job
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
            const jobWithDates: JobOrder = JSON.parse(JSON.stringify(data), (key, value) => {
                 if ((key === 'start' || key === 'end' || key === 'overallStartTime' || key === 'overallEndTime' || key === 'odlCreationDate' || key === 'createdAt') && value && value.seconds !== undefined) {
                    return new Date(value.seconds * 1000);
                 }
                 return value;
            });
            
             // For a group, we create a synthetic JobOrder-like object for the context
            const jobToSet: JobOrder = isWorkGroup 
              ? {
                  ...jobWithDates,
                  id: docSnap.id,
                  ordinePF: jobWithDates.jobOrderPFs?.join(', ') || 'Gruppo',
                  qta: jobWithDates.totalQuantity || 0,
              }
              : jobWithDates;


            // If the job is no longer in a workable state, clear it.
            if (jobToSet.status !== 'production' && jobToSet.status !== 'suspended') {
                 setActiveJobId(null); // This will also clear the local storage
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
