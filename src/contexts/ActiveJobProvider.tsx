"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { JobOrder } from '@/lib/mock-data';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

const ACTIVE_JOB_STORAGE_KEY = 'prodtime_tracker_active_job';

interface ActiveJobContextType {
  activeJob: JobOrder | null;
  setActiveJob: (job: JobOrder | null) => void;
  isLoading: boolean;
}

const ActiveJobContext = createContext<ActiveJobContextType | undefined>(undefined);

export const ActiveJobProvider = ({ children }: { children: ReactNode }) => {
  const [activeJob, setActiveJobState] = useState<JobOrder | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const validateActiveJob = async () => {
        try {
            const storedJob = localStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
            if (storedJob) {
                const parsedJob: JobOrder = JSON.parse(storedJob, (key, value) => {
                    if (['start', 'end', 'overallStartTime', 'overallEndTime'].includes(key) && value) {
                        return new Date(value);
                    }
                    return value;
                });

                // Verify the job still exists in Firestore
                const jobRef = doc(db, "jobOrders", parsedJob.id);
                const docSnap = await getDoc(jobRef);

                if (docSnap.exists()) {
                    // Job is valid, update state with the one from localStorage (it might have live progress)
                    setActiveJobState(parsedJob);
                } else {
                    // Job has been deleted from the database, clear it from local state
                    localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
                    setActiveJobState(null);
                }
            }
        } catch (error) {
            console.error("Failed to load or validate active job from localStorage", error);
            localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
            setActiveJobState(null);
        } finally {
            setIsLoading(false);
        }
    };

    validateActiveJob();
  }, []);

  const setActiveJob = useCallback((job: JobOrder | null) => {
    setActiveJobState(job);
    try {
      if (job) {
        localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify(job));
      } else {
        localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
      }
    } catch (error) {
      console.error("Failed to save active job to localStorage", error);
    }
  }, []);

  return (
    <ActiveJobContext.Provider value={{ activeJob, setActiveJob, isLoading }}>
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
