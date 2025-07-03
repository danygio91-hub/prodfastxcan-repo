
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
          // Step 1: Try to find by UID. This is the most reliable method for subsequent logins.
          let q = query(collection(db, "operators"), where("uid", "==", firebaseUser.uid));
          let querySnapshot = await getDocs(q);
          let operatorDoc;

          if (querySnapshot.empty) {
            // Step 2: If not found by UID, it might be a first-time login.
            // Fallback to finding by the username from the email.
            const emailUsername = firebaseUser.email?.split('@')[0];
            if (!emailUsername) {
              console.error("Firebase user has no valid email. Logging out.");
              await firebaseLogout();
              return;
            }
            
            console.log(`Operator not found by UID for ${firebaseUser.email}, attempting to link account by username: ${emailUsername}`);
            q = query(collection(db, "operators"), where("nome_normalized", "==", emailUsername));
            querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
              // Still not found. This is a true consistency error.
              console.error(`Auth consistency error: Firebase user ${firebaseUser.email} exists but has no operator profile (checked by UID and username). Forcing logout.`);
              await firebaseLogout();
              return;
            }
            
            // Step 3: Found by username. Now, permanently link the UID to the profile.
            operatorDoc = querySnapshot.docs[0];
            console.log(`First login for ${emailUsername}, linking UID to operator profile ${operatorDoc.id}.`);
            const operatorDocRef = doc(db, "operators", operatorDoc.id);
            await setDoc(operatorDocRef, { uid: firebaseUser.uid }, { merge: true });

          } else {
            // Found by UID. This is the normal case for a returning user.
            operatorDoc = querySnapshot.docs[0];
          }
          
          // We have the operator doc, proceed to set the application state.
          const operatorProfile = { ...operatorDoc.data(), id: operatorDoc.id } as Operator;
          operatorProfile.uid = firebaseUser.uid; // Ensure uid is set on the profile object for the session

          // Also ensure the user is marked as active in the database upon login.
          if (operatorProfile.stato !== 'attivo' && operatorProfile.role !== 'admin') {
              const operatorDocRef = doc(db, "operators", operatorDoc.id);
              await updateDoc(operatorDocRef, { stato: 'attivo' });
              operatorProfile.stato = 'attivo';
          }
          
          setUser(firebaseUser);
          setOperator(operatorProfile);
          storeOperator(operatorProfile);

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
