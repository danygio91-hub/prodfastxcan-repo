
"use client";

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
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
      if (!user || !operator) {
        router.replace(`/?redirect=${pathname}`);
      } else if (!operator.privacySigned && pathname !== '/operator') {
         router.replace('/operator');
      }
    }
  }, [user, operator, loading, router, pathname]);

  if (loading || !user || !operator) {
     return (
       <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-muted-foreground">Verifica Autenticazione...</p>
        </div>
      </div>
    );
  }
  
  if (!operator.privacySigned && pathname !== '/operator') {
     return (
       <div className="flex items-center justify-center h-screen bg-background">
         <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground">In attesa dell'accettazione della privacy...</p>
          </div>
       </div>
    );
  }

  return <>{children}</>;
}
