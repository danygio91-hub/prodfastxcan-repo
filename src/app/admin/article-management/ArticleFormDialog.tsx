
"use client";

import React, { useEffect, useState, useRef } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, Save, Loader2, Check, FileText, Link as LinkIcon, Ship } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

import type { Article, RawMaterial, WorkCycle } from '@/types';
import { saveArticle, getWorkCycles } from './actions';
import { getRawMaterials, getMaterialsByCodes } from '../raw-material-management/actions';

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
  attachments: z.array(z.object({
    name: z.string().min(1, "Nome obbligatorio"),
    url: z.string().url("URL non valido")
  })).optional().default([]),
  packagingType: z.string().optional(),
  packingInstructions: z.string().optional(),
  unitWeightKg: z.coerce.number().min(0).optional(),
  packagingTareWeightKg: z.coerce.number().min(0).optional(),
});

type ArticleFormValues = z.infer<typeof articleSchema>;

interface ArticleFormDialogProps {
  isOpen: boolean;
  onClose: (refresh?: boolean) => void;
  article: Article | null;
}

export default function ArticleFormDialog({ isOpen, onClose, article }: ArticleFormDialogProps) {
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
  const [availableWorkCycles, setAvailableWorkCycles] = useState<WorkCycle[]>([]);

  // Load initial materials and work cycles
  useEffect(() => {
    getWorkCycles().then(setAvailableWorkCycles);
    if (isOpen && article?.billOfMaterials) {
       const codes = article.billOfMaterials.map(i => i.component).filter(Boolean);
       if (codes.length > 0) {
          getMaterialsByCodes(codes).then(mats => {
             setMaterialCache(prev => {
                const newC = { ...prev };
                mats.forEach(m => newC[m.code.toUpperCase()] = m);
                return newC;
             });
          });
       }
    }
  }, [isOpen, article]);

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
      attachments: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "billOfMaterials",
  });

  const { fields: attachmentFields, append: appendAttachment, remove: removeAttachment } = useFieldArray({
    control: form.control,
    name: "attachments",
  });

  useEffect(() => {
    if (isOpen) {
      if (article) {
        form.reset({
          id: article.id,
          code: article.code,
          billOfMaterials: article.billOfMaterials || [],
          workCycleId: article.workCycleId || '',
          secondaryWorkCycleId: article.secondaryWorkCycleId || '',
          attachments: article.attachments || [],
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
          attachments: [],
          packagingType: '',
          packingInstructions: '',
          unitWeightKg: 0,
          packagingTareWeightKg: 0,
        });
      }
    }
  }, [article, form, isOpen]);

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
    setIsPending(true);
    // Filter out empty rows before sending to server
    const filteredData = {
      ...data,
      billOfMaterials: (data.billOfMaterials || []).filter(item => item.component && item.component.trim() !== '')
    };
    const result = await saveArticle(filteredData);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      onClose(true);
    }
    setIsPending(false);
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{article ? `Modifica Distinta Base: ${article.code}` : 'Crea Nuovo Articolo'}</DialogTitle>
          <DialogDescription>
            Definisci i componenti. Puoi digitare, incollare o selezionare dai suggerimenti.
          </DialogDescription>
        </DialogHeader>
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
                                      field.onChange(e);
                                      handleSearch(e.target.value);
                                  }}
                                  onKeyDown={(e) => handleKeyDown(e, index, 'component')}
                                />
                              </FormControl>
                              {focusedIndex === index && (suggestions.length > 0 || isSearching) && (
                                <div
                                  ref={el => { suggestionRefs.current[index] = el; }}
                                  className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto"
                                >
                                  {isSearching && <div className="p-3 text-xs text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mx-auto"/></div>}
                                  {!isSearching && suggestions.map(m => (
                                    <button
                                      key={m.id}
                                      type="button"
                                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between group"
                                      onClick={() => {
                                        form.setValue(`billOfMaterials.${index}.component`, m.code);
                                        form.setValue(`billOfMaterials.${index}.unit`, m.unitOfMeasure);
                                        setFocusedIndex(null);
                                        // AUTO-FOCUS QUANTITY AFTER SELECTION
                                        setTimeout(() => focusRowField(index, 'quantity'), 10);
                                      }}
                                    >
                                      <span className="font-mono">{m.code}</span>
                                      <span className="text-[10px] text-muted-foreground group-hover:text-accent-foreground">{m.description.slice(0, 20)}...</span>
                                    </button>
                                  ))}
                                </div>
                              )}
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

                      <div className="col-span-6 sm:col-span-2">
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
                      Allegati Tecnici (Disegni, Schede)
                    </h4>
                  </div>
                  
                  <div className="space-y-3">
                    {attachmentFields.map((field, index) => (
                      <div key={field.id} className="flex gap-3 items-start p-3 border rounded-lg bg-blue-50/30">
                        <FormField
                          control={form.control}
                          name={`attachments.${index}.name`}
                          render={({ field }) => (
                            <FormItem className="flex-1">
                              <FormControl>
                                <Input {...field} placeholder="Titolo Allegato (es. Disegno Tecnico)" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`attachments.${index}.url`}
                          render={({ field }) => (
                            <FormItem className="flex-[2]">
                              <FormControl>
                                <div className="relative">
                                  <LinkIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                  <Input {...field} className="pl-9" placeholder="https://drive.google.com/..." />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeAttachment(index)}
                          className="text-destructive shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full border-blue-200 text-blue-600 hover:bg-blue-50"
                      onClick={() => appendAttachment({ name: '', url: '' })}
                    >
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Aggiungi Nuovo Allegato
                    </Button>
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
      </DialogContent>
    </Dialog>
  );
}
