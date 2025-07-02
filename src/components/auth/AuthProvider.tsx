
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter } from 'next/navigation';
import { collection, doc, getDocs, setDoc, query, where, limit } from 'firebase/firestore';
import { logout as firebaseLogout, getOperator } from '@/lib/auth';


interface AuthContextType {
  user: User | null;
  operator: Operator | null;
  loading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({ user: null, operator: null, loading: true, logout: () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const handleLogout = useCallback(async () => {
    const currentOperator = getOperator();
    if(currentOperator && currentOperator.role !== 'admin') {
      const operatorRef = doc(db, "operators", currentOperator.id);
      await setDoc(operatorRef, { stato: 'inattivo' }, { merge: true });
    }
    
    await firebaseLogout();
    // The onAuthStateChanged listener will handle clearing state
  }, []);

  const fetchOperatorProfile = useCallback(async (firebaseUser: User): Promise<Operator | null> => {
      let q = query(collection(db, "operators"), where("uid", "==", firebaseUser.uid), limit(1));
      let operatorSnapshot = await getDocs(q);

      // Fallback for the first-login race condition.
      if (operatorSnapshot.empty && firebaseUser.email) {
          const username = firebaseUser.email.split('@')[0];
          if (username) {
            q = query(collection(db, "operators"), where("nome_normalized", "==", username), limit(1));
            operatorSnapshot = await getDocs(q);
          }
      }

      if (!operatorSnapshot.empty) {
          const operatorDoc = operatorSnapshot.docs[0];
          const operatorProfile = operatorDoc.data() as Operator;
          operatorProfile.id = operatorDoc.id;
          return operatorProfile;
      }
      
      return null;
  }, []);


  useEffect(() => {
    // The onAuthStateChanged callback SHOULD NOT be async.
    // We delegate async work to a separate function.
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        if (firebaseUser) {
            setLoading(true);
            fetchOperatorProfile(firebaseUser)
                .then(operatorProfile => {
                    if (operatorProfile) {
                        setUser(firebaseUser);
                        setOperator(operatorProfile);
                        storeOperator(operatorProfile);
                    } else {
                        console.error("Authenticated user profile not found. Logging out.");
                        handleLogout();
                    }
                })
                .catch(error => {
                    console.error("Error fetching operator profile:", error);
                    handleLogout();
                })
                .finally(() => {
                    setLoading(false);
                });
        } else {
            setUser(null);
            setOperator(null);
            storeOperator(null);
            setLoading(false);
        }
    });

    return () => unsubscribe();
  }, [fetchOperatorProfile, handleLogout]);
  
  const doLogout = useCallback(async () => {
      await handleLogout();
      router.push('/');
  }, [handleLogout, router]);


  return (
    <AuthContext.Provider value={{ user, operator, loading, logout: doLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
