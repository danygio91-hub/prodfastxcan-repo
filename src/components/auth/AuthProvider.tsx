
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter, usePathname } from 'next/navigation';
import { collection, doc, getDocs, setDoc, query, where, limit } from 'firebase/firestore';
import { logout as firebaseLogout, getOperator } from '@/lib/auth';


interface AuthContextType {
  user: User | null;
  operator: Operator | null;
  loading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({ user: null, operator: null, loading: true, logout: () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = useCallback(async () => {
    const currentOperator = getOperator();
    if(currentOperator && currentOperator.role !== 'admin') {
      const operatorRef = doc(db, "operators", currentOperator.id);
      await setDoc(operatorRef, { stato: 'inattivo' }, { merge: true });
    }
    
    await firebaseLogout();
    router.push('/');
  }, [router]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        // User is authenticated, find their profile by UID.
        // UID is the single source of truth linking Auth and Firestore.
        const q = query(collection(db, "operators"), where("uid", "==", firebaseUser.uid), limit(1));
        const querySnapshot = await getDocs(q);
        
        let operatorProfile: Operator | null = null;
        if (!querySnapshot.empty) {
            const operatorDoc = querySnapshot.docs[0];
            operatorProfile = operatorDoc.data() as Operator;
            operatorProfile.id = operatorDoc.id; // Ensure ID from doc is included
        }
        
        if (operatorProfile) {
            setUser(firebaseUser);
            setOperator(operatorProfile);
            storeOperator(operatorProfile);
            
            if (!operatorProfile.privacySigned && pathname !== '/operator-data') {
                router.replace('/operator-data');
            }
        } else {
            // This case handles when a Firebase session exists but the user profile was deleted
            // from Firestore, or if the initial login somehow failed to link the UID.
            // It safely logs out the user.
            await handleLogout();
        }
      } else {
        // User is logged out
        setUser(null);
        setOperator(null);
        storeOperator(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router, pathname, handleLogout]);
  

  return (
    <AuthContext.Provider value={{ user, operator, loading, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
