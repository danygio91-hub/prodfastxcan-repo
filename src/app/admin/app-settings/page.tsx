
"use client";

import React, { useState, useRef } from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  Settings, Brush, Database, AlertTriangle, Loader2, Trash2, ShieldOff, Boxes,
  Factory, LogOut, History, Download, Upload, ShieldCheck, ShieldAlert, FileJson,
  FileArchive, CheckCircle2, ArrowRight, ArrowLeft, Users, Image as ImageIcon
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { ThemeToggler } from '@/components/ThemeToggler';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { db } from '@/lib/firebase';
import { initialOperators, initialDepartmentMap, initialWorkPhaseTemplates, initialWorkstations } from '@/lib/mock-data';
import { collection, writeBatch, getDocs, doc } from 'firebase/firestore';
import { resetAllJobOrders, resetAllRawMaterials, resetRawMaterialHistory, resetAllPrivacySignatures, resetAllWithdrawals, resetAllWorkInProgress, resetAllActiveSessions } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { cn } from '@/lib/utils';

interface BackupDownloadSummary {
  format: 'gzip' | 'json';
  fileName: string;
  sizeBytes: number;
  collections: number;
  documents: number;
  subdocuments: number;
  externalAssets: number;
  authUsers: number;
  exportedAt: string;
}

interface RestoreDryRunResponse {
  success: boolean;
  message?: string;
  fileName: string;
  fileSizeBytes: number;
  wasCompressed: boolean;
  detectedVersion: 1 | 2;
  isLegacyV1: boolean;
  exportedAt: string | null;
  exportedBy: { uid: string; email: string | null; nome: string | null } | null;
  source: { engine: string; projectId: string; includeSubcollections?: boolean } | null;
  integrity: {
    status: 'valid' | 'mismatch' | 'not_applicable';
    expectedHash: string | null;
    actualHash: string;
  };
  collections: Array<{
    name: string;
    backupCount: number;
    subdocumentsCount: number;
    currentDbCount: number;
  }>;
  dbOnlyCollections: Array<{ name: string; currentDbCount: number }>;
  totals: {
    totalCollections: number;
    totalDocuments: number;
    totalSubdocuments: number;
    authUsersCount: number;
    externalAssetsCount: number;
  };
  antiLockout: {
    operatorsIncluded: boolean;
    adminFoundInBackup: boolean;
    adminHasPrivilegedRole: boolean;
    willProtectCurrentAdmin: boolean;
    warningMessage: string | null;
  };
}

interface RestoreExecutionReport {
  success: boolean;
  message: string;
  mode: 'merge' | 'replace';
  durationMs: number;
  totalCollectionsProcessed: number;
  totalWritten: number;
  totalSubdocumentsWritten: number;
  totalDeleted: number;
  protectedAdminDocId: string | null;
  perCollection: Array<{
    name: string;
    written: number;
    subdocumentsWritten: number;
    deleted: number;
    protectedAdminPreserved: boolean;
  }>;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}


// Helper function to trigger a global logout for all clients
function triggerGlobalLogout() {
  const timestamp = Date.now().toString();
  
  // Clear all session keys from localStorage
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('prodtime_tracker_active_material_sessions_') || key.startsWith('prodtime_tracker_active_job_id_')) {
      localStorage.removeItem(key);
    }
  });
  
  // Use a BroadcastChannel to notify other tabs of the same origin
  const channel = new BroadcastChannel('auth_channel');
  channel.postMessage({ type: 'FORCE_LOGOUT', timestamp });
  channel.close();
}


