"use client";

import React from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import ProblemReportForm from '@/components/forms/ProblemReportForm';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function ReportProblemPage() {
  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6 max-w-2xl mx-auto">
          <Link href="/dashboard" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
          <ProblemReportForm />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
