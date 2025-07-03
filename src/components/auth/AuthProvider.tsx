
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter } from 'next/navigation';
import { collection, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
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
          const operatorsSnapshot = await getDocs(collection(db, "operators"));
          const operators = operatorsSnapshot.docs.map(op => ({ ...op.data(), id: op.id } as Operator));

          let operatorProfile: Operator | undefined;
          let profileNeedsUpdate = false;

          // Strategy 1: Find by UID (most efficient and secure)
          operatorProfile = operators.find(op => op.uid === firebaseUser.uid);

          // Strategy 2: Find by Email (for first login or if UID is missing)
          if (!operatorProfile) {
            operatorProfile = operators.find(op => op.email === firebaseUser.email);
            if (operatorProfile) {
              profileNeedsUpdate = true; // Found by email, so we should add the UID
            }
          }

          // Strategy 3: Fallback to old username match (for backward compatibility)
          if (!operatorProfile) {
            const emailUsername = firebaseUser.email?.split('@')[0].toLowerCase();
            operatorProfile = operators.find(op => op.nome_normalized === emailUsername);
            if (operatorProfile) {
               profileNeedsUpdate = true; // Found by name, should add UID and Email
            }
          }
          
          if (operatorProfile) {
            // If we found a profile that needs UID/Email added, update it now.
            // This self-heals profiles created with older app versions.
            if (profileNeedsUpdate) {
                const operatorDocRef = doc(db, "operators", operatorProfile.id);
                const updates: Partial<Operator> = { uid: firebaseUser.uid };
                if (!operatorProfile.email) {
                    updates.email = firebaseUser.email!;
                }
                await setDoc(operatorDocRef, updates, { merge: true });
                // Update the local profile object with the new data
                operatorProfile = { ...operatorProfile, ...updates };
            }

            // Set operator status to active
            if (operatorProfile.stato !== 'attivo' && operatorProfile.role !== 'admin') {
                const operatorDocRef = doc(db, "operators", operatorProfile.id);
                await updateDoc(operatorDocRef, { stato: 'attivo' });
                operatorProfile.stato = 'attivo';
            }
            
            setUser(firebaseUser);
            setOperator(operatorProfile);
            storeOperator(operatorProfile);

          } else {
             // If after all checks we still haven't found a profile, it's a true error.
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
