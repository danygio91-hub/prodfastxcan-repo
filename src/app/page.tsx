"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to the admin dashboard immediately
    router.replace('/admin/dashboard');
  }, [router]);

  // Render a loading state while redirecting
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <Loader2 className="h-12 w-12 animate-spin text-primary" />
      <p className="mt-4 text-muted-foreground">Reindirizzamento alla dashboard...</p>
    </div>
  );
}
