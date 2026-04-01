
"use client";

import React, { createContext, useContext, useCallback, ReactNode, useState, useEffect } from 'react';
import type { ActiveMaterialSessionData, RawMaterialType, IndependentMaterialSession } from '@/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { startIndependentSession, addJobsToSession, closeIndependentSession } from '@/app/actions/material-sessions';

type MaterialSessionCategory = 'TRECCIA' | 'TUBI' | 'GUAINA';

interface ActiveMaterialSessionContextType {
  activeSessions: IndependentMaterialSession[];
  startSession: (sessionData: Omit<IndependentMaterialSession, 'id' | 'startedAt' | 'status' | 'operatorId' | 'operatorName'>, type: RawMaterialType) => Promise<any>;
  addJobToSession: (sessionId: string, jobIds: string[]) => Promise<any>;
  closeSession: (sessionId: string, closingGrossWeight: number, isFinished: boolean) => Promise<any>;
  getSessionByMaterialId: (materialId: string) => IndependentMaterialSession | undefined;
  isLoading: boolean;
}

const ActiveMaterialSessionContext = createContext<ActiveMaterialSessionContextType | undefined>(undefined);

export const ActiveMaterialSessionProvider = ({ children }: { children: ReactNode }) => {
  const { user, operator, loading: authLoading } = useAuth();
  const [activeSessions, setActiveSessions] = useState<IndependentMaterialSession[]>([]);
  const [isListenerLoading, setIsListenerLoading] = useState(true);

  const isLoading = authLoading || isListenerLoading;

  useEffect(() => {
    if (!user || authLoading) return;

    if (!user) {
      setActiveSessions([]);
      setIsListenerLoading(false);
      return;
    }

    const sessionsRef = collection(db, "materialSessions");
    let q;

    if (operator?.canManageMaterialSessions) {
      // Global View: All open sessions
      q = query(
        sessionsRef,
        where("status", "==", "open")
      );
    } else {
      // Personal View: Only own open sessions
      q = query(
        sessionsRef,
        where("operatorId", "==", user.uid),
        where("status", "==", "open")
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessions = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
        startedAt: doc.data().startedAt?.toDate() || doc.data().startedAt
      } as IndependentMaterialSession));
      setActiveSessions(sessions);
      setIsListenerLoading(false);
    }, (error) => {
      console.error("Firestore Material Sessions Listener Error:", error);
      setIsListenerLoading(false);
    });

    return () => unsubscribe();
  }, [user, operator, authLoading]);

  const getSessionByMaterialId = useCallback((materialId: string): IndependentMaterialSession | undefined => {
    return activeSessions.find(s => s.materialId === materialId);
  }, [activeSessions]);

  const startSession = useCallback(async (sessionData: Omit<IndependentMaterialSession, 'id' | 'startedAt' | 'status' | 'operatorId' | 'operatorName'>, type: RawMaterialType) => {
    if (!user || !operator) return { success: false, message: "Utente non autorizzato." };
    
    // Check for existing session for same material/lotto (optional but good)
    if (activeSessions.some(s => s.materialId === sessionData.materialId && (s.lotto === sessionData.lotto || (!s.lotto && !sessionData.lotto)))) {
      return { success: false, message: "Esiste già una sessione aperta per questo materiale." };
    }

    return await startIndependentSession({
      ...sessionData,
      operatorId: user.uid,
      operatorName: operator.nome
    });
  }, [user, operator, activeSessions]);

  const addJobToSession = useCallback(async (sessionId: string, jobIds: string[]) => {
    return await addJobsToSession(sessionId, jobIds);
  }, []);

  const closeSession = useCallback(async (sessionId: string, closingGrossWeight: number, isFinished: boolean) => {
    return await closeIndependentSession(sessionId, closingGrossWeight, isFinished);
  }, []);

  return (
    <ActiveMaterialSessionContext.Provider value={{ 
      activeSessions, 
      startSession, 
      addJobToSession, 
      closeSession, 
      getSessionByMaterialId, 
      isLoading 
    }}>
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
