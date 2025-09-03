
"use client";

import React from 'react';

// --- AUTHENTICATION TEMPORARILY BYPASSED FOR DATABASE SEEDING ---
// This component normally protects admin routes. It has been modified
// to allow direct access for initial setup.
// We will restore its functionality later.

interface AdminAuthGuardProps {
  children: React.ReactNode;
}

export default function AdminAuthGuard({ children }: AdminAuthGuardProps) {
  return <>{children}</>;
}
