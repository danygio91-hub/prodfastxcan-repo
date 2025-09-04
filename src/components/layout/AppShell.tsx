
"use client";

import React from 'react';
import Header from './Header';
import { ThemeToggler } from '@/components/ThemeToggler';
import ActiveJobStatusBar from '@/components/operator/ActiveJobStatusBar';
import ActiveMaterialSessionBar from '@/components/operator/ActiveMaterialSessionBar';
import { useAuth } from '../auth/AuthProvider';

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { operator } = useAuth();
  
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow w-full max-w-full px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
      <footer className="py-4 text-center text-sm text-muted-foreground border-t border-border">
        <p>© {new Date().getFullYear()} ProdFast Xcan. Tutti i diritti riservati.</p>
        <p className="mt-1 text-xs font-mono">Versione: pfx-only-scan-0508</p>
      </footer>
      <ThemeToggler />
      {operator && operator.role !== 'admin' && (
        <>
          <ActiveJobStatusBar />
          <ActiveMaterialSessionBar />
        </>
      )} 
    </div>
  );
}
