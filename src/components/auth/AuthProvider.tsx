
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { storeOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter, usePathname } from 'next/navigation';
import { collection, query, where, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';
import { logout as firebaseLogout } from '@/lib/auth';

const ACTIVE_JOB_STORAGE_KEY = 'prodtime_tracker_active_job';
const ACTIVE_MATERIAL_SESSION_KEY = 'prodtime_tracker_active_material_sessions';
const LAST_LOGIN_TIMESTAMP_KEY = 'last_login_timestamp';
const FORCE_LOGOUT_TIMESTAMP_KEY = 'force_logout_timestamp';

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
  const pathname = usePathname();

  const fullLogout = useCallback(async () => {
    const currentOperatorId = operator?.id;
    if (currentOperatorId && operator?.role !== 'admin' && operator?.role !== 'superadvisor') {
      try {
        const operatorRef = doc(db, "operators", currentOperatorId);
        await updateDoc(operatorRef, { stato: 'inattivo' });
      } catch (e) {
        console.error("Could not set operator status to inactive on logout", e);
      }
    }
    
    await firebaseLogout();
    
    // Clear all app-related local storage
    localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_MATERIAL_SESSION_KEY);
    localStorage.removeItem(LAST_LOGIN_TIMESTAMP_KEY);
    
    setUser(null);
    setOperator(null);
    storeOperator(null); // This clears the operator from storage
    
    router.replace('/');
  }, [operator, router]);


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
    // This effect handles forced logouts triggered by an admin reset.
    const handleForcedLogout = (event: MessageEvent) => {
      if (event.data?.type === 'FORCE_LOGOUT' && event.data?.timestamp) {
        fullLogout();
      }
    };

    const channel = new BroadcastChannel('auth_channel');
    channel.addEventListener('message', handleForcedLogout);

    const lastLoginTimestamp = localStorage.getItem(LAST_LOGIN_TIMESTAMP_KEY);
    const forceLogoutTimestamp = localStorage.getItem(FORCE_LOGOUT_TIMESTAMP_KEY);

    if (forceLogoutTimestamp && (!lastLoginTimestamp || forceLogoutTimestamp > lastLoginTimestamp)) {
      console.log("Forced logout triggered by admin reset.");
      fullLogout();
    }
    
    return () => {
      channel.removeEventListener('message', handleForcedLogout);
      channel.close();
    }
  }, [fullLogout]);

  // Effect to handle fetching auth state from Firebase
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const operatorProfile = await fetchOperatorProfile(firebaseUser);
        if (operatorProfile) {
          if (operatorProfile.stato !== 'attivo' && operatorProfile.role !== 'admin' && operatorProfile.role !== 'superadvisor') {
            const operatorDocRef = doc(db, "operators", operatorProfile.id);
            await updateDoc(operatorDocRef, { stato: 'attivo' });
            operatorProfile.stato = 'attivo';
          }
          setUser(firebaseUser);
          setOperator(operatorProfile);
          storeOperator(operatorProfile);
          localStorage.setItem(LAST_LOGIN_TIMESTAMP_KEY, Date.now().toString());
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

    return () => unsubscribe();
  }, [fetchOperatorProfile, fullLogout]);

  // Effect to handle routing based on auth state
  useEffect(() => {
    if (loading) return;

    if (user && operator && pathname === '/') {
      const redirectPath = localStorage.getItem('login_redirect_path');
      localStorage.removeItem('login_redirect_path');

      if (redirectPath) {
        router.replace(redirectPath);
      } else {
        const isOperator = operator.role === 'operator' || operator.role === 'superadvisor';
        router.replace(isOperator ? '/dashboard' : '/admin/dashboard');
      }
    }
  }, [user, operator, loading, pathname, router]);

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

    