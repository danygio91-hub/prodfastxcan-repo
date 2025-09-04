
"use client";

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, User } from 'lucide-react';
import Image from 'next/image';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="flex flex-col items-center justify-center gap-8 w-full max-w-md">
        <Image src="/logo.png" alt="PFXcan Logo" width={150} height={100} unoptimized={true} priority={true} />
        
        <Card className="w-full">
            <CardHeader>
                <CardTitle>Accesso Rapido</CardTitle>
                <CardDescription>Scegli la dashboard a cui vuoi accedere.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4">
                <Button asChild size="lg" className="h-20 text-lg">
                    <Link href="/admin/dashboard">
                        <Shield className="mr-4 h-7 w-7"/>
                        Dashboard Admin
                    </Link>
                </Button>
                <Button asChild variant="secondary" size="lg" className="h-20 text-lg">
                     <Link href="/dashboard">
                        <User className="mr-4 h-7 w-7"/>
                        Dashboard Operatore
                    </Link>
                </Button>
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
