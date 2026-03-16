
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
import { PlusCircle, Trash2, Save, Loader2, Check } from 'lucide-react';

import type { Article, RawMaterial } from '@/lib/mock-data';
import { saveArticle } from './actions';

const bomItemSchema = z.object({
  component: z.string().min(1, "Selezionare un componente valido."),
  unit: z.enum(['n', 'mt', 'kg']),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  lunghezzaTaglioMm: z.coerce.number().optional(),
  note: z.string().optional(),
});


const articleSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(3, "Il codice articolo è obbligatorio."),
  billOfMaterials: z.array(bomItemSchema).optional().default([]),
});

type ArticleFormValues = z.infer<typeof articleSchema>;

interface ArticleFormDialogProps {
  isOpen: boolean;
  onClose: (refresh?: boolean) => void;
  article: Article | null;
  rawMaterials: RawMaterial[];
}

export default function ArticleFormDialog({ isOpen, onClose, article, rawMaterials }: ArticleFormDialogProps) {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const suggestionRefs = useRef<(HTMLDivElement | null)[]>([]);

  const form = useForm<ArticleFormValues>({
    resolver: zodResolver(articleSchema),
    defaultValues: {
      code: '',
      billOfMaterials: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "billOfMaterials",
  });

  useEffect(() => {
    if (isOpen) {
        if (article) {
        form.reset({
            id: article.id,
            code: article.code,
            billOfMaterials: article.billOfMaterials || [],
        });
        } else {
        const defaultBOM = Array(5).fill({ component: '', unit: 'n', quantity: 1, lunghezzaTaglioMm: undefined, note: '' });
        form.reset({
            id: undefined,
            code: '',
            billOfMaterials: defaultBOM,
        });
        }
    }
  }, [article, form, isOpen]);

  const onSubmit = async (data: ArticleFormValues) => {
    const materialCodes = new Set(rawMaterials.map(m => m.code.toUpperCase()));
    const invalidItem = data.billOfMaterials.find(item => item.component && !materialCodes.has(item.component.toUpperCase()));

    if (invalidItem) {
        toast({
            variant: "destructive",
            title: "Componente non valido",
            description: `Il componente "${invalidItem.component}" non esiste nell'anagrafica materie prime.`
        });
        return;
    }

    setIsPending(true);
    const result = await saveArticle(data);
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
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{article ? `Modifica Distinta Base: ${article.code}` : 'Crea Nuovo Articolo'}</DialogTitle>
          <DialogDescription>
            Definisci i componenti. Puoi digitare, incollare o selezionare dai suggerimenti.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b">
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
            </div>

            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                <h4 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Componenti Distinta Base</h4>
                {fields.map((field, index) => {
                  const currentValue = form.watch(`billOfMaterials.${index}.component`) || '';
                  const suggestions = rawMaterials.filter(m => 
                    currentValue.length >= 2 && m.code.toLowerCase().includes(currentValue.toLowerCase())
                  ).slice(0, 10);

                  const componentMaterial = rawMaterials.find(m => m.code.toUpperCase() === currentValue.toUpperCase());

                  return (
                  <div key={field.id} className="grid grid-cols-12 gap-3 p-4 border rounded-lg relative bg-muted/10">
                    <div className="col-span-12 sm:col-span-4">
                       <FormField
                        control={form.control}
                        name={`billOfMaterials.${index}.component`}
                        render={({ field }) => (
                          <FormItem className="relative">
                            <FormLabel>Componente</FormLabel>
                            <FormControl>
                                <Input 
                                    {...field} 
                                    placeholder="Digita o incolla..." 
                                    className="font-mono uppercase"
                                    autoComplete="off"
                                    onFocus={() => setFocusedIndex(index)}
                                />
                            </FormControl>
                            {focusedIndex === index && suggestions.length > 0 && (
                                <div 
                                    ref={el => suggestionRefs.current[index] = el}
                                    className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto"
                                >
                                    {suggestions.map(m => (
                                        <button
                                            key={m.id}
                                            type="button"
                                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between group"
                                            onClick={() => {
                                                form.setValue(`billOfMaterials.${index}.component`, m.code);
                                                form.setValue(`billOfMaterials.${index}.unit`, m.unitOfMeasure);
                                                setFocusedIndex(null);
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
                            <FormControl><Input type="number" step="any" {...field} /></FormControl>
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
                                <FormControl><Input type="number" step="any" placeholder="-" {...field} value={field.value ?? ''} disabled={componentMaterial?.unitOfMeasure === 'n'} /></FormControl>
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
                            <FormControl><Input placeholder="..." {...field} value={field.value ?? ''} /></FormControl>
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
                )})}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full mt-4 border-dashed"
                  onClick={() => append({ component: '', unit: 'n', quantity: 1, lunghezzaTaglioMm: undefined, note: '' })}
                >
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Aggiungi Riga Componente
                </Button>
              </div>
            </ScrollArea>
            
            <DialogFooter className="p-4 border-t sticky bottom-0 bg-background">
              <Button type="button" variant="outline" onClick={() => onClose()}>Annulla</Button>
              <Button type="submit" disabled={isPending}>
                 {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                Salva Distinta Base
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
