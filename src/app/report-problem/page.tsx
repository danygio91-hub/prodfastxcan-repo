
"use client";

import React from 'react';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import ProblemReportForm from '@/components/forms/ProblemReportForm';
import { useToast } from "@/hooks/use-toast";
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';

export default function ReportProblemPage() {
  const { toast } = useToast();

  const handleSuccess = () => {
    // This can be used to redirect or clear state if needed
    console.log("Standalone problem report successful");
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8 max-w-2xl mx-auto">
          <OperatorNavMenu />
          <ProblemReportForm onSuccess={handleSuccess} />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
