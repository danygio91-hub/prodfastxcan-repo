
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { ActiveMaterialSessionData, MaterialSessionCategory, RawMaterialType } from '@/lib/mock-data';

const ACTIVE_MATERIAL_SESSION_KEY = 'prodtime_tracker_active_material_sessions'; // Pluralized

interface ActiveMaterialSessionContextType {
  activeSessions: ActiveMaterialSessionData[];
  startSession: (sessionData: Omit<ActiveMaterialSessionData, 'category'>, type: RawMaterialType) => void;
  addJobToSession: (job: { jobId: string; jobOrderPF: string }) => void;
  closeSession: (materialId: string) => void;
  getSessionForType: (type: RawMaterialType) => ActiveMaterialSessionData | undefined;
  isLoading: boolean;
}

const ActiveMaterialSessionContext = createContext<ActiveMaterialSessionContextType | undefined>(undefined);

function getMaterialCategory(type: RawMaterialType): MaterialSessionCategory {
  if (type === 'BOB' || type === 'PF3V0') return 'TRECCIA';
  if (type === 'TUBI') return 'TUBI';
  if (type === 'GUAINA') return 'GUAINA';
  // Fallback for safety, though should ideally not be reached with proper checks
  console.warn(`Unknown material type received for session category: ${type}`);
  return 'TRECCIA';
}

export const ActiveMaterialSessionProvider = ({ children }: { children: ReactNode }) => {
  const [activeSessions, setActiveSessions] = useState<ActiveMaterialSessionData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const validateActiveSessions = async () => {
        try {
            const storedSessions = localStorage.getItem(ACTIVE_MATERIAL_SESSION_KEY);
            if (storedSessions) {
                const parsedSessions: ActiveMaterialSessionData[] = JSON.parse(storedSessions);
                const validSessions: ActiveMaterialSessionData[] = [];

                for (const session of parsedSessions) {
                    if (session.originatorJobId) {
                        const jobRef = doc(db, "jobOrders", session.originatorJobId);
                        const docSnap = await getDoc(jobRef);
                        if (docSnap.exists()) {
                            validSessions.push(session);
                        }
                    }
                }
                setActiveSessions(validSessions);
            }
        } catch (error) {
            console.error("Failed to load or validate active material sessions from localStorage", error);
            localStorage.removeItem(ACTIVE_MATERIAL_SESSION_KEY);
            setActiveSessions([]);
        } finally {
            setIsLoading(false);
        }
    };
    validateActiveSessions();
  }, []);

  const persistSessions = (sessions: ActiveMaterialSessionData[]) => {
    try {
        if (sessions.length > 0) {
            localStorage.setItem(ACTIVE_MATERIAL_SESSION_KEY, JSON.stringify(sessions));
        } else {
            localStorage.removeItem(ACTIVE_MATERIAL_SESSION_KEY);
        }
    } catch (error) {
        console.error("Failed to save active material sessions to localStorage", error);
    }
  }

  const startSession = useCallback((sessionData: Omit<ActiveMaterialSessionData, 'category'>, type: RawMaterialType) => {
    const category = getMaterialCategory(type);
    
    setActiveSessions(prevSessions => {
        const categoryExists = prevSessions.some(s => s.category === category);
        if (categoryExists) {
            // This should be caught earlier in the UI, but as a safeguard:
            throw new Error(`Una sessione per la categoria '${category}' è già attiva.`);
        }
        
        const newSession: ActiveMaterialSessionData = { ...sessionData, category };
        const updatedSessions = [...prevSessions, newSession];
        persistSessions(updatedSessions);
        return updatedSessions;
    });
  }, []);

  const addJobToSession = useCallback((job: { jobId: string; jobOrderPF: string }) => {
    setActiveSessions(prevSessions => {
        if (prevSessions.length === 0) return prevSessions;
        
        const updatedSessions = prevSessions.map(session => {
            if (session.associatedJobs.some(j => j.jobId === job.jobId)) {
                return session; // Job already associated
            }
            return {
                ...session,
                associatedJobs: [...session.associatedJobs, job],
            };
        });
        persistSessions(updatedSessions);
        return updatedSessions;
    });
  }, []);

  const closeSession = useCallback((materialId: string) => {
    setActiveSessions(prevSessions => {
        const updatedSessions = prevSessions.filter(s => s.materialId !== materialId);
        persistSessions(updatedSessions);
        return updatedSessions;
    });
  }, []);

  const getSessionForType = useCallback((type: RawMaterialType): ActiveMaterialSessionData | undefined => {
    const category = getMaterialCategory(type);
    return activeSessions.find(s => s.category === category);
  }, [activeSessions]);


  return (
    <ActiveMaterialSessionContext.Provider value={{ activeSessions, startSession, addJobToSession, closeSession, getSessionForType, isLoading }}>
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
