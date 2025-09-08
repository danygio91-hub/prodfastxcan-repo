
"use client";

import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from './auth/AuthProvider';
import { Loader2 } from 'lucide-react';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
    const { user, operator, loading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (!loading) {
            if (!user) {
                // Not logged in, redirect to login page
                router.replace('/');
            } else if (operator && !operator.privacySigned && operator.role !== 'admin' && pathname !== '/operator') {
                // Logged in but privacy not signed (and not an admin), redirect to operator page to force signature
                router.replace('/operator');
            }
        }
    }, [user, operator, loading, router, pathname]);
    
    // While loading or if user is not set, show a loader
    if (loading || !user || !operator) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }
    
    // If privacy is not signed (and not an admin), show loader while redirecting
    // but allow the operator page to render
    if (!operator.privacySigned && operator.role !== 'admin' && pathname !== '/operator') {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    // If everything is fine, render the children
    return <>{children}</>;
}
