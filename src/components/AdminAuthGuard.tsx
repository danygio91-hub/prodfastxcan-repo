
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
      if (!operator) {
        // If no operator is found, redirect to login
        router.replace('/');
      } else if (operator.role !== 'admin' && operator.role !== 'superadvisor') {
        // If the operator is not an admin or superadvisor, redirect to their dashboard
        router.replace('/dashboard');
      }
    }
  }, [operator, loading, router]);

  if (loading || !operator || (operator.role !== 'admin' && operator.role !== 'superadvisor')) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
