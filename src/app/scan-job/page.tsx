"use client";

import React from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, ScanLine, CheckCircle } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

export default function ScanJobPage() {
  const { toast } = useToast();
  const [isScanning, setIsScanning] = React.useState(false);
  const [scanSuccess, setScanSuccess] = React.useState(false);

  const handleSimulateScan = () => {
    setIsScanning(true);
    setScanSuccess(false);
    setTimeout(() => {
      setIsScanning(false);
      setScanSuccess(true);
      toast({
        title: "Scan Successful!",
        description: "Job Order COM-12345 has been scanned.",
        action: <CheckCircle className="text-green-500" />,
      });
      setTimeout(() => setScanSuccess(false), 3000); // Reset visual feedback
    }, 1500); // Simulate scanning time
  };

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
                <ScanLine className="h-8 w-8 text-primary" />
                <div>
                  <CardTitle className="text-2xl font-headline">Scan Job Order (Commessa)</CardTitle>
                  <CardDescription>Scan the barcode on the job order to begin or continue tracking time.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center space-y-6">
              <div 
                className={`w-full max-w-xs h-48 border-2 rounded-lg flex items-center justify-center transition-all duration-300
                ${isScanning ? 'border-primary animate-pulse' : 'border-border'}
                ${scanSuccess ? 'border-green-500 bg-green-50' : ''}`}
              >
                {isScanning && <p className="text-primary font-semibold">Scanning...</p>}
                {!isScanning && !scanSuccess && <p className="text-muted-foreground">Align barcode here</p>}
                {scanSuccess && <CheckCircle className="h-16 w-16 text-green-500" />}
              </div>
              
              <Button 
                onClick={handleSimulateScan} 
                disabled={isScanning}
                className="w-full max-w-xs bg-accent text-accent-foreground hover:bg-accent/90"
              >
                <ScanLine className="mr-2 h-5 w-5" />
                {isScanning ? "Scanning..." : "Simulate Barcode Scan"}
              </Button>
              <p className="text-sm text-muted-foreground">
                In a real application, this would activate the device camera or barcode scanner.
              </p>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
