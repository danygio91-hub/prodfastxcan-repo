
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
          // A user is authenticated with Firebase. Now, find their operator profile.
          // We use the email to reliably find the user, avoiding race conditions with UID writing.
          const emailUsername = firebaseUser.email?.split('@')[0];
          if (!emailUsername) {
            console.error("Firebase user has no valid email. Logging out.");
            await firebaseLogout();
            return;
          }

          const q = query(collection(db, "operators"), where("nome_normalized", "==", emailUsername));
          const querySnapshot = await getDocs(q);

          if (!querySnapshot.empty) {
            const operatorDoc = querySnapshot.docs[0];
            const operatorProfile = { ...operatorDoc.data(), id: operatorDoc.id } as Operator;
            
            // This is the crucial step to fix the race condition.
            // If the UID is not on the profile, it's a first-time login. We write it now.
            if (!operatorProfile.uid) {
              console.log(`First login for ${emailUsername}, linking UID.`);
              operatorProfile.uid = firebaseUser.uid;
              const operatorDocRef = doc(db, "operators", operatorDoc.id);
              await setDoc(operatorDocRef, { uid: firebaseUser.uid }, { merge: true });
            }

            // Also ensure the user is marked as active in the database upon login.
             if (operatorProfile.stato !== 'attivo' && operatorProfile.role !== 'admin') {
                const operatorDocRef = doc(db, "operators", operatorDoc.id);
                await updateDoc(operatorDocRef, { stato: 'attivo' });
                operatorProfile.stato = 'attivo';
            }
            
            // Now set the application state.
            setUser(firebaseUser);
            setOperator(operatorProfile);
            storeOperator(operatorProfile);

          } else {
            // A user exists in Firebase Auth, but not in our 'operators' collection.
            // This is an invalid state, likely an admin deleted the profile but not the auth user.
            console.error(`Auth consistency error: Firebase user ${firebaseUser.email} exists but has no operator profile. Forcing logout.`);
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
