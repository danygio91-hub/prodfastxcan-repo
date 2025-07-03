
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

const ACTIVE_MATERIAL_SESSION_KEY = 'prodtime_tracker_active_material_session';

export interface ActiveMaterialSessionData {
    materialId: string;
    materialCode: string;
    openingWeight: number;
    originatorJobId: string;
    associatedJobs: { jobId: string; jobOrderPF: string }[];
}

interface ActiveMaterialSessionContextType {
  activeSession: ActiveMaterialSessionData | null;
  startSession: (sessionData: ActiveMaterialSessionData) => void;
  addJobToSession: (job: { jobId: string; jobOrderPF: string }) => void;
  clearSession: () => void;
  isLoading: boolean;
}

const ActiveMaterialSessionContext = createContext<ActiveMaterialSessionContextType | undefined>(undefined);

export const ActiveMaterialSessionProvider = ({ children }: { children: ReactNode }) => {
  const [activeSession, setActiveSession] = useState<ActiveMaterialSessionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const storedSession = localStorage.getItem(ACTIVE_MATERIAL_SESSION_KEY);
      if (storedSession) {
        setActiveSession(JSON.parse(storedSession));
      }
    } catch (error) {
      console.error("Failed to load active material session from localStorage", error);
      localStorage.removeItem(ACTIVE_MATERIAL_SESSION_KEY);
    }
    setIsLoading(false);
  }, []);

  const persistSession = (session: ActiveMaterialSessionData | null) => {
    try {
        if (session) {
            localStorage.setItem(ACTIVE_MATERIAL_SESSION_KEY, JSON.stringify(session));
        } else {
            localStorage.removeItem(ACTIVE_MATERIAL_SESSION_KEY);
        }
    } catch (error) {
        console.error("Failed to save active material session to localStorage", error);
    }
  }

  const startSession = useCallback((sessionData: ActiveMaterialSessionData) => {
    setActiveSession(sessionData);
    persistSession(sessionData);
  }, []);

  const addJobToSession = useCallback((job: { jobId: string; jobOrderPF: string }) => {
    setActiveSession(prevSession => {
        if (!prevSession) return null;
        
        // Avoid adding duplicates
        if (prevSession.associatedJobs.some(j => j.jobId === job.jobId)) {
            return prevSession;
        }

        const updatedSession = {
            ...prevSession,
            associatedJobs: [...prevSession.associatedJobs, job],
        };
        persistSession(updatedSession);
        return updatedSession;
    });
  }, []);

  const clearSession = useCallback(() => {
    setActiveSession(null);
    persistSession(null);
  }, []);

  return (
    <ActiveMaterialSessionContext.Provider value={{ activeSession, startSession, addJobToSession, clearSession, isLoading }}>
      {children}
    </ActiveMaterialSessionContext.Provider>
  );
};

export const useActiveMaterialSession = (): ActiveMaterialSessionContextType => {
  const context = useContext(ActiveMaterialSessionContext);
  if (context === undefined) {
    throw new Error('useActiveMaterialSession must be used within an ActiveMaterialSessionProvider');
  }
  return context;
};

