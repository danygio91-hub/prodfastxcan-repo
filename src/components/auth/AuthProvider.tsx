
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/types';
import { useRouter } from 'next/navigation';
import { collection, query, where, getDocs, doc, setDoc, updateDoc, onSnapshot, deleteField } from 'firebase/firestore';
import { logout as firebaseLogout } from '@/lib/auth';

const ACTIVE_MATERIAL_SESSION_KEY_PREFIX = 'prodtime_tracker_active_material_sessions_';
const LAST_LOGIN_TIMESTAMP_KEY = 'last_login_timestamp';

interface AuthContextType {
  user: User | null;
  operator: Operator | null;
  loading: boolean;
  logout: () => Promise<void>;
  refetchOperator: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const operatorRef = useRef(operator);
  operatorRef.current = operator;

  const fullLogout = useCallback(async () => {
    const currentOperator = operatorRef.current;
    
    await firebaseLogout();
    await fetch('/api/auth/session', { method: 'DELETE' });
    
    // On logout, we don't clear material sessions anymore, as they are now persistent.
    localStorage.removeItem(LAST_LOGIN_TIMESTAMP_KEY);
    
    setUser(null);
    setOperator(null);
    storeOperator(null); // This clears the operator from storage
    
    router.replace('/');
  }, [router]);


  const fetchOperatorProfile = useCallback(async (firebaseUser: User): Promise<Operator | null> => {
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
  
  const userRef = useRef(user);
  userRef.current = user;

  const refetchOperator = useCallback(async () => {
    const currentUser = userRef.current;
    if (currentUser) {
        const operatorProfile = await fetchOperatorProfile(currentUser);
        if (operatorProfile) {
          setOperator(operatorProfile);
          storeOperator(operatorProfile);
        }
    }
  }, [fetchOperatorProfile]);

  useEffect(() => {
    // This listener handles the forced logout mechanism.
    const logoutTriggerRef = doc(db, 'system', 'logoutTrigger');
    
    const unsubscribe = onSnapshot(logoutTriggerRef, (docSnap) => {
      const currentOperator = operatorRef.current;
      // We only care about this if a non-admin user is logged in.
      if (!currentOperator || currentOperator.role === 'admin') {
        return;
      }
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        const forceLogoutTimestamp = data.timestamp;
        const lastLoginTimestampStr = localStorage.getItem(LAST_LOGIN_TIMESTAMP_KEY);
        const lastLoginTimestamp = lastLoginTimestampStr ? parseInt(lastLoginTimestampStr, 10) : null;

        if (forceLogoutTimestamp && (!lastLoginTimestamp || forceLogoutTimestamp > lastLoginTimestamp)) {
            console.log("Forced logout signal received from admin. Logging out operator.");
            fullLogout();
        }
      }
    });

    return () => unsubscribe();
  }, [fullLogout]);


  // Effect for auto-logout on mobile devices when app is backgrounded
  useEffect(() => {
    const handleVisibilityChange = () => {
      // A simple regex to check for mobile user agents.
      const isMobile = typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent);
      
      const currentUser = userRef.current;
      const currentOperator = operatorRef.current;
      
      // We only want to auto-logout on mobile devices for non-admin users when the page is hidden.
      if (isMobile && document.visibilityState === 'hidden' && currentUser && currentOperator && currentOperator.role !== 'admin') {
          console.log("App hidden on mobile, logging out user.");
          fullLogout();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fullLogout]);


  // Effect to handle fetching auth state and listening for real-time operator updates
  useEffect(() => {
    let operatorUnsubscribe: (() => void) | null = null;
    
    const authUnsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clean up previous operator listener if it exists
      if (operatorUnsubscribe) {
        operatorUnsubscribe();
        operatorUnsubscribe = null;
      }

      if (firebaseUser) {
        // Sync the token with the server using Session Cookies
        const idToken = await firebaseUser.getIdToken();
        await fetch('/api/auth/session', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ idToken })
        });

        const operatorProfile = await fetchOperatorProfile(firebaseUser);
        if (operatorProfile) {
          // Set user and operator state immediately to prevent race conditions
          setUser(firebaseUser);
          setOperator(operatorProfile);
          storeOperator(operatorProfile);

          // Then, set up the real-time listener for subsequent updates
          const operatorDocRef = doc(db, 'operators', operatorProfile.id);
          operatorUnsubscribe = onSnapshot(operatorDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const updatedOperator = { ...docSnap.data(), id: docSnap.id } as Operator;
                setOperator(updatedOperator);
                storeOperator(updatedOperator);
            } else {
                // The operator document was deleted, force a logout.
                console.error(`Operator document for ${operatorProfile.email} was deleted. Forcing logout.`);
                fullLogout();
            }
          }, (error) => {
             console.error("Error listening to operator document:", error);
             fullLogout();
          });

          localStorage.setItem(LAST_LOGIN_TIMESTAMP_KEY, Date.now().toString());

          // Perform redirect after login is confirmed and state is set
           const targetPath = localStorage.getItem('login_redirect_path');
           localStorage.removeItem('login_redirect_path'); // Clean up

          // If the operator has an active job, always redirect to the scan-job page
          if (operatorProfile.activeJobId) {
              router.replace('/scan-job');
          } else if (targetPath) {
              router.replace(targetPath);
          } else if (operatorProfile.role === 'admin') {
              router.replace('/admin/dashboard');
          } else if (operatorProfile.role === 'supervisor') {
              router.replace('/supervisor/dashboard');
          } else {
              router.replace('/dashboard');
          }
          
        } else {
          console.error(`Auth consistency error: Firebase user ${firebaseUser.email} exists but has no matching operator profile. Forcing logout.`);
          await fullLogout();
        }
      } else {
        setUser(null);
        setOperator(null);
        storeOperator(null);
      }
      setLoading(false);
    });

    return () => {
        authUnsubscribe();
        if (operatorUnsubscribe) {
            operatorUnsubscribe();
        }
    };
  }, [fetchOperatorProfile, fullLogout, router]);


  return (
    <AuthContext.Provider value={{ user, operator, loading, logout: fullLogout, refetchOperator }}>
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
