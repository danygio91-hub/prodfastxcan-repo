"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useRouter } from 'next/navigation';

import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { getRawMaterialByCode } from '@/app/scan-job/actions';
import {
  getActiveInventoryCountingSession,
  getPackagingItems,
  registerInventoryBatch,
  searchInventoryMaterials,
} from './actions';
import type { RawMaterial, Packaging, UnitOfMeasure, InventoryCountingSession } from '@/types';
import {
  Warehouse,
  QrCode,
  Loader2,
  Camera,
  AlertTriangle,
  ArrowLeft,
  Weight,
  Archive,
  Send,
  Check,
  Search,
  Package,
  Info,
  XCircle,
} from 'lucide-react';
import { cn, formatDisplayStock } from '@/lib/utils';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useCameraStream } from '@/hooks/use-camera-stream';
import {
  computeInventoryMetrics,
  getAggregatedLotsForMaterial,
  normInventoryLot,
  type AggregatedMaterialLot,
} from '@/lib/inventory-ledger-logic';

const inventoryFormSchema = z.object({
  materialId: z.string().min(1),
  lotto: z.string().optional(),
  inputQuantity: z.coerce
    .number({ invalid_type_error: 'Inserisci una quantità valida (anche 0).' })
    .min(0, 'La quantità non può essere negativa (0 ammesso per lotto esaurito).'),
  packagingId: z.string().optional(),
  operatorId: z.string(),
  operatorName: z.string(),
  inputUnit: z.enum(['n', 'mt', 'kg']),
});
type InventoryFormValues = z.infer<typeof inventoryFormSchema>;

type Step = 'scan_material' | 'form' | 'saving' | 'success';

