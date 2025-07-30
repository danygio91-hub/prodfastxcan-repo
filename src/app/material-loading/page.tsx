

"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { getRawMaterialByCode, addBatchToRawMaterial, reportNonConformity, getPackagingItems } from './actions';
import type { RawMaterial, Packaging } from '@/lib/mock-data';
import { QrCode, AlertTriangle, Boxes, Send, Loader2, Package, Barcode, PlayCircle, Weight, Check, X, ArrowLeft, ThumbsDown, ThumbsUp, MessageSquare, Camera, Archive } from 'lucide-react';


interface BarcodeDetectorOptions { formats?: string[]; }
interface DetectedBarcode { rawValue: string; }
declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

const batchFormSchema = z.object({
  materialId: z.string().min(1),
  lotto: z.string().min(1, "Il lotto è obbligatorio."),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Data non valida"}),
  ddt: z.string().optional(),
  netQuantity: z.coerce.number().positive("La quantità netta deve essere un numero positivo."),
  unit: z.enum(['n', 'mt', 'kg']),
  packagingId: z.string().optional(),
});
type BatchFormValues = z.infer<typeof batchFormSchema>;

const ncReportFormSchema = z.object({
    quantity: z.coerce.number().positive("La quantità è obbligatoria."),
    reason: z.string(),
    notes: z.string().optional(),
});
type NcReportFormValues = z.infer<typeof ncReportFormSchema>;


