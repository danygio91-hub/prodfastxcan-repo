"use client";

import React from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Users } from 'lucide-react';

export default function OperatorDataPage() {
  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6">
          <Link href="/dashboard" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>

          <Card>
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Users className="h-8 w-8 text-primary" />
                <div>
                  <CardTitle className="text-2xl font-headline">Operator Data</CardTitle>
                  <CardDescription>View and manage operator information.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                This section is under development. Here you will be able to view and manage operator data.
              </p>
              {/* Placeholder for operator data table or management interface */}
              <div className="mt-6 p-8 border border-dashed border-border rounded-md text-center text-muted-foreground">
                Operator data management interface will be here.
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
