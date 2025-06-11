
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
import { ArrowLeft, ScanLine, CheckCircle, AlertTriangle, Package, CalendarDays, ClipboardList, Computer } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { getOperatorName } from '@/lib/auth';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface JobOrder {
  id: string; // N° Commessa (già presente)
  department: string;
  details: string; // Descrizione Lavorazione (già presente come details)
  assignedTask?: string; 
  ordinePF: string; // Ordine PF
  numeroODL: string; // N° ODL
  dataConsegnaFinale: string; // Data consegna finale
  postazioneLavoro: string; // Postazione di lavoro
}

// Mock job orders for simulation
const mockJobOrders: JobOrder[] = [
  { 
    id: "COM-12345", 
    department: "Assemblaggio Componenti Elettronici", 
    details: "Assemblaggio scheda madre per Prodotto X.",
    assignedTask: "Montare componenti su PCB secondo schema Z-100.",
    ordinePF: "PF-001",
    numeroODL: "ODL-789",
    dataConsegnaFinale: "2024-12-15",
    postazioneLavoro: "Postazione A-05"
  },
  { 
    id: "COM-67890", 
    department: "Controllo Qualità", 
    details: "Verifica finale Prodotto Y.",
    assignedTask: "Eseguire test funzionali e ispezione visiva.",
    ordinePF: "PF-002",
    numeroODL: "ODL-790",
    dataConsegnaFinale: "2024-11-30",
    postazioneLavoro: "Banco CQ-02"
  },
  {
    id: "COM-54321",
    department: "Assemblaggio Componenti Elettronici",
    details: "Cablaggio unità di alimentazione per Prodotto Z.",
    assignedTask: "Collegare cavi e connettori come da specifica W-200.",
    ordinePF: "PF-003",
    numeroODL: "ODL-791",
    dataConsegnaFinale: "2025-01-10",
    postazioneLavoro: "Postazione B-01"
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
    setIsAlertOpen(false); // Reset alert state on new scan

    // Simulate selecting one of the mock job orders
    const currentJobOrder = mockJobOrders[Math.floor(Math.random() * mockJobOrders.length)];

    setTimeout(() => {
      setIsScanning(false);
      const operatorName = getOperatorName();
      let operatorDepartment = "N/A"; 

      if (operatorName === "Daniel") {
        operatorDepartment = "Assemblaggio Componenti Elettronici";
      } else {
        operatorDepartment = "Reparto Generico"; 
      }

      if (currentJobOrder.department !== operatorDepartment) {
        setAlertInfo({ 
          title: "Errore Reparto", 
          description: `Commessa ${currentJobOrder.id} (${currentJobOrder.department}) non appartenente al tuo reparto (${operatorDepartment}). Recarsi presso Ufficio Produzione.` 
        });
        setIsAlertOpen(true);
        setScanSuccess(false); 
        setScannedJobOrder(null); // Clear job order info if department mismatch
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
                ${scanSuccess && !isAlertOpen ? 'border-green-500 bg-green-500/10' : ''}
                ${isAlertOpen ? 'border-destructive bg-destructive/10' : ''} 
                `}
              >
                {isScanning && <p className="text-primary font-semibold">Scanning...</p>}
                {!isScanning && !scannedJobOrder && !isAlertOpen && <p className="text-muted-foreground">Align barcode here</p>}
                {scanSuccess && !isScanning && !isAlertOpen && <CheckCircle className="h-16 w-16 text-green-500" />}
                {isAlertOpen && !isScanning && <AlertTriangle className="h-16 w-16 text-destructive" />}
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
            <Card className="mt-6 shadow-lg">
              <CardHeader>
                <CardTitle className="font-headline flex items-center">
                  <Package className="mr-3 h-7 w-7 text-primary" />
                  Dettagli Commessa Attiva: {scannedJobOrder.id}
                </CardTitle>
                <CardDescription>Reparto: {scannedJobOrder.department}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="ordinePF" className="flex items-center text-sm text-muted-foreground">
                      <ClipboardList className="mr-2 h-4 w-4 text-primary" />
                      Ordine PF
                    </Label>
                    <Input id="ordinePF" value={scannedJobOrder.ordinePF} readOnly className="bg-input text-foreground mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="numeroODL" className="flex items-center text-sm text-muted-foreground">
                      <ClipboardList className="mr-2 h-4 w-4 text-primary" />
                      N° ODL
                    </Label>
                    <Input id="numeroODL" value={scannedJobOrder.numeroODL} readOnly className="bg-input text-foreground mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="dataConsegnaFinale" className="flex items-center text-sm text-muted-foreground">
                      <CalendarDays className="mr-2 h-4 w-4 text-primary" />
                      Data Consegna Finale
                    </Label>
                    <Input id="dataConsegnaFinale" value={scannedJobOrder.dataConsegnaFinale} readOnly className="bg-input text-foreground mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="postazioneLavoro" className="flex items-center text-sm text-muted-foreground">
                      <Computer className="mr-2 h-4 w-4 text-primary" />
                      Postazione di Lavoro
                    </Label>
                    <Input id="postazioneLavoro" value={scannedJobOrder.postazioneLavoro} readOnly className="bg-input text-foreground mt-1" />
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="descrizioneLavorazione" className="flex items-center text-sm text-muted-foreground">
                    <Package className="mr-2 h-4 w-4 text-primary" />
                    Descrizione Lavorazione
                  </Label>
                  <p className="mt-1 p-2 bg-input rounded-md text-foreground">{scannedJobOrder.details}</p>
                </div>

                {scannedJobOrder.assignedTask && (
                  <div>
                    <Label htmlFor="taskAssegnato" className="flex items-center text-sm text-muted-foreground">
                      <ClipboardList className="mr-2 h-4 w-4 text-primary" />
                      Task Assegnato
                    </Label>
                    <p className="mt-1 p-2 bg-input rounded-md text-foreground">{scannedJobOrder.assignedTask}</p>
                  </div>
                )}
                
                <Button className="mt-6 w-full bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => alert(`Avvio lavoro per commessa ${scannedJobOrder.id}`)}>
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
                <AlertDialogAction onClick={() => { setIsAlertOpen(false); setScannedJobOrder(null); } }>OK</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

        </div>
      </AppShell>
    </AuthGuard>
  );
}
    
