
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter } from 'next/navigation';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
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
      if (firebaseUser) {
        try {
          const operatorsSnapshot = await getDocs(collection(db, "operators"));
          const operatorList = operatorsSnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Operator));
          
          let operatorProfile = operatorList.find(op => op.uid === firebaseUser.uid);
          
          // Fallback for race condition on first login
          if (!operatorProfile && firebaseUser.email) {
            const username = firebaseUser.email.split('@')[0];
            operatorProfile = operatorList.find(op => op.nome_normalized === username);
          }

          if (operatorProfile) {
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
        }
      } else {
        setUser(null);
        setOperator(null);
        storeOperator(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
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
