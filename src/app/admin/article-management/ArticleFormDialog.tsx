
"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as z from 'zod';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, Save, Loader2, Check, FileText, Upload, Image as ImageIcon, Ship, ExternalLink } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '@/lib/firebase';

import type { Article, RawMaterial, WorkCycle } from '@/types';
import { saveArticle, getWorkCycles } from './actions';
import { getRawMaterials, getMaterialsByCodes } from '../raw-material-management/actions';
import { getGlobalSettings } from '@/lib/settings-actions';
import { GlobalSettings } from '@/lib/settings-types';

const bomItemSchema = z.object({
  component: z.string().optional(),
  unit: z.enum(['n', 'mt', 'kg']),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo.").default(1),
  lunghezzaTaglioMm: z.coerce.number().optional(),
  note: z.string().optional(),
});


const articleSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(3, "Il codice articolo è obbligatorio."),
  billOfMaterials: z.array(bomItemSchema).optional().default([]),
  workCycleId: z.string().optional(),
  secondaryWorkCycleId: z.string().optional(),
  technicalNotes: z.string().optional().default(''),
  technicalDrawingUrl: z.string().optional().default(''),
  packagingType: z.string().optional(),
  packingInstructions: z.string().optional(),
  unitWeightKg: z.coerce.number().min(0).optional(),
  packagingTareWeightKg: z.coerce.number().min(0).optional(),
});

type ArticleFormValues = z.infer<typeof articleSchema>;

interface ArticleFormDialogProps {
  isOpen: boolean;
  onClose: (refresh?: boolean, updatedArticle?: Article) => void;
  article: Article | null;
  workCycles?: WorkCycle[];
  globalSettings?: GlobalSettings | null;
  preloadedMaterials?: RawMaterial[];
  embedded?: boolean;
}

