
"use client";

import React from 'react';
import Header from './Header';
import { usePathname } from 'next/navigation';
import { ThemeToggler } from '@/components/ThemeToggler';
import ActiveJobStatusBar from '@/components/operator/ActiveJobStatusBar';
import ActiveMaterialSessionBar from '@/components/operator/ActiveMaterialSessionBar';
import { useAuth } from '../auth/AuthProvider';
import LiveClock from './LiveClock';
import OperatorNavMenu from '../operator/OperatorNavMenu';

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { operator } = useAuth();
  const pathname = usePathname();
  const isAdminPage = pathname.startsWith('/admin') || pathname.startsWith('/supervisor');
  const isOperatorOrSupervisor = operator && (operator.role === 'operator' || operator.role === 'supervisor');
  const hasSignedPrivacy = isOperatorOrSupervisor && operator.privacySigned;
  
  const isFullScreenPage = pathname.includes('odl-designer');

  if (isFullScreenPage) {
    return (
        <div className="h-screen w-full bg-background overflow-hidden">
            {children}
        </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow w-full px-2 sm:px-6 lg:px-8 py-4 sm:py-8">
        {isOperatorOrSupervisor && hasSignedPrivacy && !isAdminPage && (
          <>
            <OperatorNavMenu />
            <LiveClock />
          </>
        )}
        {!isAdminPage && !isOperatorOrSupervisor && operator?.role === 'admin' && <LiveClock />}
        {(isAdminPage || (operator?.role === 'admin' && isAdminPage)) && <LiveClock />}
        <div className="mt-6">
            {children}
        </div>
      </main>
      <footer className="py-4 text-center text-sm text-muted-foreground border-t border-border">
        <p>© {new Date().getFullYear()} ProdFast Xcan. Tutti i diritti riservati.</p>
        <p className="mt-1 text-xs font-mono">Versione: PFX-only-scan-1.02</p>
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

  
