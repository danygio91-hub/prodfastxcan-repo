
"use client";

import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from './auth/AuthProvider';
import { Loader2 } from 'lucide-react';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
    const { user, operator, loading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (loading) return;

        if (!user) {
            router.replace('/');
            return;
        }

        if (operator && operator.role !== 'admin') {
            const checkPrivacy = async () => {
                const policyRef = doc(db, "configuration", "currentPolicy");
                const operatorRef = doc(db, "operators", operator.id);
                
                const [policySnap, operatorSnap] = await Promise.all([
                    getDoc(policyRef),
                    getDoc(operatorRef)
                ]);

                const policyVersion = policySnap.exists() ? policySnap.data().lastUpdated?.toMillis() : null;
                const operatorData = operatorSnap.exists() ? operatorSnap.data() : null;

                const signedVersion = operatorData?.privacyVersion;
                const isSigned = operatorData?.privacySigned;

                // Redirect if not signed OR if the signed version is older than the current policy version
                if (!isSigned || (policyVersion && signedVersion && signedVersion < policyVersion)) {
                    if (pathname !== '/operator') {
                        router.replace('/operator');
                    }
                }
            };
            checkPrivacy();
        }

    }, [user, operator, loading, router, pathname]);
    
    if (loading || !user || !operator) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }
    
    // While checking privacy, show a loader but allow /operator to render
    if (operator.role !== 'admin' && pathname !== '/operator' && !operator.privacySigned) {
         return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return <>{children}</>;
}
