
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
    storeOperator(null);
    router.push('/');
  }, [router]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        // Now, we can reliably query by UID because the login function guarantees it's set.
        const q = query(collection(db, "operators"), where("uid", "==", firebaseUser.uid), limit(1));
        const operatorSnapshot = await getDocs(q);

        if (!operatorSnapshot.empty) {
            const operatorDoc = operatorSnapshot.docs[0];
            const operatorProfile = operatorDoc.data() as Operator;
            operatorProfile.id = operatorDoc.id;

            setUser(firebaseUser);
            setOperator(operatorProfile);
            storeOperator(operatorProfile);
        } else {
            // This case should be rare, but it's good to handle it.
            // It might happen if the operator doc is deleted from Firestore while the user is logged in.
            console.error("User is authenticated but operator profile not found. Logging out.");
            await handleLogout();
        }
      } else {
        // User is logged out
        setUser(null);
        setOperator(null);
        storeOperator(null);
      }
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [handleLogout]);
  

  return (
    <AuthContext.Provider value={{ user, operator, loading, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
