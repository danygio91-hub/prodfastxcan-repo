
"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import LoginForm from '@/app/forms/LoginForm';
import { useAuth } from '@/components/auth/AuthProvider';
import { Loader2 } from 'lucide-react';


export default function HomePage() {
  const { user, operator, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && operator) {
      if (operator.role === 'admin') {
        router.replace('/admin/dashboard');
      } else {
        router.replace('/dashboard');
      }
    }
  }, [user, operator, loading, router]);


  if (loading || (user && operator)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Caricamento...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <LoginForm />
    </div>
  );
}
