
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
import { Switch } from '@/components/ui/switch';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { addBatchToRawMaterial, reportNonConformity, getPackagingItems, getOpenPurchaseOrdersForMaterial } from './actions';
import { getRawMaterialByCode } from '@/app/scan-job/actions';
import type { RawMaterial, Packaging, PurchaseOrder } from '@/lib/mock-data';
import { QrCode, AlertTriangle, Boxes, Send, Loader2, Package, Barcode, PlayCircle, Weight, Check, X, ArrowLeft, ThumbsDown, ThumbsUp, MessageSquare, Camera, Archive, TestTube, Truck, ClipboardList, Calendar } from 'lucide-react';
import { useCameraStream } from '@/hooks/use-camera-stream';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const batchFormSchema = z.object({
  materialId: z.string().min(1),
  lotto: z.string().min(1, "Il lotto è obbligatorio."),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Data non valida"}),
  ddt: z.string().optional(),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  packagingId: z.string().optional(),
  unit: z.enum(['n', 'kg', 'mt']),
  purchaseOrderId: z.string().optional(),
});
type BatchFormValues = z.infer<typeof batchFormSchema>;

const ncReportFormSchema = z.object({
    quantity: z.coerce.number().positive("La quantità è obbligatoria."),
    reason: z.string(),
    notes: z.string().optional(),
});
type NcReportFormValues = z.infer<typeof ncReportFormSchema>;

type Step = 'scan_material' | 'select_order' | 'validate' | 'scan_lotto' | 'enter_quantity' | 'saving' | 'success';