export default function InventoryPage() {
  const { operator, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('scan_material');
  const [scannedMaterial, setScannedMaterial] = useState<RawMaterial | null>(null);
  const [packagingItems, setPackagingItems] = useState<Packaging[]>([]);
  const [activeSession, setActiveSession] = useState<InventoryCountingSession | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isLottoScanOpen, setIsLottoScanOpen] = useState(false);

  // Manual search / autocomplete state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RawMaterial[]>([]);
  const [isSearchingMaterials, setIsSearchingMaterials] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const { hasPermission: hasCameraPermission } = useCameraStream(
    step === 'scan_material' || isLottoScanOpen,
    videoRef
  );

  const form = useForm<InventoryFormValues>({
    resolver: zodResolver(inventoryFormSchema),
    defaultValues: {
      materialId: '',
      lotto: '',
      packagingId: 'none',
      operatorId: '',
      operatorName: '',
      inputUnit: 'kg',
      inputQuantity: undefined,
    },
  });

  const selectedPackagingId = form.watch('packagingId');
  const rawEnteredQuantity = form.watch('inputQuantity');
  const watchedLotto = form.watch('lotto');
  const inputUnit = form.watch('inputUnit');

  // Aggregated lots calculated via SSoT (hydrateMaterialWithWithdrawals already applied by server action)
  const aggregatedLots = useMemo<AggregatedMaterialLot[]>(() => {
    if (!scannedMaterial) return [];
    return getAggregatedLotsForMaterial(scannedMaterial);
  }, [scannedMaterial]);

  // Currently selected/matched lot live identikit
  const activeLotIdentikit = useMemo<AggregatedMaterialLot | null>(() => {
    if (!scannedMaterial) return null;
    const targetNorm = normInventoryLot(watchedLotto);
    return aggregatedLots.find((l) => l.normLotto === targetNorm) || null;
  }, [scannedMaterial, aggregatedLots, watchedLotto]);

  // Live SSoT calculation of countedUnits, netWeight, and deltaUnits
  const liveMetrics = useMemo(() => {
    if (!scannedMaterial) return null;
    if (
      rawEnteredQuantity === undefined ||
      rawEnteredQuantity === null ||
      String(rawEnteredQuantity).trim() === '' ||
      Number.isNaN(Number(rawEnteredQuantity))
    ) {
      return null;
    }

    const numericQty = Number(rawEnteredQuantity);
    const selectedTara =
      packagingItems.find((p) => p.id === selectedPackagingId)?.weightKg || 0;
    const theoreticalUnitsAtScan = activeLotIdentikit
      ? activeLotIdentikit.theoreticalUnits
      : 0;

    try {
      return computeInventoryMetrics({
        material: scannedMaterial,
        inputQuantity: numericQty,
        inputUnit: inputUnit || scannedMaterial.unitOfMeasure,
        tareWeight: selectedTara,
        theoreticalUnitsAtScan,
      });
    } catch {
      return null;
    }
  }, [
    scannedMaterial,
    rawEnteredQuantity,
    inputUnit,
    packagingItems,
    selectedPackagingId,
    activeLotIdentikit,
  ]);

  useEffect(() => {
    if (
      !authLoading &&
      operator &&
      !operator.canAccessInventory &&
      operator.role !== 'admin' &&
      operator.role !== 'supervisor'
    ) {
      toast({
        variant: 'destructive',
        title: 'Accesso Negato',
        description: 'Non hai i permessi per accedere alla pagina Inventario.',
      });
      router.replace('/dashboard');
    }
  }, [operator, authLoading, router, toast]);

  useEffect(() => {
    getPackagingItems().then(setPackagingItems);
    getActiveInventoryCountingSession().then(setActiveSession);
  }, []);

  // Debounced manual search for materials & lots
  useEffect(() => {
    if (step !== 'scan_material') return;
    const timer = setTimeout(async () => {
      setIsSearchingMaterials(true);
      try {
        const res = await searchInventoryMaterials(searchQuery);
        setSearchResults(res);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearchingMaterials(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, step]);

  const selectMaterialAndLot = useCallback(
    (material: RawMaterial, preselectedLotto?: string) => {
      setScannedMaterial(material);
      const lots = getAggregatedLotsForMaterial(material);
      const activeLots = lots.filter((l) => !l.isExhausted);

      let chosenLotto = (preselectedLotto || '').trim();
      if (!chosenLotto && activeLots.length === 1) {
        chosenLotto = activeLots[0].lotto;
      }

      const matchedLot = chosenLotto
        ? lots.find((l) => l.normLotto === normInventoryLot(chosenLotto))
        : null;

      if (operator) {
        form.reset({
          materialId: material.id,
          lotto: chosenLotto,
          packagingId: matchedLot?.packagingId || 'none',
          operatorId: operator.id,
          operatorName: operator.nome,
          inputUnit: material.unitOfMeasure,
          inputQuantity: undefined,
        });
      }
      setStep('form');
    },
    [form, operator]
  );

  const handleMaterialScanned = useCallback(
    async (code: string) => {
      setIsLottoScanOpen(false);
      const result = await getRawMaterialByCode(code.trim());
      if ('error' in result) {
        toast({
          variant: 'destructive',
          title: result.title || 'Errore',
          description: result.error,
        });
        setStep('scan_material');
      } else {
        selectMaterialAndLot(result);
      }
    },
    [toast, selectMaterialAndLot]
  );

  const handleSelectLotChip = useCallback(
    (lot: AggregatedMaterialLot) => {
      form.setValue('lotto', lot.lotto, { shouldValidate: true });
      if (lot.packagingId) {
        form.setValue('packagingId', lot.packagingId, { shouldValidate: true });
      }
    },
    [form]
  );

  const handleLottoScanned = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      form.setValue('lotto', trimmed, { shouldValidate: true });
      const matched = aggregatedLots.find(
        (l) => l.normLotto === normInventoryLot(trimmed)
      );
      if (matched?.packagingId) {
        form.setValue('packagingId', matched.packagingId, { shouldValidate: true });
      }
      setIsLottoScanOpen(false);
      toast({
        title: 'Lotto Scansionato',
        description: `Lotto "${trimmed}" selezionato.`,
      });
    },
    [form, toast, aggregatedLots]
  );

  const triggerScan = async (onScan: (code: string) => void) => {
    if (
      !videoRef.current ||
      videoRef.current.paused ||
      videoRef.current.readyState < 2
    ) {
      toast({ variant: 'destructive', title: 'Fotocamera non pronta.' });
      return;
    }
    if (!('BarcodeDetector' in window)) {
      toast({
        variant: 'destructive',
        title: 'Funzionalità non supportata.',
        description: 'Usa la ricerca manuale qui sotto per selezionare materiale e lotto.',
      });
      return;
    }

    setIsCapturing(true);
    try {
      const barcodeDetector = new (window as any).BarcodeDetector({
        formats: ['qr_code', 'code_128', 'ean_13', 'code_39'],
      });
      const barcodes = await barcodeDetector.detect(videoRef.current);
      if (barcodes.length > 0) {
        onScan(barcodes[0].rawValue);
      } else {
        toast({ variant: 'destructive', title: 'Nessun codice trovato.' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Errore durante la scansione.' });
    } finally {
      setIsCapturing(false);
    }
  };

  const onSubmit = async (values: InventoryFormValues) => {
    if (!operator || !scannedMaterial) {
      toast({
        variant: 'destructive',
        title: 'Errore',
        description: 'Dati operatore o materiale mancanti.',
      });
      return;
    }

    if (liveMetrics?.hasNegativeNetWarning) {
      toast({
        variant: 'destructive',
        title: 'Peso Netto Negativo',
        description:
          'Il peso lordo inserito è inferiore alla tara selezionata. Correggi il peso o imposta 0 se il lotto è esaurito.',
      });
      return;
    }

    setStep('saving');
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    });

    const result = await registerInventoryBatch(formData);

    toast({
      title: result.success ? 'Inventario Registrato' : 'Operazione Fallita',
      description: result.message,
      variant: result.success ? 'default' : 'destructive',
    });

    if (result.success) {
      setStep('success');
    } else {
      setStep('form');
    }
  };

  const resetFlow = () => {
    setScannedMaterial(null);
    form.reset();
    setStep('scan_material');
  };

  // Available units for universal input selector
  const availableInputUnits = useMemo<UnitOfMeasure[]>(() => {
    if (!scannedMaterial) return ['kg', 'mt', 'n'];
    const base = scannedMaterial.unitOfMeasure;
    const list: UnitOfMeasure[] = [base];
    if (!list.includes('kg')) list.push('kg');
    if (!list.includes('mt')) list.push('mt');
    if (!list.includes('n')) list.push('n');
    return list;
  }, [scannedMaterial]);

  if (authLoading || !operator) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6 max-w-3xl mx-auto">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <Warehouse className="h-8 w-8 text-primary" />
                Registrazione Inventario (SSoT)
              </h1>
              {activeSession ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 text-xs font-semibold">
                  Campagna Attiva: {activeSession.name} ({activeSession.year})
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs px-3 py-1">
                  Modalità: Rilevazione Libera
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              Scansiona il QR/Barcode oppure cerca manualmente il materiale e il lotto per registrare la giacenza fisica rilevata.
            </p>
          </header>

          {step === 'scan_material' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Colonna 1: Scanner QR/Barcode */}
              <Card className="flex flex-col justify-between">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Camera className="h-5 w-5 text-primary" />
                    1A. Scansione Fotocamera
                  </CardTitle>
                  <CardDescription>
                    Inquadra il codice a barre o QR code della materia prima.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative grid place-items-center aspect-video bg-black rounded-lg overflow-hidden">
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      autoPlay
                      muted
                      playsInline
                    />
                    {hasCameraPermission === false && (
                      <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-4">
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>Fotocamera Non Disponibile</AlertTitle>
                          <AlertDescription>
                            Usa la ricerca manuale a fianco per selezionare Materiale e Lotto.
                          </AlertDescription>
                        </Alert>
                      </div>
                    )}
                    {hasCameraPermission && (
                      <div className="absolute inset-0 grid place-items-center pointer-events-none">
                        <div className="w-5/6 h-2/5 relative">
                          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                          <div className="absolute w-full top-1/2 -translate-y-1/2 h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    onClick={() => triggerScan(handleMaterialScanned)}
                    disabled={isCapturing || !hasCameraPermission}
                    className="w-full h-12"
                  >
                    {isCapturing ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Camera className="h-5 w-5" />
                    )}
                    <span className="ml-2">
                      {isCapturing ? 'Scansionando...' : 'Scansiona Materiale'}
                    </span>
                  </Button>
                </CardFooter>
              </Card>

              {/* Colonna 2: Fallback di Ricerca Manuale Materiale / Lotto */}
              <Card className="flex flex-col">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="h-5 w-5 text-primary" />
                    1B. Ricerca Manuale (Materiale / Lotto)
                  </CardTitle>
                  <CardDescription>
                    Codice a barre danneggiato? Cerca per codice articolo, descrizione o numero di lotto.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Cerca codice MP, descrizione o lotto..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  <div className="max-h-[320px] overflow-y-auto space-y-2 pr-1">
                    {isSearchingMaterials ? (
                      <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>Ricerca in corso...</span>
                      </div>
                    ) : searchResults.length === 0 ? (
                      <div className="text-center py-8 text-sm text-muted-foreground">
                        Nessun materiale trovato.
                      </div>
                    ) : (
                      searchResults.map((mat) => {
                        const lots = getAggregatedLotsForMaterial(mat);
                        const activeLots = lots.filter((l) => !l.isExhausted);
                        return (
                          <div
                            key={mat.id}
                            className="p-3 rounded-lg border bg-card hover:border-primary/60 transition-colors space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-bold text-sm flex items-center gap-2">
                                  <span>{mat.code}</span>
                                  <Badge variant="outline" className="text-[10px] uppercase">
                                    {mat.unitOfMeasure}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground line-clamp-1">
                                  {mat.description}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => selectMaterialAndLot(mat)}
                              >
                                Seleziona
                              </Button>
                            </div>

                            {activeLots.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/50">
                                {activeLots.map((l) => (
                                  <button
                                    key={l.normLotto}
                                    type="button"
                                    onClick={() => selectMaterialAndLot(mat, l.lotto)}
                                    className="text-[11px] px-2 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary font-medium transition-colors flex items-center gap-1"
                                  >
                                    <Package className="h-3 w-3" />
                                    <span>Lotto {l.lotto}:</span>
                                    <span className="font-bold">
                                      {formatDisplayStock(l.theoreticalUnits, mat.unitOfMeasure)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {step === 'form' && scannedMaterial && (
            <Card>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)}>
                  <CardHeader className="border-b bg-muted/20">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-xl">
                          <span>2. Rilevazione Lotto —</span>
                          <span className="text-primary font-mono">{scannedMaterial.code}</span>
                          <Badge className="uppercase">{scannedMaterial.unitOfMeasure}</Badge>
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {scannedMaterial.description} — Giacenza Totale Materiale (SSoT):{' '}
                          <span className="font-semibold text-foreground">
                            {formatDisplayStock(
                              scannedMaterial.currentStockUnits,
                              scannedMaterial.unitOfMeasure
                            )}
                          </span>
                        </CardDescription>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={resetFlow}>
                        <ArrowLeft className="mr-1.5 h-4 w-4" />
                        Cambia Materiale
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-6 pt-6">
                    {/* Selezione rapida lotti esistenti o scansione/inserimento lotto */}
                    <div className="space-y-3">
                      <FormField
                        control={form.control}
                        name="lotto"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-semibold">
                              Numero Lotto (Scansiona, Seleziona dai Lotti Attivi o Digita)
                            </FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input
                                  placeholder="Es. L2026-01 (lascia vuoto per SENZA_LOTTO)"
                                  {...field}
                                />
                              </FormControl>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => setIsLottoScanOpen(true)}
                                title="Scansiona QR/Barcode Lotto"
                              >
                                <QrCode className="h-5 w-5" />
                              </Button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {aggregatedLots.length > 0 && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">
                            Lotti registrati a sistema per {scannedMaterial.code} (clicca per selezionare):
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            {aggregatedLots.map((lot) => {
                              const isSelected =
                                normInventoryLot(watchedLotto) === lot.normLotto;
                              return (
                                <button
                                  key={lot.normLotto}
                                  type="button"
                                  onClick={() => handleSelectLotChip(lot)}
                                  className={cn(
                                    'px-3 py-1.5 rounded-md border text-xs font-medium transition-all flex items-center gap-2',
                                    isSelected
                                      ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                                      : lot.isExhausted
                                        ? 'border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/50'
                                        : 'border-border bg-muted/40 hover:bg-muted text-foreground'
                                  )}
                                >
                                  <Package className="h-3.5 w-3.5" />
                                  <span className="font-bold">{lot.lotto}</span>
                                  <span className="opacity-85">
                                    ({formatDisplayStock(lot.theoreticalUnits, lot.uom)})
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* SCHEDA IDENTIKIT LOTTO LIVE (SSoT) */}
                    <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-4 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 text-sm font-bold text-primary">
                          <Info className="h-4 w-4" />
                          <span>
                            SCHEDA IDENTIKIT LOTTO LIVE (SSoT):{' '}
                            <span className="font-mono underline">
                              {(watchedLotto || '').trim() || 'SENZA_LOTTO'}
                            </span>
                          </span>
                        </div>
                        {activeLotIdentikit ? (
                          <Badge
                            variant={activeLotIdentikit.isExhausted ? 'secondary' : 'default'}
                          >
                            {activeLotIdentikit.isExhausted
                              ? 'Lotto Esaurito a Sistema'
                              : 'Lotto Attivo a Sistema'}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500 text-amber-600">
                            Nuovo Lotto / Non Presente a Sistema
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="p-3 rounded-lg bg-background border">
                          <span className="text-xs text-muted-foreground block">
                            Giacenza Teorica Attuale ({scannedMaterial.unitOfMeasure.toUpperCase()})
                          </span>
                          <span className="text-lg font-bold text-foreground">
                            {formatDisplayStock(
                              activeLotIdentikit ? activeLotIdentikit.theoreticalUnits : 0,
                              scannedMaterial.unitOfMeasure
                            )}
                          </span>
                        </div>

                        <div className="p-3 rounded-lg bg-background border">
                          <span className="text-xs text-muted-foreground block">
                            Tara Imballo Prevista
                          </span>
                          <span className="text-lg font-bold text-foreground">
                            {activeLotIdentikit && activeLotIdentikit.tareWeight > 0
                              ? `${activeLotIdentikit.tareWeight.toFixed(3)} kg${
                                  activeLotIdentikit.tareName
                                    ? ` (${activeLotIdentikit.tareName})`
                                    : ''
                                }`
                              : '0.000 kg (Nessuna)'}
                          </span>
                        </div>

                        <div className="p-3 rounded-lg bg-background border">
                          <span className="text-xs text-muted-foreground block">
                            Peso Netto Teorico (KG)
                          </span>
                          <span className="text-lg font-bold text-foreground">
                            {formatDisplayStock(
                              activeLotIdentikit ? activeLotIdentikit.theoreticalWeightKg : 0,
                              'kg'
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Selettore Universale Unità di Misura (UdM nativa, KG, MT, N) */}
                    <FormField
                      control={form.control}
                      name="inputUnit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold">
                            Unità di Misura della Rilevazione
                          </FormLabel>
                          <div className="grid grid-cols-3 gap-2">
                            {availableInputUnits.map((u) => {
                              const isNative = u === scannedMaterial.unitOfMeasure;
                              const isSelected = field.value === u;
                              return (
                                <Button
                                  key={u}
                                  type="button"
                                  variant={isSelected ? 'default' : 'outline'}
                                  onClick={() => field.onChange(u)}
                                  className="h-10 font-bold uppercase"
                                >
                                  {u.toUpperCase()}
                                  {isNative ? ' (UdM Base)' : ''}
                                </Button>
                              );
                            })}
                          </div>
                        </FormItem>
                      )}
                    />

                    {/* Input Quantità Rilevata (con supporto 0) e Tara */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="inputQuantity"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel className="flex items-center font-semibold">
                                <Weight className="mr-1.5 h-4 w-4" />
                                {inputUnit === 'kg'
                                  ? 'Peso Rilevato Lordo (KG)'
                                  : `Quantità Rilevata (${(inputUnit || scannedMaterial.unitOfMeasure).toUpperCase()})`}
                              </FormLabel>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() =>
                                  form.setValue('inputQuantity', 0, {
                                    shouldValidate: true,
                                    shouldDirty: true,
                                  })
                                }
                              >
                                <XCircle className="mr-1 h-3.5 w-3.5" />
                                Lotto Esaurito (0)
                              </Button>
                            </div>
                            <FormControl>
                              <Input
                                type="number"
                                step="any"
                                min="0"
                                placeholder="Es. 15.5 oppure 0 se esaurito"
                                {...field}
                                value={field.value ?? ''}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="packagingId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center font-semibold">
                              <Archive className="mr-1.5 h-4 w-4" />
                              Tara (Imballo)
                            </FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || 'none'}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Nessuna" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="none">Nessuna Tara (0.000 kg)</SelectItem>
                                {packagingItems.map((item) => (
                                  <SelectItem key={item.id} value={item.id}>
                                    {item.name} ({item.weightKg.toFixed(3)} kg)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {liveMetrics?.hasNegativeNetWarning && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Tara superiore al peso lordo</AlertTitle>
                        <AlertDescription>
                          Il peso lordo inserito è inferiore alla tara selezionata. Correggi il peso/imballo oppure premi &quot;Lotto Esaurito (0)&quot; se il lotto è terminato.
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Riepilogo Calcolo Live: CountedUnits, NetWeight, e Delta rispetto a SSoT */}
                    <div className="p-4 rounded-xl border bg-muted/40 grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Giacenza Rilevata ({scannedMaterial.unitOfMeasure.toUpperCase()})
                        </Label>
                        <p className="text-xl font-bold text-primary">
                          {liveMetrics !== null
                            ? formatDisplayStock(
                                liveMetrics.countedUnits,
                                scannedMaterial.unitOfMeasure
                              )
                            : '---'}
                        </p>
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Peso Netto Calcolato (KG)
                        </Label>
                        <p className="text-xl font-bold text-foreground">
                          {liveMetrics !== null
                            ? formatDisplayStock(liveMetrics.netWeight, 'kg')
                            : '---'}
                        </p>
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Delta SSoT Stimato ({scannedMaterial.unitOfMeasure.toUpperCase()})
                        </Label>
                        <p
                          className={cn(
                            'text-xl font-bold',
                            !liveMetrics
                              ? 'text-muted-foreground'
                              : Math.abs(liveMetrics.deltaUnits) <= 0.001
                                ? 'text-blue-600'
                                : liveMetrics.deltaUnits > 0
                                  ? 'text-emerald-600'
                                  : 'text-red-600'
                          )}
                        >
                          {liveMetrics !== null
                            ? `${liveMetrics.deltaUnits > 0 ? '+' : ''}${formatDisplayStock(
                                liveMetrics.deltaUnits,
                                scannedMaterial.unitOfMeasure
                              )}`
                            : '---'}
                        </p>
                      </div>
                    </div>
                  </CardContent>

                  <CardFooter className="justify-between border-t pt-4">
                    <Button type="button" variant="outline" onClick={resetFlow}>
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Annulla
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        liveMetrics === null ||
                        liveMetrics.hasNegativeNetWarning ||
                        form.formState.isSubmitting
                      }
                    >
                      {form.formState.isSubmitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      Salva Registrazione
                    </Button>
                  </CardFooter>
                </form>
              </Form>
            </Card>
          )}

          {step === 'saving' && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                <Loader2 className="h-16 w-16 animate-spin text-primary" />
                <p className="text-muted-foreground">Salvataggio rilevazione SSoT in corso...</p>
              </CardContent>
            </Card>
          )}

          {step === 'success' && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="bg-green-100 p-4 rounded-full">
                  <Check className="h-12 w-12 text-green-600" />
                </div>
                <CardTitle>Inventario Registrato</CardTitle>
                <CardDescription>
                  La rilevazione è stata inviata al Registro Inventario SSoT per l&apos;approvazione.
                </CardDescription>
                <Button onClick={resetFlow} className="mt-4">
                  Registra Altro Lotto
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        <Dialog open={isLottoScanOpen} onOpenChange={setIsLottoScanOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Scansiona Codice Lotto</DialogTitle>
            </DialogHeader>
            <div className="relative grid place-items-center aspect-video bg-black rounded-lg overflow-hidden my-4">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                muted
                playsInline
              />
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <div className="w-5/6 h-2/5 relative">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                  <div className="absolute w-full top-1/2 -translate-y-1/2 h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => triggerScan(handleLottoScanned)}
                disabled={isCapturing || !hasCameraPermission}
                className="w-full"
              >
                {isCapturing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="mr-2 h-4 w-4" />
                )}
                {isCapturing ? 'Scansionando...' : 'Scansiona Lotto'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppShell>
    </AuthGuard>
  );
}
