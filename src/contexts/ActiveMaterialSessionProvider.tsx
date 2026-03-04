
"use client";

import React, { createContext, useContext, useCallback, ReactNode } from 'react';
import type { ActiveMaterialSessionData, RawMaterialType } from '@/lib/mock-data';
import { useAuth } from '@/components/auth/AuthProvider';
import { updateOperatorMaterialSessions } from '@/app/scan-job/actions';

type MaterialSessionCategory = 'TRECCIA' | 'TUBI' | 'GUAINA';

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
  const { operator, loading: authLoading } = useAuth();

  // The source of truth for active sessions is now the operator object from AuthProvider
  const activeSessions = operator?.activeMaterialSessions || [];
  const isLoading = authLoading;

  const getSessionByMaterialId = useCallback((materialId: string): ActiveMaterialSessionData | undefined => {
    return activeSessions.find(s => s.materialId === materialId);
  }, [activeSessions]);
  
  const updateSessionsOnServer = useCallback(async (newSessions: ActiveMaterialSessionData[]) => {
      if (!operator) return;
      // Optimistically update the UI while the server call is in progress.
      // The onSnapshot in AuthProvider will eventually sync the definitive state.
      await updateOperatorMaterialSessions(operator.id, newSessions);
  }, [operator]);

  const startSession = useCallback((sessionData: Omit<ActiveMaterialSessionData, 'category'>, type: RawMaterialType) => {
    const category = getMaterialCategory(type);
    
    const newSession: ActiveMaterialSessionData = { ...sessionData, category };

    // BUG FIX: Permetti sessioni multiple dello stesso materiale se il lotto è diverso.
    // Blocca solo se esiste già una sessione con STESSO materiale E STESSO lotto per questo operatore.
    if (activeSessions.some(s => s.materialId === newSession.materialId && s.lotto === newSession.lotto)) {
      console.warn(`Tentativo di avviare una sessione duplicata per materiale ${newSession.materialId} lotto ${newSession.lotto}.`);
      return;
    }

    const updatedSessions = [...activeSessions, newSession];
    updateSessionsOnServer(updatedSessions);
  }, [activeSessions, updateSessionsOnServer]);

  const addJobToSession = useCallback((materialId: string, job: { jobId: string; jobOrderPF: string }) => {
    let hasChanged = false;
    const updatedSessions = activeSessions.map(session => {
        if (session.materialId === materialId) {
            if (session.associatedJobs.some(j => j.jobId === job.jobId)) {
                return session; 
            }
            hasChanged = true;
            return {
                ...session,
                associatedJobs: [...session.associatedJobs, job],
            };
        }
        return session;
    });

    if (hasChanged) {
      updateSessionsOnServer(updatedSessions);
    }
  }, [activeSessions, updateSessionsOnServer]);

  const closeSession = useCallback((materialId: string) => {
    const updatedSessions = activeSessions.filter(s => s.materialId !== materialId);
    updateSessionsOnServer(updatedSessions);
  }, [activeSessions, updateSessionsOnServer]);


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
