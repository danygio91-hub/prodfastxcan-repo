
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter } from 'next/navigation';
import { collection, doc, getDocs, query, where, setDoc, updateDoc } from 'firebase/firestore';
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
      try {
        if (firebaseUser) {
          // A user is authenticated. Find their operator profile.
          const operatorsSnapshot = await getDocs(collection(db, "operators"));
          const operators = operatorsSnapshot.docs.map(op => ({ ...op.data(), id: op.id } as Operator));

          let operatorProfile = operators.find(op => op.uid === firebaseUser.uid);

          if (!operatorProfile) {
            // Not found by UID, try by normalized name (first login scenario)
            const emailUsername = firebaseUser.email?.split('@')[0];
            if (emailUsername) {
              const operatorByUsername = operators.find(op => op.nome_normalized === emailUsername);
              if (operatorByUsername) {
                console.log(`First login for ${emailUsername}, linking UID to operator profile ${operatorByUsername.id}.`);
                // Link the account by updating the doc in Firestore
                const operatorDocRef = doc(db, "operators", operatorByUsername.id);
                await setDoc(operatorDocRef, { uid: firebaseUser.uid }, { merge: true });
                // Found our profile
                operatorProfile = { ...operatorByUsername, uid: firebaseUser.uid };
              }
            }
          }

          if (operatorProfile) {
             // We have the operator doc, proceed to set the application state.
            if (operatorProfile.stato !== 'attivo' && operatorProfile.role !== 'admin') {
                const operatorDocRef = doc(db, "operators", operatorProfile.id);
                await updateDoc(operatorDocRef, { stato: 'attivo' });
                operatorProfile.stato = 'attivo';
            }
            setUser(firebaseUser);
            setOperator(operatorProfile);
            storeOperator(operatorProfile);
          } else {
             // A user exists in Firebase Auth, but not in our 'operators' collection.
             // This is an invalid state.
             console.error(`Auth consistency error: Firebase user ${firebaseUser.email} exists but has no matching operator profile. Forcing logout.`);
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
        setUser(null);
        setOperator(null);
        storeOperator(null);
        await firebaseLogout();
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

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
