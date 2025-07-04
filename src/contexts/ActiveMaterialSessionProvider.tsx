"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

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
    const validateActiveSession = async () => {
        try {
            const storedSession = localStorage.getItem(ACTIVE_MATERIAL_SESSION_KEY);
            if (storedSession) {
                const parsedSession: ActiveMaterialSessionData = JSON.parse(storedSession);

                // A session is only valid if its originating job still exists.
                if (parsedSession.originatorJobId) {
                    const jobRef = doc(db, "jobOrders", parsedSession.originatorJobId);
                    const docSnap = await getDoc(jobRef);

                    if (docSnap.exists()) {
                        setActiveSession(parsedSession);
                    } else {
                        // Originating job was deleted, so the session is invalid.
                        localStorage.removeItem(ACTIVE_MATERIAL_SESSION_KEY);
                        setActiveSession(null);
                    }
                } else {
                    // Data is malformed, clear it
                    localStorage.removeItem(ACTIVE_MATERIAL_SESSION_KEY);
                    setActiveSession(null);
                }
            }
        } catch (error) {
            console.error("Failed to load or validate active material session from localStorage", error);
            localStorage.removeItem(ACTIVE_MATERIAL_SESSION_KEY);
            setActiveSession(null);
        } finally {
            setIsLoading(false);
        }
    };
    validateActiveSession();
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
