
"use client";

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth/AuthProvider';
import { Loader2 } from 'lucide-react';

interface AdminAuthGuardProps {
  children: React.ReactNode;
}

export default function AdminAuthGuard({ children }: AdminAuthGuardProps) {
  const { operator, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!operator || (operator.role !== 'admin' && operator.role !== 'supervisor')) {
        // If not an admin or supervisor, redirect to the main login/dashboard page
        router.replace('/');
      }
    }
  }, [operator, loading, router]);
  
  if (loading || !operator || (operator.role !== 'admin' && operator.role !== 'supervisor')) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
