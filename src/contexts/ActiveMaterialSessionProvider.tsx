
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { ActiveMaterialSessionData, MaterialSessionCategory, RawMaterialType } from '@/lib/mock-data';
import { useAuth } from '@/components/auth/AuthProvider';

const ACTIVE_MATERIAL_SESSION_KEY_PREFIX = 'prodtime_tracker_active_material_sessions_';

interface ActiveMaterialSessionContextType {
  activeSessions: ActiveMaterialSessionData[];
  startSession: (sessionData: Omit<ActiveMaterialSessionData, 'category'>, type: RawMaterialType) => void;
  addJobToSession: (materialId: string, job: { jobId: string; jobOrderPF: string }) => void;
  closeSession: (materialId: string) => void;
  getSessionByMaterialId: (materialId: string) => ActiveMaterialSessionData | undefined;
  isLoading: boolean;
}

const ActiveMaterialSessionContext = createContext<ActiveMaterialSessionContextType | undefined>(undefined);

function getMaterialCategory(type: RawMaterialType): MaterialSessionCategory {
  if (type === 'BOB' || type === 'PF3V0') return 'TRECCIA';
  if (type === 'TUBI') return 'TUBI';
  if (type === 'GUAINA') return 'GUAINA';
  console.warn(`Unknown material type received for session category: ${type}`);
  return 'TRECCIA';
}

export const ActiveMaterialSessionProvider = ({ children }: { children: ReactNode }) => {
  const [activeSessions, setActiveSessions] = useState<ActiveMaterialSessionData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { operator, loading: authLoading } = useAuth();

  // Effect to load sessions from localStorage when the operator logs in or changes
  useEffect(() => {
    if (authLoading) {
        setIsLoading(true);
        return;
    }
    if (operator?.id) {
        try {
            const storageKey = `${ACTIVE_MATERIAL_SESSION_KEY_PREFIX}${operator.id}`;
            const storedSessions = localStorage.getItem(storageKey);
            if (storedSessions) {
                setActiveSessions(JSON.parse(storedSessions));
            } else {
                setActiveSessions([]);
            }
        } catch (error) {
            console.error("Failed to load material sessions from localStorage:", error);
            setActiveSessions([]);
        }
    } else {
        // If there's no operator, clear the sessions for this instance
        setActiveSessions([]);
    }
    setIsLoading(false);
  }, [operator, authLoading]);

  const persistSessions = useCallback((sessions: ActiveMaterialSessionData[]) => {
    if (!operator?.id) return;
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
  }, [operator]);

  const startSession = useCallback((sessionData: Omit<ActiveMaterialSessionData, 'category'>, type: RawMaterialType) => {
    const category = getMaterialCategory(type);
    
    setActiveSessions(prevSessions => {
        // This check is now handled in the UI to give the user options.
        // We allow starting a session even if one for the same material exists,
        // as it represents a new lot/spool.
        const newSession: ActiveMaterialSessionData = { ...sessionData, category };
        const updatedSessions = [...prevSessions, newSession];
        persistSessions(updatedSessions);
        return updatedSessions;
    });
  }, [persistSessions]);

  const addJobToSession = useCallback((materialId: string, job: { jobId: string; jobOrderPF: string }) => {
    setActiveSessions(prevSessions => {
        const updatedSessions = prevSessions.map(session => {
            if (session.materialId === materialId) {
                // Avoid adding duplicate jobs
                if (session.associatedJobs.some(j => j.jobId === job.jobId)) {
                    return session; 
                }
                return {
                    ...session,
                    associatedJobs: [...session.associatedJobs, job],
                };
            }
            return session;
        });
        if (JSON.stringify(updatedSessions) !== JSON.stringify(prevSessions)) {
            persistSessions(updatedSessions);
        }
        return updatedSessions;
    });
  }, [persistSessions]);

  const closeSession = useCallback((materialId: string) => {
    setActiveSessions(prevSessions => {
      const sessionToClose = prevSessions.find(s => s.materialId === materialId);
      if (!sessionToClose) return prevSessions;

      const updatedSessions = prevSessions.filter(s => s.materialId !== materialId);
      persistSessions(updatedSessions);
      return updatedSessions;
    });
  }, [persistSessions]);


  const getSessionByMaterialId = useCallback((materialId: string): ActiveMaterialSessionData | undefined => {
    return activeSessions.find(s => s.materialId === materialId);
  }, [activeSessions]);


  return (
    <ActiveMaterialSessionContext.Provider value={{ activeSessions, startSession, addJobToSession, closeSession, getSessionByMaterialId, isLoading }}>
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
