
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { JobOrder } from '@/lib/mock-data';

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
    try {
      const storedJob = localStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
      if (storedJob) {
        // We need to parse dates correctly from JSON string
        const parsedJob = JSON.parse(storedJob, (key, value) => {
            if (key === 'start' || key === 'end' || key === 'overallStartTime' || key === 'overallEndTime') {
                return value ? new Date(value) : null;
            }
            return value;
        });
        setActiveJobState(parsedJob);
      }
    } catch (error) {
      console.error("Failed to load active job from localStorage", error);
      localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
    }
    setIsLoading(false);
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
