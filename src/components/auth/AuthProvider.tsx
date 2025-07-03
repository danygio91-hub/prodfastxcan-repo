
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        try {
          const q = query(collection(db, "operators"), where("uid", "==", firebaseUser.uid));
          let querySnapshot = await getDocs(q);

          // This retry logic handles the race condition where onAuthStateChanged
          // fires before the login function's Firestore write is propagated.
          if (querySnapshot.empty) {
            console.warn("Operator profile not found on first attempt, retrying in 1.5s...");
            await new Promise(resolve => setTimeout(resolve, 1500));
            querySnapshot = await getDocs(q);
          }

          if (!querySnapshot.empty) {
            const operatorDoc = querySnapshot.docs[0];
            const operatorProfile = { ...operatorDoc.data(), id: operatorDoc.id } as Operator;
            
            setUser(firebaseUser);
            setOperator(operatorProfile);
            storeOperator(operatorProfile);
          } else {
            console.error("Authenticated user profile not found in Firestore. Logging out.");
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
  }, []); // Empty dependency array ensures this effect runs only once on mount.

  const logout = useCallback(async () => {
    if (operator && operator.role !== 'admin') {
      try {
        const operatorRef = doc(db, "operators", operator.id);
        // Use updateDoc for safety, to only change specific fields.
        await updateDoc(operatorRef, { stato: 'inattivo' });
      } catch (e) {
        console.error("Could not set operator status to inactive on logout", e);
      }
    }
    await firebaseLogout();
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
