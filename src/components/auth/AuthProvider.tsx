
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter } from 'next/navigation';
import { collection, doc, getDocs, setDoc, query, where } from 'firebase/firestore';
import { logout as firebaseLogout } from '@/lib/auth';

interface AuthContextType {
  user: User | null;
  operator: Operator | null;
  loading: boolean;
  logout: () => Promise<void>;
  setAuthData: (user: User, operator: Operator) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  operator: null,
  loading: true,
  logout: async () => {},
  setAuthData: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const setAuthData = useCallback((user: User, operator: Operator) => {
    setUser(user);
    setOperator(operator);
    storeOperator(operator);
    setLoading(false);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // This path is for session restoration (e.g., page refresh)
        // If we already have the operator from the login flow, don't re-fetch
        if (operator && operator.uid === firebaseUser.uid) {
            setLoading(false);
            return;
        }

        try {
          const q = query(collection(db, "operators"), where("uid", "==", firebaseUser.uid));
          const querySnapshot = await getDocs(q);

          if (!querySnapshot.empty) {
            const operatorDoc = querySnapshot.docs[0];
            const operatorProfile = { ...operatorDoc.data(), id: operatorDoc.id } as Operator;
            
            setUser(firebaseUser);
            setOperator(operatorProfile);
            storeOperator(operatorProfile);
          } else {
            console.error("Authenticated user profile not found in Firestore during session restore. Logging out.");
            await firebaseLogout();
          }
        } catch (error) {
          console.error("Error restoring session:", error);
          await firebaseLogout();
        }
      } else {
        setUser(null);
        setOperator(null);
        storeOperator(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(async () => {
    if (operator && operator.role !== 'admin') {
      try {
        const operatorRef = doc(db, "operators", operator.id);
        await setDoc(operatorRef, { stato: 'inattivo' }, { merge: true });
      } catch (e) {
        console.error("Could not set operator status to inactive on logout", e);
      }
    }
    await firebaseLogout();
    router.push('/');
  }, [operator, router]);

  return (
    <AuthContext.Provider value={{ user, operator, loading, logout, setAuthData }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