export default function AdminAppSettingsPage() {
  const { user } = useAuth();
  const [isSeeding, setIsSeeding] = useState(false);
  const [isResettingJobs, setIsResettingJobs] = useState(false);
  const [isResettingMaterials, setIsResettingMaterials] = useState(false);
  const [isResettingMaterialHistory, setIsResettingMaterialHistory] = useState(false);
  const [isResettingPrivacy, setIsResettingPrivacy] = useState(false);
  const [isResettingWithdrawals, setIsResettingWithdrawals] = useState(false);
  const [isResettingWork, setIsResettingWork] = useState(false);
  const [isResettingSessions, setIsResettingSessions] = useState(false);
  const [isBackingUpFormat, setIsBackingUpFormat] = useState<'gzip' | 'json' | null>(null);
  const [includeSubcollections, setIncludeSubcollections] = useState(false);
  const [lastBackupSummary, setLastBackupSummary] = useState<BackupDownloadSummary | null>(null);

  // Stato Dialog Guidato Ripristino v2 (2 Step + Report Finale)
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [restoreStep, setRestoreStep] = useState<1 | 2 | 3>(1);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [isAnalyzingBackup, setIsAnalyzingBackup] = useState(false);
  const [restorePreview, setRestorePreview] = useState<RestoreDryRunResponse | null>(null);
  const [restorePreviewError, setRestorePreviewError] = useState<string | null>(null);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const [confirmTokenInput, setConfirmTokenInput] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreReport, setRestoreReport] = useState<RestoreExecutionReport | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();

  const handleSeedDatabase = async () => {
    setIsSeeding(true);
    const seedDatabaseClientSide = async (): Promise<{ success: boolean; message: string; }> => {
      try {
        const operatorsRef = collection(db, "operators");
        const operatorsSnap = await getDocs(operatorsRef);
        
        if (!operatorsSnap.empty) {
            return { success: false, message: 'Il database sembra essere già popolato. Nessuna operazione eseguita.' };
        }
        
        const batch = writeBatch(db);
        let totalOperations = 0;

        initialOperators.forEach(op => {
            const docRef = doc(db, "operators", op.id);
            batch.set(docRef, op);
            totalOperations++;
        });

        const departmentMapDocRef = doc(db, "configuration", "departmentMap");
        batch.set(departmentMapDocRef, initialDepartmentMap);
        totalOperations++;

        initialWorkPhaseTemplates.forEach(phase => {
            const docRef = doc(db, "workPhaseTemplates", phase.id);
            batch.set(docRef, phase);
            totalOperations++;
        });

        initialWorkstations.forEach(ws => {
            const docRef = doc(db, "workstations", ws.id);
            batch.set(docRef, ws);
            totalOperations++;
        });
        
        await batch.commit();
        return { success: true, message: `Database popolato con successo con ${totalOperations} documenti.` };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("Errore nel seeding del database:", error);
        let userFriendlyMessage = `Si è verificato un errore: ${errorMessage}`;
        if (errorMessage.toLowerCase().includes('permission-denied') || errorMessage.toLowerCase().includes('insufficient permissions')) {
          userFriendlyMessage = "Errore di permessi. Assicurati che le regole di sicurezza di Firestore permettano la scrittura. Per lo sviluppo, puoi impostarle temporaneamente su 'allow read, write: if true;' nella console di Firebase.";
        }
        return { success: false, message: userFriendlyMessage };
      }
    };
    
    const result = await seedDatabaseClientSide();
      toast({
        title: result.success ? "Operazione Completata" : "Operazione Fallita",
        description: result.message,
        variant: result.success ? "default" : "destructive",
        duration: result.success ? 5000 : 9000,
      });
    setIsSeeding(false);
  }

  const handleBackup = async (format: 'gzip' | 'json' = 'gzip') => {
    setIsBackingUpFormat(format);
    toast({
      title: 'Avvio Backup Completo v2',
      description:
        format === 'gzip'
          ? 'Scansione dinamica di tutte le collezioni Firestore e compressione .json.gz in corso...'
          : 'Scansione dinamica di tutte le collezioni Firestore (JSON in chiaro) in corso...',
    });

    try {
      const params = new URLSearchParams({
        format,
        includeSubcollections: includeSubcollections ? 'true' : 'false',
      });
      const res = await fetch(`/api/admin/backup?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });

      if (!res.ok) {
        let errMsg = `Errore HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          if (errJson?.message) errMsg = errJson.message;
        } catch {
          // ignore non-json error body
        }
        throw new Error(errMsg);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const fileNameMatch = /filename="([^"]+)"/.exec(disposition);
      const fallbackExt = format === 'gzip' ? 'json.gz' : 'json';
      const fileName =
        fileNameMatch?.[1] ||
        `prodfastxcan_backup_v2_${new Date().toISOString().split('T')[0]}.${fallbackExt}`;

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);

      const collectionsCount = Number(res.headers.get('X-Backup-Collections') || 0);
      const documentsCount = Number(res.headers.get('X-Backup-Documents') || 0);
      const subdocumentsCount = Number(res.headers.get('X-Backup-Subdocuments') || 0);
      const assetsCount = Number(res.headers.get('X-Backup-Assets') || 0);
      const authUsersCount = Number(res.headers.get('X-Backup-Auth-Users') || 0);

      setLastBackupSummary({
        format,
        fileName,
        sizeBytes: blob.size,
        collections: collectionsCount,
        documents: documentsCount,
        subdocuments: subdocumentsCount,
        externalAssets: assetsCount,
        authUsers: authUsersCount,
        exportedAt: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      });

      toast({
        title: 'Backup v2 Completato',
        description: `Esportate ${collectionsCount} collezioni, ${documentsCount.toLocaleString('it-IT')} documenti e ${assetsCount} asset esterni (${formatFileSize(blob.size)}).`,
      });
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'Backup Fallito',
        description: e instanceof Error ? e.message : 'Impossibile completare il backup.',
      });
    } finally {
      setIsBackingUpFormat(null);
    }
  };

  const resetRestoreDialog = () => {
    setRestoreStep(1);
    setRestoreFile(null);
    setRestorePreview(null);
    setRestorePreviewError(null);
    setSelectedCollections([]);
    setRestoreMode('merge');
    setConfirmTokenInput('');
    setRestoreReport(null);
    setIsAnalyzingBackup(false);
    setIsRestoring(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleOpenRestoreDialog = () => {
    resetRestoreDialog();
    setIsRestoreDialogOpen(true);
  };

  const handleAnalyzeRestoreFile = async (file: File) => {
    setRestoreFile(file);
    setRestorePreview(null);
    setRestorePreviewError(null);
    setRestoreReport(null);
    setRestoreStep(1);
    setIsAnalyzingBackup(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('dryRun', 'true');

      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.message || `Errore HTTP ${res.status} durante l'analisi del file.`);
      }

      const preview = data as RestoreDryRunResponse;
      setRestorePreview(preview);
      setSelectedCollections(preview.collections.map((c) => c.name));
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Impossibile analizzare il file di backup.';
      setRestorePreviewError(msg);
      toast({
        variant: 'destructive',
        title: 'File Backup Non Valido',
        description: msg,
      });
    } finally {
      setIsAnalyzingBackup(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void handleAnalyzeRestoreFile(file);
    event.target.value = '';
  };

  const handleToggleCollectionSelection = (colName: string, checked: boolean) => {
    setSelectedCollections((prev) =>
      checked ? Array.from(new Set([...prev, colName])) : prev.filter((c) => c !== colName)
    );
  };

  const handleToggleAllCollections = (checked: boolean) => {
    if (!restorePreview) return;
    setSelectedCollections(checked ? restorePreview.collections.map((c) => c.name) : []);
  };

  const handleExecuteRestore = async () => {
    if (!restoreFile || !restorePreview || selectedCollections.length === 0) return;
    if (restorePreview.integrity.status === 'mismatch') return;
    if (restoreMode === 'replace' && confirmTokenInput.trim() !== 'SOSTITUISCI') return;

    setIsRestoring(true);
    try {
      const formData = new FormData();
      formData.append('file', restoreFile);
      formData.append('dryRun', 'false');
      formData.append('mode', restoreMode);
      formData.append('selectedCollections', JSON.stringify(selectedCollections));
      if (restoreMode === 'replace') {
        formData.append('confirmToken', confirmTokenInput.trim());
      }

      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.message || `Errore HTTP ${res.status} durante il ripristino.`);
      }

      const report = data as RestoreExecutionReport;
      setRestoreReport(report);
      setRestoreStep(3);
      toast({
        title: 'Ripristino Completato',
        description: report.message,
      });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Ripristino Fallito',
        description: err instanceof Error ? err.message : 'Errore imprevisto durante il ripristino.',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleResetJobOrders = async () => {
    if (!user) return;
    setIsResettingJobs(true);
    const result = await resetAllJobOrders(user.uid);
    toast({
        title: result.success ? "Operazione Completata" : "Operazione Fallita",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      triggerGlobalLogout();
      toast({ title: 'Logout Forzato', description: 'Tutti gli utenti verranno disconnessi per applicare le modifiche.', variant: 'default' });
    }
    setIsResettingJobs(false);
  };

  const handleResetRawMaterials = async () => {
    if (!user) return;
    setIsResettingMaterials(true);
    const result = await resetAllRawMaterials(user.uid);
    toast({
        title: result.success ? "Operazione Completata" : "Operazione Fallita",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
      if (result.success) {
      triggerGlobalLogout();
      toast({ title: 'Logout Forzato', description: 'Tutti gli utenti verranno disconnessi per applicare le modifiche.', variant: 'default' });
    }
    setIsResettingMaterials(false);
  };
  
  const handleResetMaterialHistory = async () => {
    if (!user) return;
    setIsResettingMaterialHistory(true);
    const result = await resetRawMaterialHistory(user.uid);
    toast({
        title: result.success ? "Operazione Completata" : "Operazione Fallita",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    setIsResettingMaterialHistory(false);
  };

  const handleResetWithdrawals = async () => {
    if (!user) return;
    setIsResettingWithdrawals(true);
    const result = await resetAllWithdrawals(user.uid);
    toast({
        title: result.success ? "Operazione Completata" : "Operazione Fallita",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    setIsResettingWithdrawals(false);
  };

  const handleResetPrivacy = async () => {
    if (!user) return;
    setIsResettingPrivacy(true);
    const result = await resetAllPrivacySignatures(user.uid);
    toast({
        title: result.success ? "Operazione Completata" : "Operazione Fallita",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    setIsResettingPrivacy(false);
  };

  const handleResetWork = async () => {
    if (!user) return;
    setIsResettingWork(true);
    const result = await resetAllWorkInProgress(user.uid);
    toast({
        title: result.success ? "Operazione Completata" : "Operazione Fallita",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      triggerGlobalLogout();
      toast({ title: 'Logout Forzato', description: 'Tutti gli utenti verranno disconnessi per applicare le modifiche.', variant: 'default' });
    }
    setIsResettingWork(false);
  };
  
  const handleResetSessions = async () => {
    if (!user) return;
    setIsResettingSessions(true);
    const result = await resetAllActiveSessions(user.uid);
    toast({
        title: result.success ? "Operazione Completata" : "Operazione Fallita",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      triggerGlobalLogout();
      toast({ title: 'Logout Forzato', description: 'Tutti gli operatori (escluso l\'admin) verranno disconnessi per resettare le loro sessioni attive.', variant: 'default' });
    }
    setIsResettingSessions(false);
  };

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
            <header className="space-y-2">
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                    <Settings className="h-8 w-8 text-primary" />
                    Gestione App
                </h1>
                <p className="text-muted-foreground">
                    {"Personalizzazione dell'aspetto, del tema e dei dati iniziali dell'applicazione."}
                </p>
            </header>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <Card className="lg:col-span-1">
                  <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                          <Brush className="h-6 w-6 text-primary" />
                          Personalizzazione Tema
                      </CardTitle>
                      <CardDescription>
                          {"Scegli il tema dell'applicazione. Puoi cambiarlo in qualsiasi momento usando il pulsante in basso a destra."}
                      </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                      <div>
                              <Label>Tema Attuale</Label>
                              <p className="text-sm text-muted-foreground">
                              {"L'applicazione supporta un tema chiaro e uno scuro. Usa il selettore per cambiare l'aspetto."}
                              </p>
                              <div className="mt-4">
                              <ThemeToggler />
                              </div>
                      </div>
                      <Separator />
                      <div>
                          <Label>Anteprima Colori Principali</Label>
                          <div className="flex space-x-4 mt-2">
                              <div className="flex flex-col items-center">
                                  <div className="w-10 h-10 rounded-full bg-primary border-2 border-border"></div>
                                  <span className="text-xs mt-1">Primary</span>
                              </div>
                                  <div className="flex flex-col items-center">
                                  <div className="w-10 h-10 rounded-full bg-secondary border-2 border-border"></div>
                                  <span className="text-xs mt-1">Secondary</span>
                              </div>
                              <div className="flex flex-col items-center">
                                  <div className="w-10 h-10 rounded-full bg-accent border-2 border-border"></div>
                                  <span className="text-xs mt-1">Accent</span>
                              </div>
                              <div className="flex flex-col items-center">
                                  <div className="w-10 h-10 rounded-full bg-destructive border-2 border-border"></div>
                                  <span className="text-xs mt-1">Destructive</span>
                              </div>
                          </div>
                      </div>
                  </CardContent>
              </Card>

              <div className="lg:col-span-2 space-y-8">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Database className="h-6 w-6 text-primary" />
                            Gestione Dati Applicazione
                        </CardTitle>
                        <CardDescription>
                            Azioni di popolamento, backup e ripristino del database.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2 p-4 rounded-lg border">
                         <h4 className="font-semibold flex items-center gap-2"><Database className="h-5 w-5"/> Popolamento Iniziale</h4>
                         <p className="text-sm text-muted-foreground">Aggiunge dati di esempio solo se il database è vuoto.</p>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                             <Button variant="outline" className="w-full" disabled={isSeeding}>
                              {isSeeding ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                              Popola Database Iniziale
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confermi di voler procedere?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Verranno aggiunti i dati di esempio al tuo database Firestore. Questa operazione è consigliata solo al primo avvio o dopo un reset completo del database.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Annulla</AlertDialogCancel>
                              <AlertDialogAction onClick={handleSeedDatabase} disabled={isSeeding}>
                                {isSeeding ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                Sì, popola il database
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>

                      <div className="space-y-3 p-4 rounded-lg border">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-semibold flex items-center gap-2">
                              <Download className="h-5 w-5 text-primary"/>
                              Backup Completo v2
                            </h4>
                            <Badge variant="outline" className="text-[10px] font-mono">
                              100% DB · Portabile
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Esporta dinamicamente tutte le collezioni Firestore con checksum SHA-256, timestamp lossless, metadati utenti Auth e manifest disegni Storage.
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Button
                              onClick={() => void handleBackup('gzip')}
                              disabled={isBackingUpFormat !== null}
                              className="flex-1 gap-1.5"
                            >
                              {isBackingUpFormat === 'gzip' ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <FileArchive className="h-4 w-4" />
                              )}
                              <span>Scarica Backup Completo (.json.gz)</span>
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => void handleBackup('json')}
                              disabled={isBackingUpFormat !== null}
                              className="gap-1.5 shrink-0"
                              title="Esporta JSON leggibile non compresso"
                            >
                              {isBackingUpFormat === 'json' ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <FileJson className="h-4 w-4" />
                              )}
                              <span>JSON in Chiaro (.json)</span>
                            </Button>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none pt-0.5">
                            <Checkbox
                              checked={includeSubcollections}
                              onCheckedChange={(checked) => setIncludeSubcollections(Boolean(checked))}
                              disabled={isBackingUpFormat !== null}
                            />
                            <span>Includi eventuali sottocollezioni (scansione profonda più lenta)</span>
                          </label>
                          {lastBackupSummary && (
                            <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 space-y-0.5">
                              <div className="font-semibold flex items-center gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                <span>Ultimo export ({lastBackupSummary.exportedAt}): {formatFileSize(lastBackupSummary.sizeBytes)}</span>
                              </div>
                              <div className="font-mono text-[11px] opacity-90">
                                {lastBackupSummary.collections} collezioni · {lastBackupSummary.documents.toLocaleString('it-IT')} doc · {lastBackupSummary.externalAssets} asset Storage · {lastBackupSummary.authUsers} utenti Auth
                              </div>
                            </div>
                          )}
                      </div>

                      <div className="space-y-3 p-4 rounded-lg border md:col-span-2 border-amber-500/50 bg-amber-500/5">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-semibold flex items-center gap-2 text-amber-700 dark:text-amber-400">
                              <Upload className="h-5 w-5"/>
                              Ripristina / Importa Database
                            </h4>
                            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-300">
                              Anteprima + SHA-256 · v2 &amp; Legacy v1
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Carica un file <code className="font-mono text-xs">.json.gz</code> o <code className="font-mono text-xs">.json</code>: prima di scrivere qualsiasi dato verrà eseguita la validazione completa con anteprima dei conteggi e scelta tra <strong>Unisci/Aggiorna</strong> e <strong>Sostituisci Selezionate</strong>.
                          </p>
                          <Button
                            variant="outline"
                            onClick={handleOpenRestoreDialog}
                            className="w-full border-amber-500/50 hover:bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold gap-2"
                          >
                            <Upload className="h-4 w-4" />
                            <span>Apri Procedura Ripristino / Importa</span>
                          </Button>
                          <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept=".json,.gz,.json.gz,application/json,application/gzip"
                            className="hidden"
                          />
                      </div>
                    </CardContent>
                </Card>
              </div>

            </div>
            
            <div className="mt-8">
              <Card className="border-destructive">
                  <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-destructive">
                          <AlertTriangle className="h-6 w-6" />
                          Zona Pericolosa
                      </CardTitle>
                      <CardDescription>
                          Queste operazioni sono irreversibili. Procedere con la massima cautela.
                      </CardDescription>
                  </CardHeader>
                  <CardContent>
                      <Tabs defaultValue="reset-state" className="w-full">
                          <TabsList className="grid w-full grid-cols-3">
                              <TabsTrigger value="reset-state">Reset Stato</TabsTrigger>
                              <TabsTrigger value="reset-data">Reset Dati</TabsTrigger>
                              <TabsTrigger value="reset-total">Reset Totale</TabsTrigger>
                          </TabsList>
                          <TabsContent value="reset-state" className="pt-6 space-y-4">
                              {/* Reset Sessioni Attive */}
                              <div className="flex justify-between items-center p-4 border rounded-md">
                                  <div>
                                      <h4 className="font-semibold">Reset Sessioni Attive</h4>
                                      <p className="text-sm text-muted-foreground">Forza un logout per tutti gli operatori per pulire le loro sessioni locali.</p>
                                  </div>
                                  <AlertDialog>
                                      <AlertDialogTrigger asChild><Button variant="destructive" disabled={isResettingSessions}>{isResettingSessions ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <LogOut className="mr-2 h-4 w-4" />}Resetta Sessioni</Button></AlertDialogTrigger>
                                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Questa azione disconnetterà tutti gli operatori. Utile per risolvere sessioni bloccate.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleResetSessions} className="bg-destructive hover:bg-destructive/90">Sì, resetta</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                  </AlertDialog>
                              </div>
                              {/* Reset Tutte le Lavorazioni */}
                              <div className="flex justify-between items-center p-4 border rounded-md">
                                  <div>
                                      <h4 className="font-semibold">Reset Lavorazioni in Corso</h4>
                                      <p className="text-sm text-muted-foreground">{"Riporta tutte le commesse in produzione allo stato di \"pianificata\"."}</p>
                                  </div>
                                  <AlertDialog>
                                      <AlertDialogTrigger asChild><Button variant="destructive" disabled={isResettingWork}>{isResettingWork ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Factory className="mr-2 h-4 w-4" />}Resetta Lavorazioni</Button></AlertDialogTrigger>
                                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>{"L'avanzamento delle commesse in produzione verrà azzerato."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleResetWork} className="bg-destructive hover:bg-destructive/90">Sì, resetta</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                  </AlertDialog>
                              </div>
                              {/* Reset Firme Privacy */}
                              <div className="flex justify-between items-center p-4 border rounded-md">
                                  <div>
                                      <h4 className="font-semibold">Reset Firme Privacy</h4>
                                      <p className="text-sm text-muted-foreground">{"Annulla l'accettazione della privacy per tutti gli operatori."}</p>
                                  </div>
                                  <AlertDialog>
                                      <AlertDialogTrigger asChild><Button variant="destructive" disabled={isResettingPrivacy}>{isResettingPrivacy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ShieldOff className="mr-2 h-4 w-4" />}Resetta Firme</Button></AlertDialogTrigger>
                                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>{"Tutti gli operatori dovranno ri-accettare l'informativa al prossimo accesso."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleResetPrivacy} className="bg-destructive hover:bg-destructive/90">Sì, resetta</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                  </AlertDialog>
                              </div>
                          </TabsContent>
                          <TabsContent value="reset-data" className="pt-6 space-y-4">
                              {/* Reset Prelievi da Magazzino */}
                              <div className="flex justify-between items-center p-4 border rounded-md">
                                  <div>
                                      <h4 className="font-semibold">Reset Prelievi da Magazzino</h4>
                                      <p className="text-sm text-muted-foreground">Elimina tutti i report dei prelievi di materiale e ripristina lo stock.</p>
                                  </div>
                                   <AlertDialog>
                                      <AlertDialogTrigger asChild><Button variant="destructive" disabled={isResettingWithdrawals}>{isResettingWithdrawals ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Boxes className="mr-2 h-4 w-4" />}Resetta Prelievi</Button></AlertDialogTrigger>
                                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>TUTTI i report di prelievo verranno eliminati e lo stock ripristinato.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleResetWithdrawals} className="bg-destructive hover:bg-destructive/90">Sì, resetta</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                  </AlertDialog>
                              </div>
                              {/* Reset Storico Materiali */}
                              <div className="flex justify-between items-center p-4 border rounded-md">
                                  <div>
                                      <h4 className="font-semibold">Reset Storico Materiali</h4>
                                      <p className="text-sm text-muted-foreground">Elimina lotti e prelievi, azzerando lo stock ma mantenendo l'anagrafica.</p>
                                  </div>
                                  <AlertDialog>
                                      <AlertDialogTrigger asChild><Button variant="destructive" disabled={isResettingMaterialHistory}>{isResettingMaterialHistory ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <History className="mr-2 h-4 w-4" />}Resetta Storico</Button></AlertDialogTrigger>
                                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Verranno eliminati TUTTI i lotti e i prelievi. Lo stock verrà azzerato.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleResetMaterialHistory} className="bg-destructive hover:bg-destructive/90">Sì, resetta</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                  </AlertDialog>
                              </div>
                          </TabsContent>
                          <TabsContent value="reset-total" className="pt-6 space-y-4">
                              {/* Reset Tutte le Commesse */}
                              <div className="flex justify-between items-center p-4 border rounded-md">
                                  <div>
                                      <h4 className="font-semibold">Reset Tutte le Commesse</h4>
                                      <p className="text-sm text-muted-foreground">Elimina TUTTE le commesse (pianificate, produzione, sospese) e i prelievi associati.</p>
                                  </div>
                                  <AlertDialog>
                                      <AlertDialogTrigger asChild><Button variant="destructive" disabled={isResettingJobs}>{isResettingJobs ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4" />}Resetta Commesse</Button></AlertDialogTrigger>
                                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Verranno eliminate TUTTE le commesse (escluse quelle già completate) e i prelievi.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleResetJobOrders} className="bg-destructive hover:bg-destructive/90">Sì, elimina</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                  </AlertDialog>
                              </div>
                              {/* Reset Anagrafica Materie Prime */}
                              <div className="flex justify-between items-center p-4 border rounded-md">
                                  <div>
                                      <h4 className="font-semibold">Reset Anagrafica Materie Prime</h4>
                                      <p className="text-sm text-muted-foreground">{"Elimina TUTTA l'anagrafica delle materie prime, i lotti e i prelievi."}</p>
                                  </div>
                                  <AlertDialog>
                                      <AlertDialogTrigger asChild><Button variant="destructive" disabled={isResettingMaterials}>{isResettingMaterials ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4" />}Resetta Anagrafica</Button></AlertDialogTrigger>
                                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Azione irreversibile. Verranno eliminate TUTTE le materie prime.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleResetRawMaterials} className="bg-destructive hover:bg-destructive/90">Sì, elimina tutto</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                  </AlertDialog>
                              </div>
                          </TabsContent>
                      </Tabs>
                  </CardContent>
              </Card>
            </div>
            {/* FASE 103-BIS: DIALOG GUIDATO RIPRISTINO / IMPORTA DATABASE (2 STEP + REPORT FINALE) */}
            <Dialog
              open={isRestoreDialogOpen}
              onOpenChange={(open) => {
                if (!open && !isRestoring && !isAnalyzingBackup) {
                  setIsRestoreDialogOpen(false);
                }
              }}
            >
              <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-primary" />
                    <span>
                      {restoreStep === 1 && 'Ripristino Database — Step 1: Analisi & Anteprima'}
                      {restoreStep === 2 && 'Ripristino Database — Step 2: Modalità & Conferma'}
                      {restoreStep === 3 && 'Ripristino Completato — Report Operazione'}
                    </span>
                  </DialogTitle>
                  <DialogDescription>
                    {restoreStep === 1 && 'Seleziona un file .json.gz o .json per verificarne integrità SHA-256 e contenuto senza modificare il database.'}
                    {restoreStep === 2 && 'Scegli la modalità di importazione e conferma l\'operazione sulle collezioni selezionate.'}
                    {restoreStep === 3 && 'Riepilogo dettagliato delle scritture eseguite a chunk sicuri su Firestore.'}
                  </DialogDescription>
                </DialogHeader>

                {/* STEP 1: CARICAMENTO FILE + ANTEPRIMA DRY-RUN */}
                {restoreStep === 1 && (
                  <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border bg-muted/30">
                      <div className="text-xs space-y-0.5">
                        <div className="font-semibold text-foreground">
                          {restoreFile ? restoreFile.name : 'Nessun file selezionato'}
                        </div>
                        <div className="text-muted-foreground">
                          {restoreFile
                            ? `Dimensione: ${formatFileSize(restoreFile.size)}`
                            : 'Supporta Backup v2 (.json.gz / .json) e Backup Legacy v1 (.json)'}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isAnalyzingBackup}
                        onClick={() => fileInputRef.current?.click()}
                        className="gap-1.5"
                      >
                        {isAnalyzingBackup ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        <span>{restoreFile ? 'Cambia File' : 'Seleziona File Backup'}</span>
                      </Button>
                    </div>

                    {isAnalyzingBackup && (
                      <div className="flex flex-col items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-7 w-7 animate-spin text-primary" />
                        <span>Decompressione, validazione schema e verifica checksum SHA-256 in corso...</span>
                      </div>
                    )}

                    {restorePreviewError && !isAnalyzingBackup && (
                      <div className="p-3 rounded-md border border-destructive/50 bg-destructive/10 text-destructive text-xs flex items-start gap-2">
                        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold">Errore validazione file</div>
                          <div>{restorePreviewError}</div>
                        </div>
                      </div>
                    )}

                    {restorePreview && !isAnalyzingBackup && (
                      <div className="flex-1 overflow-hidden flex flex-col gap-3">
                        {/* Badge Formato + Integrità SHA-256 */}
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="font-mono text-xs">
                            {restorePreview.isLegacyV1 ? 'Formato v1 (Legacy)' : 'Formato v2 (Portabile)'}
                          </Badge>

                          {restorePreview.integrity.status === 'valid' && (
                            <Badge className="bg-emerald-600 text-white gap-1 text-xs">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              SHA-256 Verificato
                            </Badge>
                          )}
                          {restorePreview.integrity.status === 'mismatch' && (
                            <Badge variant="destructive" className="gap-1 text-xs">
                              <ShieldAlert className="h-3.5 w-3.5" />
                              SHA-256 NON VALIDO — File Manomesso/Corrotto
                            </Badge>
                          )}
                          {restorePreview.integrity.status === 'not_applicable' && (
                            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300 text-xs">
                              Checksum non presente (Legacy v1)
                            </Badge>
                          )}

                          {restorePreview.wasCompressed && (
                            <Badge variant="secondary" className="text-xs font-mono">
                              GZIP
                            </Badge>
                          )}

                          {restorePreview.exportedAt && (
                            <span className="text-xs text-muted-foreground ml-auto font-mono">
                              Export: {new Date(restorePreview.exportedAt).toLocaleString('it-IT')}
                            </span>
                          )}
                        </div>

                        {/* Riepilogo sintetico + authUsers + externalAssets */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div className="p-2 rounded border bg-muted/20">
                            <div className="text-[10px] uppercase text-muted-foreground">Collezioni</div>
                            <div className="font-mono font-bold text-sm">{restorePreview.totals.totalCollections}</div>
                          </div>
                          <div className="p-2 rounded border bg-muted/20">
                            <div className="text-[10px] uppercase text-muted-foreground">Documenti</div>
                            <div className="font-mono font-bold text-sm">
                              {restorePreview.totals.totalDocuments.toLocaleString('it-IT')}
                            </div>
                          </div>
                          <div className="p-2 rounded border bg-muted/20" title="Metadati account Firebase Auth (solo informativo, non modificati su Auth)">
                            <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                              <Users className="h-3 w-3" /> Auth Users
                            </div>
                            <div className="font-mono font-bold text-sm">{restorePreview.totals.authUsersCount}</div>
                          </div>
                          <div className="p-2 rounded border bg-muted/20" title="Disegni tecnici e allegati referenziati su Firebase Storage">
                            <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                              <ImageIcon className="h-3 w-3" /> Asset Storage
                            </div>
                            <div className="font-mono font-bold text-sm">{restorePreview.totals.externalAssetsCount}</div>
                          </div>
                        </div>

                        {/* Avviso anti-lockout admin se presente */}
                        {restorePreview.antiLockout.warningMessage && (
                          <div className="p-2.5 rounded-md border border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>{restorePreview.antiLockout.warningMessage}</span>
                          </div>
                        )}

                        {/* Tabella selettiva collezioni */}
                        <div className="border rounded-md overflow-hidden flex-1 flex flex-col">
                          <div className="px-3 py-1.5 bg-muted/40 border-b flex items-center justify-between text-xs">
                            <label className="flex items-center gap-2 font-semibold cursor-pointer">
                              <Checkbox
                                checked={
                                  restorePreview.collections.length > 0 &&
                                  selectedCollections.length === restorePreview.collections.length
                                }
                                onCheckedChange={(c) => handleToggleAllCollections(Boolean(c))}
                              />
                              <span>
                                Collezioni selezionate: {selectedCollections.length} / {restorePreview.collections.length}
                              </span>
                            </label>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              Doc selezionati:{' '}
                              {restorePreview.collections
                                .filter((c) => selectedCollections.includes(c.name))
                                .reduce((acc, c) => acc + c.backupCount, 0)
                                .toLocaleString('it-IT')}
                            </span>
                          </div>
                          <ScrollArea className="h-[230px]">
                            <Table>
                              <TableHeader className="sticky top-0 bg-muted/70">
                                <TableRow className="text-xs">
                                  <TableHead className="w-10"></TableHead>
                                  <TableHead>Collezione</TableHead>
                                  <TableHead className="text-right">Nel Backup</TableHead>
                                  <TableHead className="text-right">Attuali su DB</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {restorePreview.collections.map((col) => {
                                  const isChecked = selectedCollections.includes(col.name);
                                  return (
                                    <TableRow
                                      key={col.name}
                                      className={cn('text-xs', !isChecked && 'opacity-50')}
                                    >
                                      <TableCell className="py-1.5">
                                        <Checkbox
                                          checked={isChecked}
                                          onCheckedChange={(c) =>
                                            handleToggleCollectionSelection(col.name, Boolean(c))
                                          }
                                        />
                                      </TableCell>
                                      <TableCell className="py-1.5 font-mono font-semibold">
                                        {col.name}
                                        {col.subdocumentsCount > 0 && (
                                          <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">
                                            (+{col.subdocumentsCount} sottodoc)
                                          </span>
                                        )}
                                      </TableCell>
                                      <TableCell className="py-1.5 text-right font-mono font-bold">
                                        {col.backupCount.toLocaleString('it-IT')}
                                      </TableCell>
                                      <TableCell className="py-1.5 text-right font-mono text-muted-foreground">
                                        {col.currentDbCount.toLocaleString('it-IT')}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </ScrollArea>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 2: SCELTA MODALITÀ + CONFERMA SICURA */}
                {restoreStep === 2 && restorePreview && (
                  <div className="space-y-4 py-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setRestoreMode('merge');
                          setConfirmTokenInput('');
                        }}
                        disabled={isRestoring}
                        className={cn(
                          'text-left p-4 rounded-lg border-2 transition-all cursor-pointer space-y-1.5',
                          restoreMode === 'merge'
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-border hover:border-muted-foreground/40'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm">Unisci / Aggiorna (Merge)</span>
                          <Badge className="bg-emerald-600 text-white text-[10px]">Consigliato</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Scrive e aggiorna i documenti presenti nel backup con <code className="font-mono">merge: true</code>. <strong>Non elimina</strong> alcun documento preesistente su Firestore.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setRestoreMode('replace')}
                        disabled={isRestoring}
                        className={cn(
                          'text-left p-4 rounded-lg border-2 transition-all cursor-pointer space-y-1.5',
                          restoreMode === 'replace'
                            ? 'border-destructive bg-destructive/10'
                            : 'border-border hover:border-muted-foreground/40'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm text-destructive">Sostituisci Selezionate</span>
                          <Badge variant="destructive" className="text-[10px]">Distruttiva</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Sovrascrive tutti i documenti del backup sulle {selectedCollections.length} collezioni selezionate e, solo dopo il successo delle scritture, elimina gli ID eccedenti (proteggendo l&apos;admin corrente).
                        </p>
                      </button>
                    </div>

                    {restoreMode === 'replace' && (
                      <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="text-xs text-destructive font-semibold flex items-center gap-1.5">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            <span>Prima di sovrascrivere, ti consigliamo uno snapshot di sicurezza attuale:</span>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isBackingUpFormat !== null || isRestoring}
                            onClick={() => void handleBackup('gzip')}
                            className="gap-1.5 shrink-0"
                          >
                            {isBackingUpFormat === 'gzip' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            <span>Scarica prima un backup di sicurezza</span>
                          </Button>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="restore-confirm-token" className="text-xs font-semibold">
                            Digita <code className="font-mono font-bold text-destructive">SOSTITUISCI</code> per abilitare il ripristino:
                          </Label>
                          <Input
                            id="restore-confirm-token"
                            value={confirmTokenInput}
                            onChange={(e) => setConfirmTokenInput(e.target.value)}
                            placeholder="SOSTITUISCI"
                            disabled={isRestoring}
                            className="font-mono uppercase max-w-xs"
                          />
                        </div>
                      </div>
                    )}

                    {isRestoring && (
                      <div className="p-4 rounded-lg border bg-muted/40 flex items-center gap-3 text-sm">
                        <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                        <div>
                          <div className="font-semibold">Ripristino in corso su Firestore...</div>
                          <div className="text-xs text-muted-foreground">
                            Scrittura a chunk sicuri (max 400 operazioni/batch) su {selectedCollections.length} collezioni. Non chiudere questa finestra.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 3: REPORT DETTAGLIATO FINALE */}
                {restoreStep === 3 && restoreReport && (
                  <div className="flex-1 overflow-hidden flex flex-col gap-3 py-2">
                    <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 text-xs flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold">{restoreReport.message}</div>
                        <div className="font-mono mt-0.5">
                          Durata: {(restoreReport.durationMs / 1000).toFixed(2)}s · Modalità: {restoreReport.mode.toUpperCase()} · Cache MRP/Programmazione invalidata
                        </div>
                      </div>
                    </div>

                    {restoreReport.protectedAdminDocId && (
                      <div className="p-2.5 rounded-md border border-blue-500/40 bg-blue-500/10 text-blue-800 dark:text-blue-300 text-xs">
                        Protezione anti-lockout attiva: il tuo profilo amministratore (<code className="font-mono">{restoreReport.protectedAdminDocId}</code>) è stato preservato.
                      </div>
                    )}

                    <div className="border rounded-md overflow-hidden flex-1">
                      <ScrollArea className="h-[250px]">
                        <Table>
                          <TableHeader className="sticky top-0 bg-muted/70">
                            <TableRow className="text-xs">
                              <TableHead>Collezione</TableHead>
                              <TableHead className="text-right">Scritti</TableHead>
                              <TableHead className="text-right">Eliminati</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {restoreReport.perCollection.map((row) => (
                              <TableRow key={row.name} className="text-xs">
                                <TableCell className="py-1.5 font-mono font-semibold">{row.name}</TableCell>
                                <TableCell className="py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                                  {row.written.toLocaleString('it-IT')}
                                </TableCell>
                                <TableCell className="py-1.5 text-right font-mono text-muted-foreground">
                                  {row.deleted > 0 ? row.deleted.toLocaleString('it-IT') : '0'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </div>
                  </div>
                )}

                <DialogFooter className="pt-2 border-t gap-2">
                  {restoreStep === 1 && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsRestoreDialogOpen(false)}
                        disabled={isAnalyzingBackup}
                      >
                        Annulla
                      </Button>
                      <Button
                        type="button"
                        onClick={() => setRestoreStep(2)}
                        disabled={
                          !restorePreview ||
                          isAnalyzingBackup ||
                          restorePreview.integrity.status === 'mismatch' ||
                          selectedCollections.length === 0
                        }
                        className="gap-1.5"
                      >
                        <span>Avanti: Modalità &amp; Conferma</span>
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </>
                  )}

                  {restoreStep === 2 && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setRestoreStep(1)}
                        disabled={isRestoring}
                        className="gap-1.5"
                      >
                        <ArrowLeft className="h-4 w-4" />
                        <span>Indietro</span>
                      </Button>
                      <Button
                        type="button"
                        variant={restoreMode === 'replace' ? 'destructive' : 'default'}
                        onClick={() => void handleExecuteRestore()}
                        disabled={
                          isRestoring ||
                          selectedCollections.length === 0 ||
                          (restoreMode === 'replace' && confirmTokenInput.trim() !== 'SOSTITUISCI')
                        }
                        className="gap-1.5"
                      >
                        {isRestoring ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        <span>
                          {restoreMode === 'replace'
                            ? `Sostituisci ${selectedCollections.length} Collezioni`
                            : `Unisci / Aggiorna ${selectedCollections.length} Collezioni`}
                        </span>
                      </Button>
                    </>
                  )}

                  {restoreStep === 3 && (
                    <Button
                      type="button"
                      onClick={() => {
                        setIsRestoreDialogOpen(false);
                        resetRestoreDialog();
                      }}
                    >
                      Chiudi
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}

  
