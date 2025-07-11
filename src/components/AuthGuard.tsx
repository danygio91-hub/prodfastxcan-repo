
"use client";

import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import AppShell from './layout/AppShell';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const { user, operator, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // This effect handles all redirection logic based on auth state.
    
    // While the initial auth check is running, do nothing.
    if (loading) {
      return;
    }

    // If auth check is complete and there's no user, they must be on the login page.
    if (!user) {
      router.replace('/');
      return;
    }

    // If we have a user and their operator profile is loaded, check for privacy agreement.
    // If they haven't signed, and they are not on the page to do so, redirect them there.
    if (operator && !operator.privacySigned && pathname !== '/operator') {
      router.replace('/operator');
      return;
    }
  }, [user, operator, loading, router, pathname]);

  // This block handles what to RENDER while waiting for auth state or redirection.
  // It acts as a "hard gate" to prevent rendering children with incomplete data.

  // If we are still loading, or if loading is finished but we don't have a user,
  // show a full-page skeleton. The useEffect above will handle the actual redirect.
  if (loading || !user) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center h-full p-4 space-y-4">
            <Skeleton className="h-16 w-16 rounded-full" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-32 w-full" />
        </div>
      </AppShell>
    );
  }

  // CRITICAL CHECK: At this point, we have a `user` but we might still be waiting for the `operator` profile
  // from the database. We MUST wait for it before rendering any child components that might use it.
  if (!operator) {
     return (
      <AppShell>
        <div className="flex flex-col items-center justify-center h-full p-4 space-y-4">
            <Skeleton className="h-16 w-16 rounded-full" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-32 w-full" />
        </div>
      </AppShell>
    );
  }
  
  // Another "hard gate" for privacy. If we are here, operator is loaded.
  // If privacy is not signed, we show a skeleton while the useEffect redirects.
  if (!operator.privacySigned && pathname !== '/operator') {
       return (
        <AppShell>
            <div className="flex flex-col items-center justify-center h-full p-4 space-y-4">
                <Skeleton className="h-16 w-16 rounded-full" />
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-32 w-full" />
            </div>
        </AppShell>
       );
  }

  // If all checks pass (user is logged in, operator profile is loaded, privacy is signed),
  // render the protected page content.
  return <>{children}</>;
}
