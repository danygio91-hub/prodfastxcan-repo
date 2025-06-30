
"use client";

import React from 'react';
import Header from './Header';
import { ThemeToggler } from '@/components/ThemeToggler';

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow container mx-auto px-4 py-8">
        {children}
      </main>
      <footer className="py-4 text-center text-sm text-muted-foreground border-t border-border">
        © {new Date().getFullYear()} ProdFast Xcan. Tutti i diritti riservati.
      </footer>
      <ThemeToggler />
    </div>
  );
}
