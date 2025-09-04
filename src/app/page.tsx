
"use client";

import React from 'react';
import LoginForm from './forms/LoginForm';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <LoginForm />
    </div>
  );
}
