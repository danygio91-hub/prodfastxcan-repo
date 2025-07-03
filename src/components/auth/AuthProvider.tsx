
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
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // This central listener is the single source of truth for the user's auth state.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          // User is signed in. Find their operator profile using their unique UID.
          const q = query(collection(db, "operators"), where("uid", "==", firebaseUser.uid));
          const querySnapshot = await getDocs(q);

          if (!querySnapshot.empty) {
            const operatorDoc = querySnapshot.docs[0];
            const operatorProfile = { ...operatorDoc.data(), id: operatorDoc.id } as Operator;
            
            // Set the application state
            setUser(firebaseUser);
            setOperator(operatorProfile);
            storeOperator(operatorProfile);
          } else {
            // This is an invalid state, log them out.
            console.error(`Auth consistency error: Firebase user ${firebaseUser.uid} exists but has no operator profile. Forcing logout.`);
            await firebaseLogout();
          }
        } else {
          // User is signed out. Clear all state.
          setUser(null);
          setOperator(null);
          storeOperator(null);
        }
      } catch (error) {
        console.error("Error in onAuthStateChanged handler:", error);
        // Ensure state is cleared on error
        setUser(null);
        setOperator(null);
        storeOperator(null);
      } finally {
        // We are finished with the initial auth check.
        setLoading(false);
      }
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []); // The empty dependency array is critical: this effect runs only once.

  const logout = useCallback(async () => {
    // If there's an operator logged in, and they are not an admin, set their status to 'inattivo'.
    if (operator && operator.role !== 'admin') {
      try {
        const operatorRef = doc(db, "operators", operator.id);
        await updateDoc(operatorRef, { stato: 'inattivo' });
      } catch (e) {
        console.error("Could not set operator status to inactive on logout", e);
      }
    }
    
    await firebaseLogout();
    // The onAuthStateChanged listener will automatically clear the user and operator state.
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
