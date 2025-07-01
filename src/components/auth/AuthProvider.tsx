
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter } from 'next/navigation';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { logout as firebaseLogout } from '@/lib/auth';


interface AuthContextType {
  user: User | null;
  operator: Operator | null;
  loading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({ user: null, operator: null, loading: true, logout: () => {} });

const ADMIN_EMAIL = 'daniel.giorlando@prodfastxcan.app';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        let operatorProfile: Operator | null = null;
        
        if (firebaseUser.email === ADMIN_EMAIL) {
            // Handle Admin User
            operatorProfile = {
                id: 'op-1',
                nome: 'Daniel',
                cognome: 'Giorlando',
                reparto: 'N/D',
                stato: 'attivo',
                role: 'admin',
                privacySigned: true,
            };
            // Ensure Firestore is in sync
            try {
                await setDoc(doc(db, "operators", "op-1"), operatorProfile, { merge: true });
            } catch(e) {
                console.error("Failed to sync admin profile", e);
            }
        } else {
            // Handle Regular Operator
            const operatorsSnap = await getDocs(collection(db, 'operators'));
            const allOperators = operatorsSnap.docs.map(doc => doc.data() as Operator);
            
            const foundOperator = allOperators.find(op => {
                const operatorEmail = `${op.nome.toLowerCase()}.${op.cognome.toLowerCase().replace(/\s+/g, '')}@prodfastxcan.app`;
                return operatorEmail === firebaseUser.email;
            });

            if (foundOperator) {
                operatorProfile = { ...foundOperator, stato: 'attivo' };
                 // Update status in Firestore if necessary
                if (foundOperator.stato !== 'attivo') {
                    try {
                        await setDoc(doc(db, "operators", foundOperator.id), { stato: 'attivo' }, { merge: true });
                    } catch(e) {
                        console.error("Failed to update operator status", e);
                    }
                }
            }
        }
        
        setUser(firebaseUser);
        setOperator(operatorProfile);
        storeOperator(operatorProfile);

      } else {
        // User is logged out
        setUser(null);
        setOperator(null);
        storeOperator(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);
  
  const handleLogout = useCallback(async () => {
    await firebaseLogout();
    router.push('/');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, operator, loading, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