export default function ArticleFormDialog({
  isOpen,
  onClose,
  article,
  workCycles: initialWorkCycles,
  globalSettings: initialGlobalSettings,
  preloadedMaterials,
  embedded = false,
}: ArticleFormDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const suggestionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bomRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [lastRowAdded, setLastRowAdded] = useState<number | null>(null);

  const [materialCache, setMaterialCache] = useState<Record<string, RawMaterial>>({});
  const [suggestions, setSuggestions] = useState<RawMaterial[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [availableWorkCycles, setAvailableWorkCycles] = useState<WorkCycle[]>(initialWorkCycles || []);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(initialGlobalSettings || null);

  // Load initial materials, work cycles and global settings
  useEffect(() => {
    if (!isOpen) return;

    if (initialWorkCycles && initialWorkCycles.length > 0) {
      setAvailableWorkCycles(initialWorkCycles);
    } else {
      getWorkCycles().then(setAvailableWorkCycles);
    }

    if (initialGlobalSettings) {
      setGlobalSettings(initialGlobalSettings);
    } else {
      getGlobalSettings().then(setGlobalSettings);
    }

    if (preloadedMaterials && preloadedMaterials.length > 0) {
      setMaterialCache((prev) => {
        const newC = { ...prev };
        preloadedMaterials.forEach((m) => {
          if (m.code) newC[m.code.toUpperCase()] = m;
        });
        return newC;
      });
    } else if (article?.billOfMaterials) {
      const codes = article.billOfMaterials.map((i) => i.component).filter(Boolean);
      if (codes.length > 0) {
        getMaterialsByCodes(codes).then((mats) => {
          setMaterialCache((prev) => {
            const newC = { ...prev };
            mats.forEach((m) => {
              if (m.code) newC[m.code.toUpperCase()] = m;
            });
            return newC;
          });
        });
      }
    }
  }, [isOpen, article, initialWorkCycles, initialGlobalSettings, preloadedMaterials]);

  const handleSearch = (term: string) => {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (term.length < 2) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const timeout = setTimeout(async () => {
      const mats = await getRawMaterials(term);
      setSuggestions(mats);
      setMaterialCache(prev => {
        const newC = { ...prev };
        mats.forEach(m => newC[m.code.toUpperCase()] = m);
        return newC;
      });
      setIsSearching(false);
    }, 300);
    setSearchTimeout(timeout);
  };

  const form = useForm<ArticleFormValues>({
    resolver: zodResolver(articleSchema),
    defaultValues: {
      code: '',
      billOfMaterials: [],
      workCycleId: '',
      secondaryWorkCycleId: '',
      technicalNotes: '',
      technicalDrawingUrl: '',
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "billOfMaterials",
  });

  const [isUploadingDrawing, setIsUploadingDrawing] = useState(false);
  const [isRemovingDrawing, setIsRemovingDrawing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const articleIdentity = article?.id || article?.code || '';

  useEffect(() => {
    setIsPending(false);
    setFocusedIndex(null);
    setSuggestions([]);
    setIsSearching(false);
    setUploadedFileName('');
  }, [articleIdentity]);

  useEffect(() => {
    if (isOpen) {
      setUploadedFileName('');
      if (article) {
        form.reset({
          id: article.id,
          code: article.code,
          billOfMaterials: article.billOfMaterials || [],
          workCycleId: article.workCycleId || '',
          secondaryWorkCycleId: article.secondaryWorkCycleId || '',
          technicalNotes: article.technicalNotes || '',
          technicalDrawingUrl: article.technicalDrawingUrl || '',
          packagingType: article.packagingType || '',
          packingInstructions: article.packingInstructions || '',
          unitWeightKg: article.unitWeightKg || 0,
          packagingTareWeightKg: article.packagingTareWeightKg || 0,
        });
      } else {
        const defaultBOM = Array(5).fill({ component: '', unit: 'n', quantity: 1, lunghezzaTaglioMm: undefined, note: '' });
        form.reset({
          id: undefined,
          code: '',
          billOfMaterials: defaultBOM,
          workCycleId: '',
          secondaryWorkCycleId: '',
          technicalNotes: '',
          technicalDrawingUrl: '',
          packagingType: '',
          packingInstructions: '',
          unitWeightKg: 0,
          packagingTareWeightKg: 0,
        });
      }
    }
  }, [article, form, isOpen]);

  const handleDrawingFileUpload = async (file: File) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        variant: 'destructive',
        title: 'Formato non supportato',
        description: 'Seleziona un file PNG, JPEG o PDF.',
      });
      return;
    }

    const rawCode = (form.getValues('code') || article?.code || article?.id || 'ART').trim().toUpperCase();
    const cleanArticleId = rawCode.replace(/[^A-Z0-9._-]/g, '_') || 'ART';
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `technical_drawings/${cleanArticleId}_${Date.now()}_${safeFileName}`;

    setIsUploadingDrawing(true);
    try {
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);

      form.setValue('technicalDrawingUrl', downloadURL, { shouldDirty: true, shouldValidate: true });
      setUploadedFileName(file.name);
      toast({
        title: 'Disegno Caricato',
        description: `Il file "${file.name}" è stato caricato con successo.`,
      });
    } catch (error: any) {
      console.error('Errore upload disegno tecnico:', error);
      toast({
        variant: 'destructive',
        title: 'Errore Upload',
        description: error?.message || 'Impossibile caricare il file su Firebase Storage.',
      });
    } finally {
      setIsUploadingDrawing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveDrawing = async () => {
    const currentUrl = form.getValues('technicalDrawingUrl');
    if (!currentUrl) return;

    setIsRemovingDrawing(true);
    try {
      try {
        const fileRef = ref(storage, currentUrl);
        await deleteObject(fileRef);
      } catch (storageErr) {
        console.warn('Avviso rimozione file da Firebase Storage (potrebbe non esistere più):', storageErr);
      }
      form.setValue('technicalDrawingUrl', '', { shouldDirty: true, shouldValidate: true });
      setUploadedFileName('');
      toast({
        title: 'Disegno Rimosso',
        description: 'Il disegno tecnico è stato rimosso.',
      });
    } finally {
      setIsRemovingDrawing(false);
    }
  };

  // UX REFINEMENT: SYNC UNIT OF MEASURE ON MATCH (FOR COPY-PASTE)
  const bomData = form.watch("billOfMaterials");
  useEffect(() => {
    bomData.forEach((item, index) => {
      if (item.component) {
        const match = materialCache[item.component.toUpperCase()];
        if (match && match.unitOfMeasure !== item.unit) {
          form.setValue(`billOfMaterials.${index}.unit`, match.unitOfMeasure as any);
        }
      }
    });
  }, [bomData, materialCache, form]);

  // UX REFINEMENT: AUTO-FOCUS NEW ROW
  useEffect(() => {
    if (lastRowAdded !== null) {
      const timer = setTimeout(() => {
        bomRefs.current[`${lastRowAdded}-component`]?.focus();
        setLastRowAdded(null);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [lastRowAdded]);

  const focusRowField = (index: number, field: string) => {
    bomRefs.current[`${index}-${field}`]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number, field: 'component' | 'quantity' | 'lunghezzaTaglioMm' | 'note') => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Evita submit form

      if (field === 'component') focusRowField(index, 'quantity');
      else if (field === 'quantity') {
        const isN = form.getValues(`billOfMaterials.${index}.unit`) === 'n';
        if (isN) focusRowField(index, 'note');
        else focusRowField(index, 'lunghezzaTaglioMm');
      }
      else if (field === 'lunghezzaTaglioMm') focusRowField(index, 'note');
      else if (field === 'note') {
        if (index < fields.length - 1) {
          focusRowField(index + 1, 'component');
        } else {
          // Se siamo all'ultima riga, aggiungine una nuova
          setLastRowAdded(fields.length);
          append({ component: '', unit: 'n', quantity: 1, lunghezzaTaglioMm: undefined, note: '' });
        }
      }
    }
  };

  const onSubmit = async (data: ArticleFormValues) => {
    if (isPending) return;
    setIsPending(true);
    try {
      // Filter out empty rows and ensure codes are uppercase before sending to server
      const filteredData = {
        ...data,
        billOfMaterials: (data.billOfMaterials || [])
          .filter(item => item.component && item.component.trim() !== '')
          .map(item => {
            const material = materialCache[item.component?.toUpperCase() || ""];
            const typeConfig = material && globalSettings
              ? globalSettings.rawMaterialTypes.find(t => t.id === material.type)
              : null;
            const requiresCut = typeConfig ? typeConfig.requiresCutLength !== false : true;

            return {
              ...item,
              component: item.component?.toUpperCase(),
              lunghezzaTaglioMm: requiresCut ? (item.lunghezzaTaglioMm ?? null) : null
            };
          })
      };
      const result = await saveArticle(filteredData);
      toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
      if (result.success) {
        const docId = (data.code || '').toUpperCase();
        const updatedArticle: Article = {
          ...(article || {} as Article),
          id: docId,
          code: docId,
          billOfMaterials: (filteredData.billOfMaterials || []) as Article['billOfMaterials'],
          workCycleId: filteredData.workCycleId,
          secondaryWorkCycleId: filteredData.secondaryWorkCycleId,
          technicalNotes: filteredData.technicalNotes || '',
          technicalDrawingUrl: filteredData.technicalDrawingUrl || '',
          packagingType: data.packagingType,
          packingInstructions: data.packingInstructions,
          unitWeightKg: data.unitWeightKg,
          packagingTareWeightKg: data.packagingTareWeightKg,
        };
        onClose(true, updatedArticle);
      }
    } catch (err: any) {
      console.error("Errore salvataggio distinta base:", err);
      toast({
        title: "Errore",
        description: err?.message || "Impossibile salvare la distinta base.",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (focusedIndex !== null && !suggestionRefs.current[focusedIndex]?.contains(event.target as Node)) {
        setFocusedIndex(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [focusedIndex]);

  const innerContent = (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {!embedded && (
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>{article ? `Modifica Distinta Base: ${article.code}` : 'Crea Nuovo Articolo'}</DialogTitle>
          <DialogDescription>
            Definisci i componenti. Puoi digitare, incollare o selezionare dai suggerimenti.
          </DialogDescription>
        </DialogHeader>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 border-b space-y-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Codice Articolo</FormLabel>
                  <FormControl>
                    <Input placeholder="Es. ART-00123" {...field} disabled={!!article} className="font-bold" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="workCycleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ciclo Predefinito (Opzionale)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona ciclo..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="manual">Nessun ciclo (Manuale)</SelectItem>
                        {availableWorkCycles.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="secondaryWorkCycleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ciclo Secondario (Opzionale)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona ciclo..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="manual">Nessun ciclo (Manuale)</SelectItem>
                        {availableWorkCycles.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              <h4 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Componenti Distinta Base</h4>
              {fields.map((field, index) => {
                const currentValue = form.watch(`billOfMaterials.${index}.component`) || '';
                const componentMaterial = materialCache[currentValue.toUpperCase()];

                return (
                  <div key={field.id} className="grid grid-cols-12 gap-3 p-4 border rounded-lg relative bg-muted/10">
                    <div className="col-span-12 sm:col-span-4">
                      <FormField
                        control={form.control}
                        name={`billOfMaterials.${index}.component`}
                        render={({ field }) => (
                          <FormItem className="relative">
                            <FormLabel className="flex items-center justify-between">
                              <span>Componente</span>
                              {componentMaterial && (
                                <span className="text-[10px] text-green-600 dark:text-green-400 flex items-center font-normal truncate max-w-[150px]" title={componentMaterial.description}>
                                  <Check className="h-3 w-3 mr-1 flex-shrink-0" />
                                  <span className="truncate">{componentMaterial.description}</span>
                                </span>
                              )}
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...(() => { const { ref: fieldRef, ...rest } = field; return rest; })()}
                                ref={(el) => {
                                  field.ref(el);
                                  if (el) bomRefs.current[`${index}-component`] = el;
                                }}
                                placeholder="Digita o incolla..."
                                className="font-mono uppercase"
                                autoComplete="off"
                                onFocus={() => { setFocusedIndex(index); handleSearch(currentValue); }}
                                onChange={(e) => {
                                  const val = e.target.value.toUpperCase();
                                  field.onChange(val);
                                  handleSearch(val);
                                }}
                                onKeyDown={(e) => handleKeyDown(e, index, 'component')}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="col-span-6 sm:col-span-2">
                      <FormField
                        control={form.control}
                        name={`billOfMaterials.${index}.quantity`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Q.tà per Pz</FormLabel>
                            <FormControl>
                              <Input
                                {...(() => { const { ref: fieldRef, ...rest } = field; return rest; })()}
                                ref={(el) => { field.ref(el); if (el) bomRefs.current[`${index}-quantity`] = el; }}
                                type="number"
                                step="any"
                                onKeyDown={(e) => handleKeyDown(e, index, 'quantity')}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {(() => {
                      const typeConfig = componentMaterial && globalSettings
                        ? globalSettings.rawMaterialTypes.find(t => t.id === componentMaterial.type)
                        : null;
                      const requiresCut = typeConfig ? typeConfig.requiresCutLength !== false : true; // Default true per retrocompatibilità se manca config

                      if (!requiresCut) return null;

                      return (
                        <div className="col-span-6 sm:col-span-2 animate-in fade-in zoom-in duration-300">
                          <FormField
                            control={form.control}
                            name={`billOfMaterials.${index}.lunghezzaTaglioMm`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>L. Taglio (mm)</FormLabel>
                                <FormControl>
                                  <Input
                                    {...(() => { const { ref: fieldRef, ...rest } = field; return rest; })()}
                                    ref={(el) => { field.ref(el); if (el) bomRefs.current[`${index}-lunghezzaTaglioMm`] = el; }}
                                    type="number"
                                    step="any"
                                    placeholder="-"
                                    value={field.value ?? ''}
                                    disabled={componentMaterial?.unitOfMeasure === 'n'}
                                    onKeyDown={(e) => handleKeyDown(e, index, 'lunghezzaTaglioMm')}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      );
                    })()}

                    <div className="col-span-10 sm:col-span-3">
                      <FormField
                        control={form.control}
                        name={`billOfMaterials.${index}.note`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Note</FormLabel>
                            <FormControl>
                              <Input
                                {...(() => { const { ref: fieldRef, ...rest } = field; return rest; })()}
                                ref={(el) => { field.ref(el); if (el) bomRefs.current[`${index}-note`] = el; }}
                                placeholder="..."
                                value={field.value ?? ''}
                                onKeyDown={(e) => handleKeyDown(e, index, 'note')}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="col-span-2 sm:col-span-1 flex items-end pb-2">
                      <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
              <Button
                type="button"
                variant="outline"
                className="w-full mt-4 border-dashed"
                onClick={() => {
                  setLastRowAdded(fields.length);
                  append({ component: '', unit: 'n', quantity: 1, lunghezzaTaglioMm: undefined, note: '' });
                }}
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                Aggiungi Riga Componente
              </Button>

              <Separator className="my-8" />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground flex items-center">
                    <FileText className="mr-2 h-4 w-4" />
                    NOTE TECNICHE E DISEGNO
                  </h4>
                </div>

                <div className="space-y-4 p-4 border rounded-lg bg-muted/10">
                  {/* 1. Note Tecniche Testuali */}
                  <FormField
                    control={form.control}
                    name="technicalNotes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Note Tecniche / Istruzioni Speciali ODL</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            value={field.value ?? ''}
                            placeholder="Inserisci note tecniche o istruzioni speciali..."
                            className="min-h-[110px] resize-y"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* 2. Upload Disegno Tecnico (PNG / JPEG / PDF) su Firebase Storage */}
                  <div className="space-y-2">
                    <FormLabel className="block">Disegno Tecnico / Immagine ODL (PNG, JPEG, PDF)</FormLabel>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png, image/jpeg, application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          void handleDrawingFileUpload(file);
                        }
                      }}
                    />

                    {(() => {
                      const currentDrawingUrl = form.watch('technicalDrawingUrl') || '';
                      const isPdfUrl =
                        currentDrawingUrl.toLowerCase().includes('.pdf') ||
                        uploadedFileName.toLowerCase().endsWith('.pdf');

                      let displayFileName = uploadedFileName;
                      if (!displayFileName && currentDrawingUrl) {
                        try {
                          const decoded = decodeURIComponent(currentDrawingUrl);
                          const afterSlash = decoded.split('/').pop() || '';
                          displayFileName = afterSlash.split('?')[0] || 'Disegno caricato';
                        } catch {
                          displayFileName = 'Disegno caricato';
                        }
                      }

                      return (
                        <div className="space-y-3">
                          {!currentDrawingUrl ? (
                            <div
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsDragOver(true);
                              }}
                              onDragLeave={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsDragOver(false);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsDragOver(false);
                                const file = e.dataTransfer.files?.[0];
                                if (file) {
                                  void handleDrawingFileUpload(file);
                                }
                              }}
                              onClick={() => !isUploadingDrawing && fileInputRef.current?.click()}
                              className={cn(
                                "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-2",
                                isDragOver
                                  ? "border-primary bg-primary/10"
                                  : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30",
                                isUploadingDrawing && "opacity-60 pointer-events-none"
                              )}
                            >
                              {isUploadingDrawing ? (
                                <>
                                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                                  <p className="text-sm font-medium">Caricamento disegno su Firebase Storage...</p>
                                </>
                              ) : (
                                <>
                                  <Upload className="h-7 w-7 text-muted-foreground" />
                                  <div className="text-sm font-medium">
                                    Trascina qui il file oppure <span className="text-primary underline">clicca per sfogliare</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    Formati supportati: PNG, JPEG, PDF
                                  </p>
                                </>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-3 border rounded-lg bg-background">
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                {!isPdfUrl ? (
                                  <div className="h-20 w-28 rounded border bg-white flex items-center justify-center overflow-hidden shrink-0">
                                    <img
                                      src={currentDrawingUrl}
                                      alt="Anteprima Disegno Tecnico"
                                      className="max-h-full max-w-full object-contain"
                                    />
                                  </div>
                                ) : (
                                  <div className="h-14 w-14 rounded border bg-muted flex items-center justify-center shrink-0">
                                    <FileText className="h-7 w-7 text-primary" />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1 space-y-1">
                                  <p className="text-xs font-mono font-semibold truncate" title={displayFileName}>
                                    {displayFileName}
                                  </p>
                                  <a
                                    href={currentDrawingUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    <span>Apri file originale</span>
                                  </a>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={isUploadingDrawing || isRemovingDrawing}
                                  onClick={() => fileInputRef.current?.click()}
                                >
                                  {isUploadingDrawing ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                                  ) : (
                                    <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
                                  )}
                                  Sostituisci
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  disabled={isRemovingDrawing || isUploadingDrawing}
                                  onClick={handleRemoveDrawing}
                                >
                                  {isRemovingDrawing ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                                  )}
                                  Rimuovi
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <div className="space-y-4 border-t pt-8 pb-8">
                <h4 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground flex items-center">
                  <Ship className="mr-2 h-4 w-4" />
                  Packing & Spedizioni
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="packagingType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tipo Imballo (es. Scatola 50pz)</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="unitWeightKg"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Peso Unitario Articolo (Kg)</FormLabel>
                        <FormControl><Input type="number" step="0.001" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="packagingTareWeightKg"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Peso Tara Imballo (Kg)</FormLabel>
                        <FormControl><Input type="number" step="0.001" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="packingInstructions"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Istruzioni Speciali Imballo</FormLabel>
                        <FormControl><Input {...field} placeholder="Es. sigillare con nastro personalizzato..." /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="p-4 border-t sticky bottom-0 bg-background">
            <Button type="button" variant="outline" onClick={() => onClose()}>Annulla</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salva Distinta Base
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </div>
  );

  if (embedded) {
    return innerContent;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col" onOpenAutoFocus={(e) => e.preventDefault()}>
        {innerContent}
      </DialogContent>
    </Dialog>
  );
}
