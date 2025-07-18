
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { ActiveMaterialSessionData, MaterialSessionCategory, RawMaterialType } from '@/lib/mock-data';
import { useAuth } from '@/components/auth/AuthProvider';

const ACTIVE_MATERIAL_SESSION_KEY_PREFIX = 'prodtime_tracker_active_material_sessions_';

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
  const { operator, loading: authLoading } = useAuth();

  useEffect(() => {
    const loadActiveSessions = () => {
        if (authLoading) return;
        if (!operator) {
            setActiveSessions([]);
            setIsLoading(false);
            return;
        }

        try {
            const storageKey = `${ACTIVE_MATERIAL_SESSION_KEY_PREFIX}${operator.id}`;
            const storedSessions = localStorage.getItem(storageKey);
            if (storedSessions) {
                // The session is the source of truth from the operator's browser.
                // We no longer validate against the originator job, as it might be completed.
                // The session must persist until manually closed by the operator.
                const parsedSessions: ActiveMaterialSessionData[] = JSON.parse(storedSessions);
                setActiveSessions(parsedSessions);
            } else {
                setActiveSessions([]);
            }
        } catch (error) {
            console.error("Failed to load active material sessions from localStorage", error);
             if (operator) {
                localStorage.removeItem(`${ACTIVE_MATERIAL_SESSION_KEY_PREFIX}${operator.id}`);
            }
            setActiveSessions([]);
        } finally {
            setIsLoading(false);
        }
    };
    loadActiveSessions();
  }, [operator, authLoading]);

  const persistSessions = (sessions: ActiveMaterialSessionData[]) => {
    if (!operator) return;
    const storageKey = `${ACTIVE_MATERIAL_SESSION_KEY_PREFIX}${operator.id}`;
    try {
        if (sessions.length > 0) {
            localStorage.setItem(storageKey, JSON.stringify(sessions));
        } else {
            localStorage.removeItem(storageKey);
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
  }, [operator]);

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
  }, [operator]);

  const closeSession = useCallback((materialId: string) => {
    setActiveSessions(prevSessions => {
        const updatedSessions = prevSessions.filter(s => s.materialId !== materialId);
        persistSessions(updatedSessions);
        return updatedSessions;
    });
  }, [operator]);

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
