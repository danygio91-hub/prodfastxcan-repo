
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter } from 'next/navigation';
import { collection, doc, getDocs, query, where, updateDoc } from 'firebase/firestore';
import { logout as firebaseLogout } from '@/lib/auth';

interface AuthContextType {
  user: User | null;
  operator: Operator | null;
  loading: boolean;
  setAuthDataAfterLogin: (user: User, operator: Operator) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const setAuthDataAfterLogin = useCallback((loggedInUser: User, operatorProfile: Operator) => {
    setLoading(false);
    setUser(loggedInUser);
    setOperator(operatorProfile);
    storeOperator(operatorProfile);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // If the user state is already populated (e.g., by a fresh login),
      // we don't need the listener to do anything, preventing race conditions.
      if (user) {
        setLoading(false);
        return;
      }

      setLoading(true);
      if (firebaseUser) {
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
            // On a page refresh, if the user exists in Firebase but has no profile,
            // something is wrong. Log them out for safety.
            await firebaseLogout();
          }
        } catch (error) {
          console.error("Error during session restoration:", error);
          await firebaseLogout();
        }
      } else {
        // No user is signed into Firebase.
        setUser(null);
        setOperator(null);
        storeOperator(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]); // The dependency on `user` is crucial.

  const logout = useCallback(async () => {
    if (operator && operator.role !== 'admin') {
      try {
        const operatorRef = doc(db, "operators", operator.id);
        await updateDoc(operatorRef, { stato: 'inattivo' });
      } catch (e) {
        console.error("Could not set operator status to inactive on logout", e);
      }
    }
    await firebaseLogout();
    // Manually reset state to ensure UI updates immediately.
    setUser(null);
    setOperator(null);
    storeOperator(null);
    router.push('/');
  }, [operator, router]);

  return (
    <AuthContext.Provider value={{ user, operator, loading, setAuthDataAfterLogin, logout }}>
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
