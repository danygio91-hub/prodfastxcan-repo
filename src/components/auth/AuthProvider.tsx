
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

  const fetchOperatorProfile = useCallback(async (firebaseUser: User) => {
    // Strategy 1: Find by UID (most efficient and secure)
    const q_uid = query(collection(db, "operators"), where("uid", "==", firebaseUser.uid));
    const uidSnapshot = await getDocs(q_uid);
    if (!uidSnapshot.empty) {
      return { ...uidSnapshot.docs[0].data(), id: uidSnapshot.docs[0].id } as Operator;
    }

    // Strategy 2: Find by Email (for first login or if UID is missing)
    if (firebaseUser.email) {
      const q_email = query(collection(db, "operators"), where("email", "==", firebaseUser.email));
      const emailSnapshot = await getDocs(q_email);
      if (!emailSnapshot.empty) {
        const operatorDoc = emailSnapshot.docs[0];
        // Link the UID to the profile for future logins
        await setDoc(operatorDoc.ref, { uid: firebaseUser.uid }, { merge: true });
        return { ...operatorDoc.data(), uid: firebaseUser.uid, id: operatorDoc.id } as Operator;
      }
    }
    
    return null; // No profile found
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        try {
          const operatorProfile = await fetchOperatorProfile(firebaseUser);
          
          if (operatorProfile) {
            // Set operator status to active
            if (operatorProfile.stato !== 'attivo' && operatorProfile.role !== 'admin') {
                const operatorDocRef = doc(db, "operators", operatorProfile.id);
                await updateDoc(operatorDocRef, { stato: 'attivo' });
                operatorProfile.stato = 'attivo';
            }
            
            setUser(firebaseUser);
            setOperator(operatorProfile);
            storeOperator(operatorProfile);

            // Handle redirection after user state is fully set
            const redirectPath = localStorage.getItem('login_redirect_path');
            localStorage.removeItem('login_redirect_path'); // Clean up immediately

            if (redirectPath) {
                router.push(redirectPath);
            } else {
                router.push(operatorProfile.role === 'admin' ? '/admin/dashboard' : '/dashboard');
            }
            
          } else {
             console.error(`Auth consistency error: Firebase user ${firebaseUser.email} exists but has no matching operator profile. Forcing logout.`);
             await firebaseLogout();
          }
        } catch (error) {
          console.error("Error during authentication process:", error);
          await firebaseLogout();
        }
      } else {
        // User is signed out. Clear all state.
        setUser(null);
        setOperator(null);
        storeOperator(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [fetchOperatorProfile, router]);


  const logout = useCallback(async () => {
    const currentOperator = operator;
    
    // Clear local state before async operations
    setUser(null);
    setOperator(null);
    storeOperator(null);

    if (currentOperator && currentOperator.role !== 'admin') {
      try {
        const operatorRef = doc(db, "operators", currentOperator.id);
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
