
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import type { ActiveMaterialSessionData, MaterialSessionCategory, RawMaterialType } from '@/lib/mock-data';
import { useAuth } from '@/components/auth/AuthProvider';

const ACTIVE_MATERIAL_SESSION_KEY_PREFIX = 'prodtime_tracker_active_material_sessions_';
const BROADCAST_CHANNEL_NAME = 'material_session_channel';

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
  
  const operatorRef = useRef(operator);
  operatorRef.current = operator;

  const getStorageKey = useCallback(() => {
    const currentOperator = operatorRef.current;
    return currentOperator ? `${ACTIVE_MATERIAL_SESSION_KEY_PREFIX}${currentOperator.id}` : null;
  }, []);
  
  const broadcastSessionsUpdate = useCallback((sessions: ActiveMaterialSessionData[]) => {
    try {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.postMessage({ type: 'SESSIONS_UPDATED', payload: JSON.stringify(sessions) });
      channel.close();
    } catch (error) {
      console.error("Failed to broadcast session update:", error);
    }
  }, []);

  const persistSessions = useCallback((sessions: ActiveMaterialSessionData[]) => {
    const storageKey = getStorageKey();
    if (!storageKey) return;

    try {
      localStorage.setItem(storageKey, JSON.stringify(sessions));
      broadcastSessionsUpdate(sessions);
    } catch (error) {
      console.error("Failed to save active material sessions", error);
    }
  }, [getStorageKey, broadcastSessionsUpdate]);
  
  const loadSessionsFromStorage = useCallback(() => {
    const storageKey = getStorageKey();
    if (!storageKey) {
        setActiveSessions([]);
        return;
    }
    try {
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
  }, [getStorageKey]);


  // Effect for initial loading and handling broadcast messages
  useEffect(() => {
    if (authLoading) {
        setIsLoading(true);
        return;
    }

    setIsLoading(true);
    loadSessionsFromStorage();
    setIsLoading(false);

    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'SESSIONS_UPDATED' && event.data.payload) {
             try {
                setActiveSessions(JSON.parse(event.data.payload));
            } catch (error) {
                console.error("Failed to parse broadcasted sessions", error);
            }
        }
    };
    channel.addEventListener('message', handleMessage);

    return () => {
        channel.removeEventListener('message', handleMessage);
        channel.close();
    };
  }, [operator, authLoading, loadSessionsFromStorage]);


  const startSession = useCallback((sessionData: Omit<ActiveMaterialSessionData, 'category'>, type: RawMaterialType) => {
    const category = getMaterialCategory(type);
    
    setActiveSessions(prevSessions => {
        const newSession: ActiveMaterialSessionData = { ...sessionData, category };
        
        // Prevent adding a session for a material that already has one.
        if (prevSessions.some(s => s.materialId === newSession.materialId)) {
          console.warn(`Attempted to start a session for material ${newSession.materialId}, but one already exists.`);
          return prevSessions;
        }

        const updatedSessions = [...prevSessions, newSession];
        persistSessions(updatedSessions);
        return updatedSessions;
    });
  }, [persistSessions]);

  const addJobToSession = useCallback((materialId: string, job: { jobId: string; jobOrderPF: string }) => {
    setActiveSessions(prevSessions => {
        let hasChanged = false;
        const updatedSessions = prevSessions.map(session => {
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
