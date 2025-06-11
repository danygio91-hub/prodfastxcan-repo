"use client";

import React from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, ScanLine, AlertTriangle, ArrowRight } from 'lucide-react';

interface DashboardItemProps {
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
}

const DashboardItem: React.FC<DashboardItemProps> = ({ title, description, icon: Icon, href }) => (
  <Card className="hover:shadow-lg transition-shadow duration-300">
    <CardHeader className="pb-4">
      <div className="flex items-center justify-between">
        <Icon className="h-10 w-10 text-accent" />
        <Link href={href} passHref>
          <Button variant="ghost" size="icon" className="text-accent hover:bg-accent/10">
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>
      </div>
    </CardHeader>
    <CardContent>
      <CardTitle className="text-xl font-headline mb-1">{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardContent>
  </Card>
);

export default function DashboardPage() {
  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Access core functions of ProdTime Tracker.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <DashboardItem
              title="Operator Data"
              description="View and manage operator information."
              icon={Users}
              href="/operator-data"
            />
            <DashboardItem
              title="Scan Job Order"
              description="Scan a job order barcode to start or continue work."
              icon={ScanLine}
              href="/scan-job"
            />
            <DashboardItem
              title="Report Problem"
              description="Report any issues encountered during production."
              icon={AlertTriangle}
              href="/report-problem"
            />
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
