
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
  id: string; 
  department: string;
  details: string; 
  assignedTask?: string; 
  ordinePF: string; 
  numeroODL: string; 
  dataConsegnaFinale: string; 
  postazioneLavoro: string; 
}

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
  const [isScanningJob, setIsScanningJob] = React.useState(false);
  const [jobScanSuccess, setJobScanSuccess] = React.useState(false);
  const [scannedJobOrder, setScannedJobOrder] = React.useState<JobOrder | null>(null);
  
  const [isJobAlertOpen, setIsJobAlertOpen] = React.useState(false);
  const [jobAlertInfo, setJobAlertInfo] = React.useState({ title: "", description: "" });

  const [isWorkstationScanRequired, setIsWorkstationScanRequired] = React.useState(false);
  const [isScanningWorkstation, setIsScanningWorkstation] = React.useState(false);
  const [scannedWorkstationId, setScannedWorkstationId] = React.useState<string | null>(null);
  const [workstationScanMatch, setWorkstationScanMatch] = React.useState<boolean | null>(null);
  const [isWorkstationAlertOpen, setIsWorkstationAlertOpen] = React.useState(false);
  const [workstationAlertInfo, setWorkstationAlertInfo] = React.useState({ title: "", description: "" });


  const handleSimulateJobScan = () => {
    setIsScanningJob(true);
    setJobScanSuccess(false);
    setScannedJobOrder(null);
    setIsJobAlertOpen(false);
    
    setIsWorkstationScanRequired(false);
    setScannedWorkstationId(null);
    setIsScanningWorkstation(false);
    setWorkstationScanMatch(null);
    setIsWorkstationAlertOpen(false);

    const currentJobOrder = mockJobOrders[Math.floor(Math.random() * mockJobOrders.length)];

    setTimeout(() => {
      setIsScanningJob(false);
      const operatorName = getOperatorName();
      let operatorDepartment = "N/A"; 

      if (operatorName === "Daniel") {
        operatorDepartment = "Assemblaggio Componenti Elettronici";
      } else {
        operatorDepartment = "Reparto Generico"; 
      }

      if (currentJobOrder.department !== operatorDepartment) {
        setJobAlertInfo({ 
          title: "Errore Reparto", 
          description: `Commessa ${currentJobOrder.id} (${currentJobOrder.department}) non appartenente al tuo reparto (${operatorDepartment}). Recarsi presso Ufficio Produzione.` 
        });
        setIsJobAlertOpen(true);
        setJobScanSuccess(false); 
        setScannedJobOrder(null);
      } else {
        setJobScanSuccess(true);
        setScannedJobOrder(currentJobOrder);
        setIsWorkstationScanRequired(true); // Proceed to workstation scan
        toast({
          title: "Scansione Commessa Riuscita!",
          description: `Commessa ${currentJobOrder.id} (${currentJobOrder.department}) scansionata. Procedere con scansione postazione.`,
          action: <CheckCircle className="text-green-500" />,
        });
        setTimeout(() => setJobScanSuccess(false), 3000); 
      }
    }, 1500);
  };

  const handleSimulateWorkstationScan = () => {
    if (!scannedJobOrder) return;

    setIsScanningWorkstation(true);
    setWorkstationScanMatch(null); // Reset match status on new scan
    setScannedWorkstationId(null);
    setIsWorkstationAlertOpen(false);

    // Simulate scanning the workstation barcode. For now, we'll assume it scans the correct one.
    // To test mismatch: const simulatedScannedId = scannedJobOrder.postazioneLavoro + "-WRONG";
    const simulatedScannedId = scannedJobOrder.postazioneLavoro; 

    setTimeout(() => {
      setIsScanningWorkstation(false);
      setScannedWorkstationId(simulatedScannedId);

      if (simulatedScannedId === scannedJobOrder.postazioneLavoro) {
        setWorkstationScanMatch(true);
        toast({
          title: "Scansione Postazione Riuscita!",
          description: `Postazione ${simulatedScannedId} verificata correttamente.`,
          action: <CheckCircle className="text-green-500" />,
        });
      } else {
        setWorkstationScanMatch(false);
        setWorkstationAlertInfo({
          title: "Errore Postazione",
          description: `Postazione ${simulatedScannedId} non corretta per commessa ${scannedJobOrder.id} (Attesa: ${scannedJobOrder.postazioneLavoro}). Verificare o recarsi presso Ufficio Produzione.`,
        });
        setIsWorkstationAlertOpen(true);
      }
    }, 1000);
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
                  <CardDescription>Scan the barcode on the job order.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center space-y-6">
              <div 
                className={`w-full max-w-xs h-48 border-2 rounded-lg flex items-center justify-center transition-all duration-300
                ${isScanningJob ? 'border-primary animate-pulse' : 'border-border'}
                ${jobScanSuccess && !isJobAlertOpen ? 'border-green-500 bg-green-500/10' : ''}
                ${isJobAlertOpen ? 'border-destructive bg-destructive/10' : ''} 
                `}
              >
                {isScanningJob && <p className="text-primary font-semibold">Scanning Job Order...</p>}
                {!isScanningJob && !scannedJobOrder && !isJobAlertOpen && <p className="text-muted-foreground">Align job barcode</p>}
                {jobScanSuccess && !isScanningJob && !isJobAlertOpen && <CheckCircle className="h-16 w-16 text-green-500" />}
                {isJobAlertOpen && !isScanningJob && <AlertTriangle className="h-16 w-16 text-destructive" />}
                {!isScanningJob && scannedJobOrder && !isJobAlertOpen && !isWorkstationScanRequired && <CheckCircle className="h-16 w-16 text-green-500" />}
                {!isScanningJob && scannedJobOrder && isWorkstationScanRequired && <CheckCircle className="h-16 w-16 text-green-500" />}
              </div>
              
              <Button 
                onClick={handleSimulateJobScan} 
                disabled={isScanningJob}
                className="w-full max-w-xs bg-accent text-accent-foreground hover:bg-accent/90"
              >
                <ScanLine className="mr-2 h-5 w-5" />
                {isScanningJob ? "Scanning..." : "Simulate Job Barcode Scan"}
              </Button>
              <p className="text-sm text-muted-foreground">
                This simulates barcode scanning for the job order.
              </p>
            </CardContent>
          </Card>

          {scannedJobOrder && !isJobAlertOpen && (
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
                    <Label htmlFor="postazioneLavoroJob" className="flex items-center text-sm text-muted-foreground">
                      <Computer className="mr-2 h-4 w-4 text-primary" />
                      Postazione di Lavoro Prevista
                    </Label>
                    <Input id="postazioneLavoroJob" value={scannedJobOrder.postazioneLavoro} readOnly className="bg-input text-foreground mt-1" />
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
                
                {isWorkstationScanRequired && workstationScanMatch !== true && !isWorkstationAlertOpen && (
                  <Card className="mt-6 border-primary border-dashed">
                    <CardHeader>
                      <CardTitle className="font-headline flex items-center text-lg">
                        <Computer className="mr-3 h-6 w-6 text-primary" />
                        Scan Workstation Barcode
                      </CardTitle>
                      <CardDescription>
                        Scan the barcode on the assigned workstation: <strong>{scannedJobOrder.postazioneLavoro}</strong>
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center space-y-4">
                      <div 
                        className={`w-full max-w-xs h-32 border-2 rounded-lg flex items-center justify-center transition-all duration-300
                        ${isScanningWorkstation ? 'border-primary animate-pulse' : 'border-border'}
                        ${workstationScanMatch === false ? 'border-destructive bg-destructive/10' : ''}
                        `}
                      >
                        {isScanningWorkstation && <p className="text-primary font-semibold">Scanning Workstation...</p>}
                        {!isScanningWorkstation && workstationScanMatch === null && <p className="text-muted-foreground">Align workstation barcode</p>}
                        {!isScanningWorkstation && workstationScanMatch === false && <AlertTriangle className="h-12 w-12 text-destructive" />}
                         {/* Brief success for workstation, though usually proceeds quickly */}
                        {!isScanningWorkstation && workstationScanMatch === true && <CheckCircle className="h-12 w-12 text-green-500" />}
                      </div>
                      <Button 
                        onClick={handleSimulateWorkstationScan} 
                        disabled={isScanningWorkstation}
                        className="w-full max-w-xs"
                        variant="outline"
                      >
                        <ScanLine className="mr-2 h-5 w-5" />
                        {isScanningWorkstation ? "Scanning..." : "Simulate Workstation Scan"}
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {workstationScanMatch === true && (
                  <Button 
                    className="mt-6 w-full bg-primary hover:bg-primary/90 text-primary-foreground" 
                    onClick={() => toast({
                        title: "Lavorazione Avviata",
                        description: `Lavoro iniziato per commessa ${scannedJobOrder.id} su postazione ${scannedJobOrder.postazioneLavoro}.`,
                        action: <CheckCircle className="text-green-500" />
                    })}
                  >
                    Inizia Lavorazione
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          <AlertDialog open={isJobAlertOpen} onOpenChange={setIsJobAlertOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center">
                  <AlertTriangle className="mr-2 h-6 w-6 text-destructive" />
                  {jobAlertInfo.title}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {jobAlertInfo.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => { setIsJobAlertOpen(false); setScannedJobOrder(null); } }>OK</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={isWorkstationAlertOpen} onOpenChange={setIsWorkstationAlertOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center">
                  <AlertTriangle className="mr-2 h-6 w-6 text-destructive" />
                  {workstationAlertInfo.title}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {workstationAlertInfo.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => { 
                  setIsWorkstationAlertOpen(false); 
                  setScannedWorkstationId(null); 
                  setWorkstationScanMatch(null); // Allow re-scan
                }}>OK</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

        </div>
      </AppShell>
    </AuthGuard>
  );
}
    
