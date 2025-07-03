
"use client";

import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const { user, operator, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Wait until loading is complete before doing anything.
    if (loading) {
      return;
    }

    // If there's no user, they should be on the login page.
    if (!user) {
      router.replace('/');
      return;
    }

    // If there IS a user, we must have an operator profile to proceed.
    // If the operator profile is loaded, check if privacy is signed.
    // If not, redirect to the page where they can sign it.
    if (operator && !operator.privacySigned && pathname !== '/operator-data') {
      router.replace('/operator-data');
      return;
    }
  }, [user, operator, loading, router, pathname]);

  // Display a loading skeleton if:
  // 1. We are still in the initial loading phase.
  // 2. We don't have a user object yet.
  // 3. We have a user, but are still waiting for the operator profile (and we're not on the one page that can handle that state).
  // 4. The operator profile is loaded, but privacy is not signed (and we're not on the one page that can handle that state).
  // This condition safely prevents rendering children with incomplete data.
  if (loading || !user || (!operator && pathname !== '/operator-data') || (operator && !operator.privacySigned && pathname !== '/operator-data')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Skeleton className="h-12 w-1/2 mb-4" />
        <Skeleton className="h-8 w-1/3 mb-2" />
        <Skeleton className="h-8 w-1/3" />
      </div>
    );
  }

  // If all checks pass, render the protected content.
  return <>{children}</>;
}
