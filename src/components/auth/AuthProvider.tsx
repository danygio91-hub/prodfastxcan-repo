
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter, usePathname } from 'next/navigation';
import { collection, doc, getDoc, getDocs, setDoc, writeBatch, query, where } from 'firebase/firestore';
import { logout as firebaseLogout, getOperator } from '@/lib/auth';


interface AuthContextType {
  user: User | null;
  operator: Operator | null;
  loading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({ user: null, operator: null, loading: true, logout: () => {} });

const ADMIN_EMAIL = 'daniel@prodfastxcan.app';
const ADMIN_ID = 'op-1';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

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
                uid: firebaseUser.uid,
                nome_normalized: 'daniel',
            };
            // Ensure admin profile exists and is correct in Firestore
            const adminRef = doc(db, "operators", ADMIN_ID);
            await setDoc(adminRef, operatorProfile, { merge: true });
        } 
        // --- OPERATOR PATH ---
        else {
            const userNameFromEmail = firebaseUser.email?.split('@')[0];
            if (userNameFromEmail) {
                const operatorsRef = collection(db, 'operators');
                // Efficiently query for the operator using the normalized name
                const q = query(operatorsRef, where("nome_normalized", "==", userNameFromEmail));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    const operatorDoc = querySnapshot.docs[0];
                    const foundOperator = operatorDoc.data() as Operator;
                    operatorProfile = { ...foundOperator, stato: 'attivo' };

                    // Link Firebase Auth UID to Operator profile on first login
                    if (!foundOperator.uid) {
                        await setDoc(operatorDoc.ref, { uid: firebaseUser.uid }, { merge: true });
                        operatorProfile.uid = firebaseUser.uid;
                    }
                    // Update status in Firestore if necessary
                    if (foundOperator.stato !== 'attivo') {
                        await setDoc(operatorDoc.ref, { stato: 'attivo' }, { merge: true });
                    }
                }
            }
        }
        
        setUser(firebaseUser);
        setOperator(operatorProfile);
        storeOperator(operatorProfile);
        
        // ** NEW LOGIC: Enforce privacy policy signature **
        if (operatorProfile && !operatorProfile.privacySigned && pathname !== '/operator-data') {
            router.replace('/operator-data');
        }

      } else {
        // User is logged out
        setUser(null);
        setOperator(null);
        storeOperator(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router, pathname]);
  
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
