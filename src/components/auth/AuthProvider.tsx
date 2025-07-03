
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter } from 'next/navigation';
import { collection, query, where, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';
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
          let operatorProfile: Operator | null = null;
          let operatorId: string | null = null;
          let profileNeedsUpdate = false;

          // Strategy 1: Find by UID (most efficient and secure)
          const q_uid = query(collection(db, "operators"), where("uid", "==", firebaseUser.uid));
          const uidSnapshot = await getDocs(q_uid);

          if (!uidSnapshot.empty) {
            const operatorDoc = uidSnapshot.docs[0];
            operatorProfile = { ...operatorDoc.data(), id: operatorDoc.id } as Operator;
            operatorId = operatorDoc.id;
          } else {
            // Strategy 2: Find by Email (for first login or if UID is missing)
            if (firebaseUser.email) {
              const q_email = query(collection(db, "operators"), where("email", "==", firebaseUser.email));
              const emailSnapshot = await getDocs(q_email);
              if (!emailSnapshot.empty) {
                const operatorDoc = emailSnapshot.docs[0];
                operatorProfile = { ...operatorDoc.data(), id: operatorDoc.id } as Operator;
                operatorId = operatorDoc.id;
                profileNeedsUpdate = true; // Found by email, so we should add the UID
              }
            }
          }

          if (operatorProfile && operatorId) {
            // If we found a profile that needs UID/Email added, update it now.
            if (profileNeedsUpdate) {
                const operatorDocRef = doc(db, "operators", operatorId);
                await setDoc(operatorDocRef, { uid: firebaseUser.uid }, { merge: true });
                operatorProfile.uid = firebaseUser.uid; // Update the local profile object
            }

            // Set operator status to active
            if (operatorProfile.stato !== 'attivo' && operatorProfile.role !== 'admin') {
                const operatorDocRef = doc(db, "operators", operatorId);
                await updateDoc(operatorDocRef, { stato: 'attivo' });
                operatorProfile.stato = 'attivo';
            }
            
            setUser(firebaseUser);
            setOperator(operatorProfile);
            storeOperator(operatorProfile);

          } else {
             // A user exists in Firebase Auth, but not in our 'operators' collection.
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
