
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter } from 'next/navigation';
import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { logout as firebaseLogout } from '@/lib/auth';


interface AuthContextType {
  user: User | null;
  operator: Operator | null;
  loading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({ user: null, operator: null, loading: true, logout: () => {} });

const ADMIN_EMAIL = 'daniel.giorlando@prodfastxcan.app';
const ADMIN_ID = 'op-1';

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
        
        // --- ADMIN PATH ---
        if (firebaseUser.email === ADMIN_EMAIL) {
            operatorProfile = {
                id: ADMIN_ID,
                nome: 'Daniel',
                cognome: 'Giorlando',
                reparto: 'N/D',
                stato: 'attivo',
                role: 'admin',
                privacySigned: true,
            };
            // Ensure admin profile exists and is correct in Firestore
            const adminRef = doc(db, "operators", ADMIN_ID);
            const adminSnap = await getDoc(adminRef);
            if (!adminSnap.exists() || adminSnap.data().role !== 'admin') {
                await setDoc(adminRef, operatorProfile, { merge: true });
            }
        } 
        // --- OPERATOR PATH ---
        else {
            const operatorsSnap = await getDocs(collection(db, 'operators'));
            const allOperators = operatorsSnap.docs.map(doc => doc.data() as Operator);
            
            // Find operator by matching the start of the email with the name
            const userNameFromEmail = firebaseUser.email?.split('@')[0];
            const foundOperator = allOperators.find(op => op.nome.toLowerCase() === userNameFromEmail);

            if (foundOperator) {
                operatorProfile = { ...foundOperator, stato: 'attivo' };
                // Update status in Firestore if necessary
                if (foundOperator.stato !== 'attivo') {
                    const operatorRef = doc(db, "operators", foundOperator.id);
                    await setDoc(operatorRef, { stato: 'attivo' }, { merge: true });
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
    // If the logged-out user is an operator, set their status to 'inattivo'
    const currentOperator = getOperator();
    if(currentOperator && currentOperator.role !== 'admin') {
      const operatorRef = doc(db, "operators", currentOperator.id);
      await setDoc(operatorRef, { stato: 'inattivo' }, { merge: true });
    }
    
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
