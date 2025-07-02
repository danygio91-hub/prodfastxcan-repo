
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
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      (async () => {
        setLoading(true);
        try {
          if (firebaseUser) {
            let operatorProfile: Operator | null = null;
            
            // First, try to find by UID. This is the primary, most secure method.
            const qByUid = query(collection(db, "operators"), where("uid", "==", firebaseUser.uid), limit(1));
            const uidSnapshot = await getDocs(qByUid);

            if (!uidSnapshot.empty) {
                const operatorDoc = uidSnapshot.docs[0];
                operatorProfile = operatorDoc.data() as Operator;
                operatorProfile.id = operatorDoc.id;
            } else if (firebaseUser.email) {
                // FALLBACK: If not found by UID (can happen during first-login race condition),
                // try to find by the username derived from the email.
                const username = firebaseUser.email.split('@')[0];
                const qByUsername = query(collection(db, "operators"), where("nome_normalized", "==", username), limit(1));
                const usernameSnapshot = await getDocs(qByUsername);
                
                if (!usernameSnapshot.empty) {
                    const operatorDoc = usernameSnapshot.docs[0];
                    operatorProfile = operatorDoc.data() as Operator;
                    operatorProfile.id = operatorDoc.id;
                    // UID is being written by the login function. We'll proceed.
                    // The next auth state change will use the UID.
                }
            }
            
            if (operatorProfile) {
                // If a profile was found (either by UID or fallback), set the session.
                setUser(firebaseUser);
                setOperator(operatorProfile);
                storeOperator(operatorProfile);
                
                // Handle redirection for privacy policy.
                if (!operatorProfile.privacySigned && pathname !== '/operator-data') {
                    router.replace('/operator-data');
                }
            } else {
                // If we STILL can't find a profile, something is genuinely wrong.
                // A user exists in Firebase Auth but not in our operators collection.
                console.error(`Inconsistent state: Auth user ${firebaseUser.uid} exists but has no operator profile. Logging out.`);
                await handleLogout();
            }
          } else {
            // User is not logged in.
            setUser(null);
            setOperator(null);
            storeOperator(null);
          }
        } catch (error) {
           console.error("Error during authentication state change:", error);
           await handleLogout();
        } finally {
          setLoading(false);
        }
      })();
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
