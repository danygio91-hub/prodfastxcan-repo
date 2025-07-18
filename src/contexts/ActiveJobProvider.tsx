
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { JobOrder } from '@/lib/mock-data';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/components/auth/AuthProvider';

const ACTIVE_JOB_STORAGE_KEY_PREFIX = 'prodtime_tracker_active_job_';

interface ActiveJobContextType {
  activeJob: JobOrder | null;
  setActiveJob: (job: JobOrder | null) => void;
  isLoading: boolean;
}

const ActiveJobContext = createContext<ActiveJobContextType | undefined>(undefined);

export const ActiveJobProvider = ({ children }: { children: ReactNode }) => {
  const [activeJob, setActiveJobState] = useState<JobOrder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { operator, loading: authLoading } = useAuth();

  useEffect(() => {
    const validateActiveJob = async () => {
        if (authLoading) return; // Wait for auth to be ready
        if (!operator) {
            // No operator logged in, so no active job to load
            setActiveJobState(null);
            setIsLoading(false);
            return;
        }

        try {
            const storageKey = `${ACTIVE_JOB_STORAGE_KEY_PREFIX}${operator.id}`;
            const storedJob = localStorage.getItem(storageKey);
            if (storedJob) {
                const parsedJob: JobOrder = JSON.parse(storedJob, (key, value) => {
                    if (['start', 'end', 'overallStartTime', 'overallEndTime', 'odlCreationDate'].includes(key) && value) {
                        return new Date(value);
                    }
                    return value;
                });

                // Verify the job still exists in Firestore and is in a workable state
                const jobRef = doc(db, "jobOrders", parsedJob.id);
                const docSnap = await getDoc(jobRef);

                if (docSnap.exists() && (docSnap.data().status === 'production' || docSnap.data().status === 'suspended')) {
                    // Job is valid, update state with the one from localStorage (it might have live progress)
                    setActiveJobState(parsedJob);
                } else {
                    // Job has been deleted or is completed, clear it from local state
                    localStorage.removeItem(storageKey);
                    setActiveJobState(null);
                }
            } else {
                // No job in storage for this operator
                setActiveJobState(null);
            }
        } catch (error) {
            console.error("Failed to load or validate active job from localStorage", error);
            if (operator) {
                localStorage.removeItem(`${ACTIVE_JOB_STORAGE_KEY_PREFIX}${operator.id}`);
            }
            setActiveJobState(null);
        } finally {
            setIsLoading(false);
        }
    };

    validateActiveJob();
  }, [operator, authLoading]);

  const setActiveJob = useCallback((job: JobOrder | null) => {
    // This function can only be called when an operator is logged in
    if (!operator) return; 

    setActiveJobState(job);
    try {
      const storageKey = `${ACTIVE_JOB_STORAGE_KEY_PREFIX}${operator.id}`;
      if (job) {
        localStorage.setItem(storageKey, JSON.stringify(job));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.error("Failed to save active job to localStorage", error);
    }
  }, [operator]);

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
