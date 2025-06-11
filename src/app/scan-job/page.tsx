
"use client";

import React from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, ScanLine, CheckCircle, AlertTriangle } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { getOperatorName } from '@/lib/auth';

interface JobOrder {
  id: string;
  department: string;
  details: string;
  assignedTask?: string; // Decideremo dopo
}

// Mock job orders for simulation
const mockJobOrders: JobOrder[] = [
  { 
    id: "COM-12345", 
    department: "Assemblaggio Componenti Elettronici", 
    details: "Assemblaggio scheda madre per Prodotto X.",
    assignedTask: "Montare componenti su PCB secondo schema Z-100."
  },
  { 
    id: "COM-67890", 
    department: "Controllo Qualità", 
    details: "Verifica finale Prodotto Y.",
    assignedTask: "Eseguire test funzionali e ispezione visiva."
  },
  {
    id: "COM-54321",
    department: "Assemblaggio Componenti Elettronici",
    details: "Cablaggio unità di alimentazione per Prodotto Z.",
    assignedTask: "Collegare cavi e connettori come da specifica W-200."
  }
];

export default function ScanJobPage() {
  const { toast } = useToast();
  const [isScanning, setIsScanning] = React.useState(false);
  const [scanSuccess, setScanSuccess] = React.useState(false);
  const [scannedJobOrder, setScannedJobOrder] = React.useState<JobOrder | null>(null);
  
  const [isAlertOpen, setIsAlertOpen] = React.useState(false);
  const [alertInfo, setAlertInfo] = React.useState({ title: "", description: "" });

  const handleSimulateScan = () => {
    setIsScanning(true);
    setScanSuccess(false);
    setScannedJobOrder(null);

    // Simulate selecting one of the mock job orders
    const currentJobOrder = mockJobOrders[Math.floor(Math.random() * mockJobOrders.length)];

    setTimeout(() => {
      setIsScanning(false);
      const operatorName = getOperatorName();
      let operatorDepartment = "N/A"; // Default department

      // In a real app, operator's department would be fetched from user profile/auth data
      if (operatorName === "Daniel") {
        operatorDepartment = "Assemblaggio Componenti Elettronici";
      } else {
        // Fallback for other users or if operator data isn't fully set up
        // This case is less likely due to current login restrictions
        operatorDepartment = "Reparto Generico"; 
      }

      if (currentJobOrder.department !== operatorDepartment) {
        setAlertInfo({ 
          title: "Errore Reparto", 
          description: `Commessa ${currentJobOrder.id} (${currentJobOrder.department}) non appartenente al tuo reparto (${operatorDepartment}). Recarsi presso Ufficio Produzione.` 
        });
        setIsAlertOpen(true);
        setScanSuccess(false); 
      } else {
        setScanSuccess(true);
        setScannedJobOrder(currentJobOrder);
        toast({
          title: "Scansione Riuscita!",
          description: `Commessa ${currentJobOrder.id} (${currentJobOrder.department}) scansionata correttamente.`,
          action: <CheckCircle className="text-green-500" />,
        });
        // Keep job order info displayed, remove visual feedback for scan area after a delay
        setTimeout(() => setScanSuccess(false), 3000); 
      }
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
                ${scanSuccess ? 'border-green-500 bg-green-500/10' : ''}
                ${isAlertOpen && !scanSuccess ? 'border-destructive bg-destructive/10' : ''} 
                `}
              >
                {isScanning && <p className="text-primary font-semibold">Scanning...</p>}
                {!isScanning && !scanSuccess && !scannedJobOrder && !isAlertOpen && <p className="text-muted-foreground">Align barcode here</p>}
                {scanSuccess && !isScanning && <CheckCircle className="h-16 w-16 text-green-500" />}
                {isAlertOpen && !scanSuccess && !isScanning && <AlertTriangle className="h-16 w-16 text-destructive" />}
                {!isScanning && scannedJobOrder && !isAlertOpen && <CheckCircle className="h-16 w-16 text-green-500" />}

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

          {scannedJobOrder && !isAlertOpen && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="font-headline">Dettagli Commessa Attiva: {scannedJobOrder.id}</CardTitle>
                <CardDescription>Reparto: {scannedJobOrder.department}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="font-semibold">Descrizione:</p>
                <p>{scannedJobOrder.details}</p>
                {scannedJobOrder.assignedTask && (
                  <>
                    <p className="font-semibold mt-4">Task Assegnato:</p>
                    <p>{scannedJobOrder.assignedTask}</p>
                  </>
                )}
                {/* Qui potremmo aggiungere altri dati della commessa e azioni */}
                <Button className="mt-4 w-full" onClick={() => alert(`Avvio lavoro per commessa ${scannedJobOrder.id}`)}>
                  Inizia Lavorazione
                </Button>
              </CardContent>
            </Card>
          )}

          <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center">
                  <AlertTriangle className="mr-2 h-6 w-6 text-destructive" />
                  {alertInfo.title}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {alertInfo.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => setIsAlertOpen(false)}>OK</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

        </div>
      </AppShell>
    </AuthGuard>
  );
}

    