export default function MaterialLoadingPage() {
    const { operator, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [step, setStep] = useState<'scan_material' | 'scan_lotto' | 'validate' | 'enter_quantity' | 'select_tare' | 'saving' | 'success'>('scan_material');
    const [scannedMaterial, setScannedMaterial] = useState<RawMaterial | null>(null);
    const [scannedLotto, setScannedLotto] = useState<string | null>(null);
    const [packagingItems, setPackagingItems] = useState<Packaging[]>([]);
    const [isCapturing, setIsCapturing] = useState(false);
    const [showNCReport, setShowNCReport] = useState(false);
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [hasCameraPermission, setHasCameraPermission] = useState(true);
    
    useEffect(() => {
        if (!authLoading && operator) {
            const allowedAccessReparti = ['MAG', 'Collaudo'];
            const hasAccess = operator.role === 'superadvisor' || 
                              (Array.isArray(operator.reparto) 
                                ? operator.reparto.some(r => allowedAccessReparti.includes(r))
                                : allowedAccessReparti.includes(operator.reparto));
            
            if (!hasAccess) {
                toast({ variant: 'destructive', title: 'Accesso Negato', description: 'Non hai i permessi per accedere a questa pagina.' });
                router.replace('/dashboard');
            }
        }
    }, [operator, authLoading, router, toast]);

    useEffect(() => {
        if (step === 'select_tare') {
            getPackagingItems().then(setPackagingItems);
        }
    }, [step]);

    const form = useForm<BatchFormValues>({
        resolver: zodResolver(batchFormSchema),
        defaultValues: { date: format(new Date(), 'yyyy-MM-dd'), ddt: 'CARICO_RAPIDO' },
    });
    
    const ncForm = useForm<NcReportFormValues>();

    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    }, []);
    
    const handleMaterialScanned = useCallback(async (code: string) => {
        stopCamera();
        const result = await getRawMaterialByCode(code.trim());
        if ('error' in result) {
            toast({ variant: 'destructive', title: result.title || "Errore", description: result.error });
        } else {
            setScannedMaterial(result);
            form.setValue('materialId', result.id);
            // Pre-set unit based on material type
            if (result.type === 'BOB' || result.type === 'PF3V0') {
                form.setValue('unit', 'kg');
            } else if (result.type === 'GUAINA') {
                form.setValue('unit', 'mt');
            } else {
                // Default to 'n' for TUBI, user can change to kg
                form.setValue('unit', 'n');
            }
            setStep('scan_lotto');
        }
    }, [stopCamera, toast, form]);

    const handleLottoScanned = (code: string) => {
        stopCamera();
        setScannedLotto(code.trim());
        form.setValue('lotto', code.trim());
        setStep('validate');
    };

     useEffect(() => {
      const shouldRunCamera = step === 'scan_material' || step === 'scan_lotto';
      if (!shouldRunCamera) {
          stopCamera();
          return;
      }
    
      const getCameraPermission = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          setHasCameraPermission(true);
          streamRef.current = stream;

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
          }
        } catch (error) {
          console.error('Error accessing camera:', error);
          setHasCameraPermission(false);
          toast({
            variant: 'destructive',
            title: 'Errore Fotocamera',
            description: 'Accesso negato o non disponibile. Controlla i permessi del browser.',
          });
          stopCamera();
        }
      };

      getCameraPermission();
      
      return () => {
        stopCamera();
      };
    }, [step, stopCamera, toast]);


    const triggerScan = useCallback(async () => {
        if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
            toast({ variant: 'destructive', title: 'Fotocamera non pronta.' });
            return;
        }
        if (!('BarcodeDetector' in window)) {
            toast({ variant: 'destructive', title: 'Funzionalità non supportata.' });
            return;
        }

        setIsCapturing(true);
        try {
            const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
            const barcodes = await barcodeDetector.detect(videoRef.current);
            if (barcodes.length > 0) {
                if (step === 'scan_material') {
                    handleMaterialScanned(barcodes[0].rawValue);
                } else if (step === 'scan_lotto') {
                    handleLottoScanned(barcodes[0].rawValue);
                }
            } else {
                toast({ variant: 'destructive', title: 'Nessun codice trovato.' });
            }
        } catch (error) {
            toast({ variant: 'destructive', title: 'Errore durante la scansione.' });
        } finally {
            setIsCapturing(false);
        }
    }, [step, toast, handleMaterialScanned, handleLottoScanned]);

    async function onFinalSubmit(values: BatchFormValues) {
        setStep('saving');
        const formData = new FormData();
        Object.entries(values).forEach(([key, value]) => {
          if (value !== undefined) formData.append(key, String(value));
        });

        const result = await addBatchToRawMaterial(formData);
        toast({
            title: result.success ? "Carico Registrato" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });

        if (result.success) {
            setStep('success');
        } else {
            setStep('select_tare'); // Go back to allow correction
        }
    };
    
    const handleNonConformityReport = async (values: NcReportFormValues) => {
        if (!scannedMaterial || !scannedLotto || !operator) return;

        const result = await reportNonConformity({
            materialId: scannedMaterial.id,
            materialCode: scannedMaterial.code,
            lotto: scannedLotto,
            quantity: values.quantity,
            reason: values.reason,
            notes: values.notes,
            operatorId: operator.id,
            operatorName: operator.nome,
        });

        if (result.success) {
            toast({
                title: "Segnalazione Inviata",
                description: `La NC è stata registrata e il materiale è in attesa di revisione.`,
            });
            resetFlow();
        } else {
             toast({
                variant: "destructive",
                title: "Errore Segnalazione",
                description: result.message,
            });
        }
    };

    const resetFlow = () => {
        setScannedMaterial(null);
        setScannedLotto(null);
        setShowNCReport(false);
        ncForm.reset();
        form.reset({ date: format(new Date(), 'yyyy-MM-dd'), ddt: 'CARICO_RAPIDO' });
        setStep('scan_material');
    };

    if (authLoading || !operator) {
        return <AppShell><div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div></AppShell>;
    }
    
    const renderScanUI = (title: string) => (
        <div className="text-center space-y-4">
            <h3 className="text-xl font-semibold">{title}</h3>
            {scannedMaterial && <p className="text-muted-foreground">Materiale: <span className="font-bold text-primary">{scannedMaterial.code}</span></p>}
            <div className="relative grid place-items-center aspect-video bg-black rounded-lg overflow-hidden">
                <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                {!hasCameraPermission && (
                     <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-4">
                        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
                        <p className="text-destructive-foreground font-semibold">Accesso alla fotocamera negato</p>
                        <p className="text-sm text-muted-foreground mt-2">Controlla i permessi del browser per continuare.</p>
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
            <Button onClick={triggerScan} disabled={isCapturing || !hasCameraPermission} className="w-full h-12">
                {isCapturing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                <span className="ml-2">{isCapturing ? 'Scansione...' : 'Scansiona Ora'}</span>
            </Button>
        </div>
    );
    
    return (
        <AuthGuard>
            <AppShell>
                <div className="space-y-6 max-w-xl mx-auto">
                    <OperatorNavMenu />
                     <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-3"><Package className="h-7 w-7 text-primary" /> Carico Merce Rapido</CardTitle>
                            <CardDescription>Segui i passaggi per registrare un nuovo lotto di materiale in ingresso.</CardDescription>
                        </CardHeader>
                        
                        <CardContent>
                            <ol className="relative flex items-center justify-between w-full text-sm font-medium text-center text-gray-500 dark:text-gray-400">
                                {['Materiale', 'Lotto', 'Convalida', 'Q.tà Netta', 'Tara'].map((title, index) => {
                                    const stepNames = ['scan_material', 'scan_lotto', 'validate', 'enter_quantity', 'select_tare'];
                                    const stepIndex = stepNames.indexOf(step);
                                    const isCompleted = stepIndex > index || step === 'saving' || step === 'success';
                                    const isActive = stepIndex === index;

                                    return (
                                        <li key={title} className={`flex items-center ${index < 4 ? 'w-full' : ''} ${isCompleted ? 'text-primary dark:text-primary after:border-primary dark:after:border-primary' : ''} after:content-[''] after:w-full after:h-1 after:border-b after:border-gray-200 after:border-1 after:inline-block dark:after:border-gray-700`}>
                                            <span className={`flex items-center justify-center w-10 h-10 ${isActive || isCompleted ? 'bg-primary/20' : 'bg-muted'} rounded-full lg:h-12 lg:w-12 dark:bg-gray-800 shrink-0`}>
                                                {isCompleted ? <Check className="w-5 h-5 text-primary" /> : <span className={`${isActive ? 'text-primary' : 'text-muted-foreground'}`}>{index + 1}</span>}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ol>
                            
                            <div className="mt-8">
                                {step === 'scan_material' && renderScanUI('1. Scansiona il Codice Materiale')}
                                {step === 'scan_lotto' && renderScanUI('2. Scansiona il Codice del Lotto')}
                                {step === 'validate' && (
                                     <div className="text-center space-y-4">
                                        <h3 className="text-xl font-semibold">3. Convalida / Segnala</h3>
                                        <p className="text-muted-foreground">Il materiale ricevuto è conforme?</p>
                                        <div className="flex justify-center gap-4 pt-4">
                                            <Button onClick={() => setStep('enter_quantity')} className="h-24 w-32 flex-col gap-2 bg-green-600 hover:bg-green-700 text-lg">
                                                <ThumbsUp className="h-8 w-8" />
                                                OK
                                            </Button>
                                            <Button onClick={() => setShowNCReport(true)} variant="destructive" className="h-24 w-32 flex-col gap-2 text-lg">
                                                <ThumbsDown className="h-8 w-8" />
                                                NC
                                            </Button>
                                        </div>
                                        
                                        {showNCReport && (
                                            <Card className="mt-6 text-left p-4 border-destructive">
                                            <Form {...ncForm}>
                                              <form onSubmit={ncForm.handleSubmit(handleNonConformityReport)} className="space-y-4">
                                                <CardHeader className="p-2">
                                                  <CardTitle className="text-base">Segnala Non Conformità</CardTitle>
                                                  <CardDescription>Specifica il problema e la quantità.</CardDescription>
                                                </CardHeader>
                                                <CardContent className="p-2 space-y-4">
                                                  <FormField
                                                      control={ncForm.control}
                                                      name="reason"
                                                      render={({ field }) => (
                                                          <FormItem>
                                                              <FormLabel>Motivo della Non Conformità</FormLabel>
                                                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                                                  <Button type="button" variant={field.value === 'Codifica Errata' ? 'default' : 'outline'} onClick={() => field.onChange('Codifica Errata')}>Codifica Errata</Button>
                                                                  <Button type="button" variant={field.value === 'Dimensioni Errate' ? 'default' : 'outline'} onClick={() => field.onChange('Dimensioni Errate')}>Dimensioni Errate</Button>
                                                                  <Button type="button" variant={field.value === 'Altro' ? 'default' : 'outline'} onClick={() => field.onChange('Altro')}>Altro</Button>
                                                              </div>
                                                              <FormMessage />
                                                          </FormItem>
                                                      )}
                                                  />

                                                  <FormField
                                                      control={ncForm.control}
                                                      name="quantity"
                                                      render={({ field }) => (
                                                          <FormItem>
                                                              <FormLabel>Quantità NC ({scannedMaterial?.unitOfMeasure.toUpperCase()})</FormLabel>
                                                              <FormControl><Input type="number" step="any" placeholder="Es. 10.5" {...field} value={field.value ?? ''} /></FormControl>
                                                              <FormMessage />
                                                          </FormItem>
                                                      )}
                                                  />

                                                  <FormField
                                                      control={ncForm.control}
                                                      name="notes"
                                                      render={({ field }) => (
                                                          <FormItem>
                                                              <FormLabel>Note Aggiuntive (Opzionale)</FormLabel>
                                                              <FormControl><Input placeholder="Aggiungi dettagli..." {...field} /></FormControl>
                                                              <FormMessage />
                                                          </FormItem>
                                                      )}
                                                  />
                                                </CardContent>
                                                <CardFooter className="p-2">
                                                  <Button type="submit" className="w-full" variant="destructive" disabled={ncForm.formState.isSubmitting}>
                                                    {ncForm.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                                                    Invia Segnalazione
                                                  </Button>
                                                </CardFooter>
                                              </form>
                                            </Form>
                                          </Card>
                                        )}
                                    </div>
                                )}
                                {step === 'enter_quantity' && (
                                    <div>
                                        <h3 className="text-xl font-semibold text-center mb-4">4. Inserisci la Quantità Netta</h3>
                                         <Form {...form}>
                                            <form onSubmit={form.handleSubmit(() => setStep('select_tare'))} className="space-y-6 text-left">
                                                <p className="text-sm text-muted-foreground">Materiale: <span className="font-bold text-primary">{scannedMaterial?.code}</span> | Lotto: <span className="font-bold text-primary">{scannedLotto}</span></p>
                                                
                                                {(scannedMaterial?.type === 'TUBI' || scannedMaterial?.type === 'PF3V0') && (
                                                     <FormField control={form.control} name="unit" render={({ field }) => (
                                                        <FormItem className="space-y-3"><FormLabel>Carico per unità o peso?</FormLabel>
                                                        <FormControl>
                                                            <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-4">
                                                                <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="n" /></FormControl><FormLabel className="font-normal">N° Pezzi</FormLabel></FormItem>
                                                                <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="kg" /></FormControl><FormLabel className="font-normal">KG</FormLabel></FormItem>
                                                            </RadioGroup>
                                                        </FormControl><FormMessage /></FormItem>
                                                    )} />
                                                )}

                                                {scannedMaterial?.type === 'BOB' && (
                                                     <FormField control={form.control} name="unit" render={({ field }) => (<FormItem><FormControl><Input type="hidden" {...field} value="kg" /></FormControl></FormItem>)} />
                                                )}

                                                 {scannedMaterial?.type === 'GUAINA' && (
                                                     <FormField control={form.control} name="unit" render={({ field }) => (<FormItem><FormControl><Input type="hidden" {...field} value="mt" /></FormControl></FormItem>)} />
                                                )}
                                                
                                                <FormField control={form.control} name="netQuantity" render={({ field }) => ( <FormItem> <FormLabel>Quantità Netta in Entrata ({form.watch('unit').toUpperCase()})</FormLabel> <FormControl><Input type="number" step="any" placeholder="Es. 500" {...field} value={field.value ?? ''} autoFocus /></FormControl> <FormMessage /> </FormItem> )} />
                                                <Button type="submit" className="w-full">Prosegui</Button>
                                            </form>
                                        </Form>
                                    </div>
                                )}
                                {step === 'select_tare' && (
                                    <div>
                                        <h3 className="text-xl font-semibold text-center mb-4">5. Seleziona Imballo (Tara)</h3>
                                         <Form {...form}>
                                            <form onSubmit={form.handleSubmit(onFinalSubmit)} className="space-y-6 text-left">
                                                <FormField
                                                  control={form.control}
                                                  name="packagingId"
                                                  render={({ field }) => (
                                                    <FormItem>
                                                      <FormLabel>Imballo</FormLabel>
                                                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <FormControl>
                                                          <SelectTrigger>
                                                            <SelectValue placeholder="Seleziona un tipo di imballo..." />
                                                          </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="none">Nessuna Tara</SelectItem>
                                                            {packagingItems.map(item => (
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
                                                <Button type="submit" className="w-full">Registra Carico</Button>
                                            </form>
                                        </Form>
                                    </div>
                                )}
                                {step === 'saving' && (
                                    <div className="text-center py-8">
                                        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
                                        <p className="mt-4 text-muted-foreground">Registrazione in corso...</p>
                                    </div>
                                )}
                                  {step === 'success' && (
                                    <div className="text-center py-8 space-y-4">
                                        <Check className="h-16 w-16 text-green-500 bg-green-500/10 rounded-full p-2 mx-auto" />
                                        <h3 className="text-xl font-semibold">Carico Registrato con Successo!</h3>
                                        <Button onClick={resetFlow} className="w-full">Carica un Altro Materiale</Button>
                                    </div>
                                 )}
                            </div>
                        </CardContent>

                        <CardFooter className="flex-col gap-4">
                           {step !== 'success' && (
                            <div className="w-full flex justify-between items-center">
                                <Button variant="ghost" onClick={resetFlow}><ArrowLeft className="mr-2 h-4 w-4"/>Ricomincia</Button>
                            </div>
                           )}
                        </CardFooter>
                     </Card>
                </div>
            </AppShell>
        </AuthGuard>
    );
}

