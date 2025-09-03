"use client";

import LoginForm from '@/app/forms/LoginForm';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gradient-to-br from-background to-secondary/30">
        <LoginForm />
    </main>
  );
}
