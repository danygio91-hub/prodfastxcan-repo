
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
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true); // Start as true
  const router = useRouter();

  // This useEffect will run only once on mount, setting up the central auth listener.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // User is signed in to Firebase. Let's find their operator profile.
        const q = query(collection(db, "operators"), where("uid", "==", firebaseUser.uid));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const operatorDoc = querySnapshot.docs[0];
          const operatorProfile = { ...operatorDoc.data(), id: operatorDoc.id } as Operator;
          
          // Set application state
          setUser(firebaseUser);
          setOperator(operatorProfile);
          storeOperator(operatorProfile);
        } else {
          // Firebase user exists, but no operator profile. This is an invalid state.
          console.error("Auth state error: Firebase user exists but no operator profile found. Logging out.");
          await firebaseLogout();
          // State will be cleared by the next `onAuthStateChanged` event
        }
      } else {
        // User is signed out. Clear all state.
        setUser(null);
        setOperator(null);
        storeOperator(null);
      }
      // We are done loading, regardless of the outcome.
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []); // Empty dependency array is crucial here.

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
    // onAuthStateChanged will handle clearing the state, but we can do it manually for faster UI response.
    setUser(null);
    setOperator(null);
    storeOperator(null);
    router.push('/');
  }, [operator, router]);

  return (
    <AuthContext.Provider value={{ user, operator, loading, logout }}>
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
