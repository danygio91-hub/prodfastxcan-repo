
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
    if (loading) return; // Don't do anything while loading

    // If not logged in, redirect to login page
    if (!user) {
      router.replace('/');
      return;
    }

    // If operator data is loaded, check for privacy signature
    // and redirect if they are not signed and not on the signing page.
    if (operator && !operator.privacySigned && pathname !== '/operator-data') {
      router.replace('/operator-data');
      return;
    }

  }, [user, operator, loading, router, pathname]);

  // Show a skeleton loader while auth state is loading or if a redirect is imminent.
  if (loading || !user || (operator && !operator.privacySigned && pathname !== '/operator-data')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Skeleton className="h-12 w-1/2 mb-4" />
        <Skeleton className="h-8 w-1/3 mb-2" />
        <Skeleton className="h-8 w-1/3" />
      </div>
    );
  }

  // If all checks pass, render the protected content
  if (user) {
    return <>{children}</>;
  }

  // Fallback to null if no user, though useEffect should have redirected.
  return null;
}
