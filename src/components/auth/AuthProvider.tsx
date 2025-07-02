
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter } from 'next/navigation';
import { collection, doc, getDocs, setDoc, query, where, limit } from 'firebase/firestore';
import { logout as firebaseLogout } from '@/lib/auth';

interface AuthContextType {
  user: User | null;
  operator: Operator | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  operator: null,
  loading: true,
  logout: async () => {},
});

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
          let q = query(collection(db, "operators"), where("uid", "==", firebaseUser.uid), limit(1));
          let operatorSnapshot = await getDocs(q);

          // Fallback for the race condition on first login
          if (operatorSnapshot.empty && firebaseUser.email) {
            const username = firebaseUser.email.split('@')[0];
            if (username) {
              q = query(collection(db, "operators"), where("nome_normalized", "==", username), limit(1));
              operatorSnapshot = await getDocs(q);
            }
          }

          if (!operatorSnapshot.empty) {
            const operatorDoc = operatorSnapshot.docs[0];
            const operatorProfile = { ...operatorDoc.data(), id: operatorDoc.id } as Operator;

            setUser(firebaseUser);
            setOperator(operatorProfile);
            storeOperator(operatorProfile);
          } else {
            console.error("Authenticated user profile not found in Firestore. Logging out.");
            await firebaseLogout();
          }
        } catch (error) {
          console.error("Error fetching operator profile:", error);
          await firebaseLogout();
        } finally {
          setLoading(false);
        }
      } else {
        setUser(null);
        setOperator(null);
        storeOperator(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []); // Empty dependency array ensures this runs only ONCE.

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
