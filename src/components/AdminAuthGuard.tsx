"use client";

import React from 'react';

interface AdminAuthGuardProps {
  children: React.ReactNode;
}

export default function AdminAuthGuard({ children }: AdminAuthGuardProps) {
  // Temporarily disabled to allow direct access
  return <>{children}</>;
}
