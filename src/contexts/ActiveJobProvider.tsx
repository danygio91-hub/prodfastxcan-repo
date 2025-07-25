
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { JobOrder } from '@/lib/mock-data';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@/components/auth/AuthProvider';

const ACTIVE_JOB_ID_STORAGE_KEY_PREFIX = 'prodtime_tracker_active_job_id_';

interface ActiveJobContextType {
  activeJob: JobOrder | null;
  setActiveJob: (job: JobOrder | null) => void;
  setActiveJobId: (jobId: string | null) => void;
  isLoading: boolean;
}

const ActiveJobContext = createContext<ActiveJobContextType | undefined>(undefined);

export const ActiveJobProvider = ({ children }: { children: ReactNode }) => {
  const [activeJob, setActiveJobState] = useState<JobOrder | null>(null);
  const [activeJobId, setActiveJobIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { operator, loading: authLoading } = useAuth();

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


  // Effect to listen for real-time updates on the active job
  useEffect(() => {
    if (!activeJobId) {
        setActiveJobState(null);
        setIsLoading(false);
        return;
    }
    
    setIsLoading(true);
    const jobRef = doc(db, "jobOrders", activeJobId);

    const unsubscribe = onSnapshot(jobRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const jobWithDates: JobOrder = JSON.parse(JSON.stringify(data), (key, value) => {
                 if ((key === 'start' || key === 'end' || key === 'overallStartTime' || key === 'overallEndTime' || key === 'odlCreationDate') && value && value.seconds !== undefined) {
                    return new Date(value.seconds * 1000);
                 }
                 return value;
            });
            
            // If the job is no longer in a workable state, clear it.
            if (jobWithDates.status !== 'production' && jobWithDates.status !== 'suspended') {
                 setActiveJobId(null); // This will also clear the local storage
                 setActiveJobState(null);
            } else {
                 setActiveJobState(jobWithDates);
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
  }, [activeJobId]);


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
  
  const setActiveJob = useCallback((job: JobOrder | null) => {
    setActiveJobState(job);
  }, []);

  return (
    <ActiveJobContext.Provider value={{ activeJob, setActiveJob, setActiveJobId, isLoading }}>
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
