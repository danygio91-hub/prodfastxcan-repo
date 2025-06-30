
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getOperator as getOperatorFromStorage, logout as authLogout } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { useRouter } from 'next/navigation';

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUser(user);
        setOperator(getOperatorFromStorage());
      } else {
        setUser(null);
        setOperator(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);
  
  const handleLogout = useCallback(async () => {
    await authLogout();
    router.push('/');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, operator, loading, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
