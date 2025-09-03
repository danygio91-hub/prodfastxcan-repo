"use client";

import React from 'react';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
    // Temporarily disabled to allow direct access
    return <>{children}</>;
}