// New isolated component for scanning UI
const ScanUI = ({ title, onScan, onCancel }: { title: string, onScan: (code: string) => void, onCancel: () => void }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const { hasPermission } = useCameraStream(true, videoRef);
    const [isCapturing, setIsCapturing] = useState(false);
    const { toast } = useToast();

    const triggerScan = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
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
                onScan(barcodes[0].rawValue);
            } else {
                toast({ variant: 'destructive', title: 'Nessun codice trovato.' });
            }
        } catch (error) {
            toast({ variant: 'destructive', title: 'Errore durante la scansione.' });
        } finally {
            setIsCapturing(false);
        }
    };

    return (
        <div className="text-center space-y-4">
            <h3 className="text-xl font-semibold">{title}</h3>
            <div className="relative grid place-items-center aspect-video bg-black rounded-lg overflow-hidden">
                <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                {hasPermission === false ? (
                     <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-4">
                        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
                        <p className="text-destructive-foreground font-semibold">Accesso alla fotocamera negato</p>
                        <p className="text-sm text-muted-foreground mt-2">Controlla i permessi del browser per continuare.</p>
                    </div>
                ) : (
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
            <div className="flex flex-col gap-2">
                <Button onClick={triggerScan} disabled={isCapturing || !hasPermission} className="w-full h-12">
                    {isCapturing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                    <span className="ml-2">{isCapturing ? 'Scansionando...' : 'Scansiona Ora'}</span>
                </Button>
                <Button variant="outline" onClick={onCancel}>Annulla</Button>
            </div>
        </div>
    );
};


export default function MaterialLoadingPage() {
    const { operator, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [step, setStep] = useState<Step>('scan_material');
    const [scannedMaterial, setScannedMaterial] = useState<RawMaterial | null>(null);
    const [openOrders, setOpenOrders] = useState<PurchaseOrder[]>([]);
    const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
    const [scannedLotto, setScannedLotto] = useState<string | null>(null);
    const [packagingItems, setPackagingItems] = useState<Packaging[]>([]);
    const [showNCReport, setShowNCReport] = useState(false);
    const [inputUnit, setInputUnit] = useState<'primary' | 'kg'>('primary');
    const [isLoadingOrders, setIsLoadingOrders] = useState(false);
    
    useEffect(() => {
        if (!authLoading && operator) {
            const allowedAccessReparti = ['MAG', 'Collaudo'];
            const hasAccess = operator.role === 'supervisor' || 
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
        if (scannedMaterial) {
            setInputUnit('primary'); 
        }
    }, [scannedMaterial]);

    useEffect(() => {
        if (step === 'enter_quantity') {
            getPackagingItems().then(setPackagingItems);
        }
    }, [step]);

    const form = useForm<BatchFormValues>({
        resolver: zodResolver(batchFormSchema),
        defaultValues: { date: format(new Date(), 'yyyy-MM-dd'), ddt: 'CARICO_RAPIDO' },
    });
    
    const ncForm = useForm<NcReportFormValues>();

    const selectedPackagingId = form.watch('packagingId');
    const enteredQuantity = form.watch('quantity');
    
     const calculatedGrossWeight = React.useMemo(() => {
        if (!scannedMaterial || !enteredQuantity) return 0;
        
        const numEnteredQuantity = parseFloat(String(enteredQuantity));
        if (isNaN(numEnteredQuantity)) return 0;

        const selectedTara = packagingItems.find(p => p.id === selectedPackagingId)?.weightKg || 0;
        let netWeightKg = 0;

        if (inputUnit === 'kg') {
            netWeightKg = numEnteredQuantity;
        } else { 
            if (scannedMaterial.conversionFactor && scannedMaterial.conversionFactor > 0) {
                netWeightKg = numEnteredQuantity * scannedMaterial.conversionFactor;
            } else if (scannedMaterial.unitOfMeasure === 'kg') {
                netWeightKg = numEnteredQuantity;
            }
        }

        return netWeightKg + selectedTara;
    }, [scannedMaterial, enteredQuantity, inputUnit, packagingItems, selectedPackagingId]);

    
    const handleMaterialScanned = useCallback(async (code: string) => {
        const result = await getRawMaterialByCode(code.trim());
        if ('error' in result) {
            toast({ variant: 'destructive', title: result.title || "Errore", description: result.error });
        } else {
            setScannedMaterial(result);
            form.setValue('materialId', result.id);
            form.setValue('unit', result.unitOfMeasure);
            setInputUnit('primary');
            
            // Fetch open orders for this material
            setIsLoadingOrders(true);
            setStep('select_order');
            try {
                const orders = await getOpenPurchaseOrdersForMaterial(result.code);
                setOpenOrders(orders);
            } catch (error) {
                console.error("Search error:", error);
                toast({ variant: 'destructive', title: "Errore di Ricerca", description: "Si è verificato un problema durante la ricerca degli ordini." });
            } finally {
                setIsLoadingOrders(false);
            }
        }
    }, [toast, form]);

    const handleSelectOrder = (order: PurchaseOrder | null) => {
        setSelectedOrder(order);
        if (order) {
            form.setValue('purchaseOrderId', order.id);
            form.setValue('ddt', order.orderNumber);
            // Propose remaining quantity
            const remaining = order.quantity - (order.receivedQuantity || 0);
            form.setValue('quantity', remaining > 0 ? remaining : 0);
        } else {
            form.setValue('purchaseOrderId', undefined);
            form.setValue('quantity', 0);
        }
        setStep('validate');
    };

    const handleLottoScanned = (code: string) => {
        setScannedLotto(code.trim());
        form.setValue('lotto', code.trim());
        setStep('enter_quantity');
    };

    async function onFinalSubmit(values: BatchFormValues) {
        setStep('saving');
        const formData = new FormData();
        Object.entries(values).forEach(([key, value]) => {
          if (value !== undefined) formData.append(key, String(value));
        });

        const finalUnit = inputUnit === 'primary' ? scannedMaterial?.unitOfMeasure : 'kg';
        formData.set('unit', finalUnit || 'n');


        const result = await addBatchToRawMaterial(formData);
        toast({
            title: result.success ? "Carico Registrato" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });

        if (result.success) {
            setStep('success');
        } else {
            setStep('enter_quantity'); 
        }
    };
    
    const handleNonConformityReport = async (values: NcReportFormValues) => {
        if (!scannedMaterial || !operator) return;

        const result = await reportNonConformity({
            materialId: scannedMaterial.id,
            materialCode: scannedMaterial.code,
            lotto: scannedLotto || 'NC_DA_CONVALIDA',
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
        setSelectedOrder(null);
        setOpenOrders([]);
        setShowNCReport(false);
        ncForm.reset();
        form.reset({ date: format(new Date(), 'yyyy-MM-dd'), ddt: 'CARICO_RAPIDO' });
        setStep('scan_material');
    };

    if (authLoading || !operator) {
        return <AppShell><div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div></AppShell>;
    }
    
    const filteredPackagingItems = scannedMaterial
        ? packagingItems.filter(item => item.associatedTypes?.includes(scannedMaterial.type))
        : [];
    
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
                                {['Materiale', 'Ordine', 'Convalida', 'Lotto', 'Q.tà'].map((title, index) => {
                                    const stepNames: Step[] = ['scan_material', 'select_order', 'validate', 'scan_lotto', 'enter_quantity', 'saving', 'success'];
                                    const stepIndex = stepNames.indexOf(step);
                                    const isCompleted = stepIndex > index || step === 'saving' || step === 'success';
                                    const isActive = stepIndex === index;

                                    return (
                                        <li key={title} className={`flex items-center ${index < 4 ? 'w-full' : ''} ${isCompleted ? 'text-primary dark:text-primary after:border-primary dark:after:border-primary' : ''} after:content-[''] after:w-full after:h-1 after:border-b after:border-gray-200 after:border-1 after:inline-block dark:after:border-gray-700`}>
                                            <span className={`flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 ${isActive || isCompleted ? 'bg-primary/20' : 'bg-muted'} rounded-full shrink-0`}>
                                                {isCompleted ? <Check className="w-4 h-4 sm:w-5 sm:h-5 text-primary" /> : <span className={`${isActive ? 'text-primary' : 'text-muted-foreground'}`}>{index + 1}</span>}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ol>
                            
                            <div className="mt-8">
                                {step === 'scan_material' && (
                                    <ScanUI title="1. Scansiona il Codice Materiale" onScan={handleMaterialScanned} onCancel={resetFlow} />
                                )}

                                {step === 'select_order' && (
                                    <div className="space-y-4">
                                        <h3 className="text-xl font-semibold text-center">2. Seleziona Ordine Fornitore</h3>
                                        <p className="text-center text-sm text-muted-foreground">Materiale: <span className="font-bold">{scannedMaterial?.code}</span></p>
                                        
                                        {isLoadingOrders ? (
                                            <div className="py-10 text-center"><Loader2 className="h-10 w-10 animate-spin mx-auto text-primary"/></div>
                                        ) : (
                                            <div className="space-y-2">
                                                {openOrders.length > 0 ? (
                                                    openOrders.map(order => {
                                                        const remaining = order.quantity - (order.receivedQuantity || 0);
                                                        return (
                                                            <Button 
                                                                key={order.id} 
                                                                variant="outline" 
                                                                className="w-full h-auto p-4 flex flex-col items-start gap-1 text-left hover:border-primary"
                                                                onClick={() => handleSelectOrder(order)}
                                                            >
                                                                <div className="flex justify-between w-full font-bold">
                                                                    <span>Ordine: {order.orderNumber}</span>
                                                                    <Badge variant="secondary">{format(new Date(order.expectedDeliveryDate), 'dd/MM/yyyy')}</Badge>
                                                                </div>
                                                                <div className="text-sm text-muted-foreground flex justify-between w-full">
                                                                    <span>Fornitore: {order.supplierName || 'N/D'}</span>
                                                                    <span className="text-primary font-semibold">Residuo: {remaining} {order.unitOfMeasure.toUpperCase()}</span>
                                                                </div>
                                                            </Button>
                                                        );
                                                    })
                                                ) : (
                                                    <Alert>
                                                        <AlertTriangle className="h-4 w-4" />
                                                        <AlertTitle>Nessun Ordine Trovato</AlertTitle>
                                                        <AlertDescription>Non ci sono ordini pendenti per questo materiale. Puoi procedere con un carico libero.</AlertDescription>
                                                    </Alert>
                                                )}
                                                <Button variant="ghost" className="w-full mt-4" onClick={() => handleSelectOrder(null)}>
                                                    Procedi senza ordine (Carico Libero)
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {step === 'validate' && (
                                     <div className="text-center space-y-4">
                                        <h3 className="text-xl font-semibold">3. Convalida / Segnala Merce</h3>
                                        <p className="text-muted-foreground">Il materiale ricevuto è conforme?</p>
                                        <div className="flex justify-center gap-4 pt-4">
                                            <Button onClick={() => setStep('scan_lotto')} className="h-24 w-32 flex-col gap-2 bg-green-600 hover:bg-green-700 text-lg">
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

                                {step === 'scan_lotto' && (
                                    <ScanUI title="4. Scansiona il Codice del Lotto" onScan={handleLottoScanned} onCancel={resetFlow} />
                                )}

                                {step === 'enter_quantity' && scannedMaterial && (
                                    <div>
                                        <h3 className="text-xl font-semibold text-center mb-4">5. Inserisci Quantità Ricevuta</h3>
                                         <Form {...form}>
                                            <form onSubmit={form.handleSubmit(onFinalSubmit)} className="space-y-6 text-left">
                                                <div className="p-3 bg-muted rounded-md text-sm space-y-1">
                                                    <p>Materiale: <span className="font-bold">{scannedMaterial?.code}</span></p>
                                                    <p>Lotto: <span className="font-bold">{scannedLotto}</span></p>
                                                    {selectedOrder && (
                                                        <p className="text-primary font-semibold flex items-center gap-2"><Truck className="h-4 w-4"/> Ordine: {selectedOrder.orderNumber}</p>
                                                    )}
                                                </div>
                                                
                                                {scannedMaterial.unitOfMeasure !== 'kg' && (
                                                    <div className="flex items-center space-x-2 rounded-lg border p-3 justify-center">
                                                        <Label htmlFor="unit-switch">{scannedMaterial.unitOfMeasure.toUpperCase()}</Label>
                                                        <Switch
                                                        id="unit-switch"
                                                        checked={inputUnit === 'kg'}
                                                        onCheckedChange={(checked) => setInputUnit(checked ? 'kg' : 'primary')}
                                                        />
                                                        <Label htmlFor="unit-switch">KG</Label>
                                                    </div>
                                                )}

                                                 <FormField control={form.control} name="quantity" render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {inputUnit === 'kg' ? 'Quantità Netta (KG)' : `Quantità Netta (${scannedMaterial?.unitOfMeasure.toUpperCase()})`}
                                                        </FormLabel>
                                                        <FormControl><Input type="number" step="any" placeholder="Es. 500" {...field} value={field.value ?? ''} autoFocus /></FormControl>
                                                        <FormMessage />
                                                        {selectedOrder && inputUnit === 'primary' && (
                                                            <p className="text-xs text-muted-foreground italic">Quantità proposta basata sul residuo dell'ordine.</p>
                                                        )}
                                                    </FormItem>
                                                )} />

                                                <FormField
                                                  control={form.control}
                                                  name="packagingId"
                                                  render={({ field }) => (
                                                    <FormItem>
                                                      <FormLabel className="flex items-center"><Archive className="mr-2 h-4 w-4" />Imballo (Tara)</FormLabel>
                                                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <FormControl><SelectTrigger><SelectValue placeholder="Seleziona un imballo..." /></SelectTrigger></FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="none">Nessuna Tara (0.00 kg)</SelectItem>
                                                            {filteredPackagingItems.map(item => (
                                                                <SelectItem key={item.id} value={item.id}>
                                                                    {item.name} ({item.weightKg} kg)
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                      </Select>
                                                      <FormMessage />
                                                    </FormItem>
                                                  )}
                                                />
                                                <div className="p-4 rounded-lg border bg-muted">
                                                    <Label className="text-muted-foreground">Peso Lordo Calcolato (KG)</Label>
                                                    <p className="text-2xl font-bold text-primary">{calculatedGrossWeight > 0 ? calculatedGrossWeight.toFixed(3) : '---'}</p>
                                                </div>
                                                
                                                <Button type="submit" className="w-full h-12 text-lg">Registra Carico</Button>
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
                                        <p className="text-sm text-muted-foreground">Lo stock è stato aggiornato e l'ordine è stato processato.</p>
                                        <Button onClick={resetFlow} className="w-full h-12 text-lg">Carica un Altro Materiale</Button>
                                    </div>
                                 )}
                            </div>
                        </CardContent>

                        <CardFooter className="flex-col gap-4">
                           {step !== 'success' && step !== 'scan_material' && (
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
