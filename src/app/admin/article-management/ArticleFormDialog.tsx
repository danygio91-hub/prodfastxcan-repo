"use client";

import React, { useEffect, useState } from 'react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { PlusCircle, Trash2, Save, Loader2, ChevronsUpDown, Check } from 'lucide-react';

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
  const [openComboboxIndex, setOpenComboboxIndex] = useState<number | null>(null);

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
        const defaultBOM = Array(10).fill({ component: '', unit: 'n', quantity: 1, lunghezzaTaglioMm: undefined, note: '' });
        form.reset({
            id: undefined,
            code: '',
            billOfMaterials: defaultBOM,
        });
        }
    }
  }, [article, form, isOpen]);

  const onSubmit = async (data: ArticleFormValues) => {
    const materialCodes = new Set(rawMaterials.map(m => m.code));
    const invalidItem = data.billOfMaterials.find(item => item.component && !materialCodes.has(item.component));

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
      onClose(true); // Close and refresh
    }
    setIsPending(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{article ? `Modifica Distinta Base: ${article.code}` : 'Crea Nuovo Articolo'}</DialogTitle>
          <DialogDescription>
            Definisci il codice articolo e i componenti necessari per la sua produzione.
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
                      <Input placeholder="Es. ART-00123" {...field} disabled={!!article} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                <h4 className="font-semibold">Componenti Distinta Base</h4>
                {fields.map((field, index) => {
                  const selectedComponentCode = form.watch(`billOfMaterials.${index}.component`);
                  const componentMaterial = rawMaterials.find(m => m.code === selectedComponentCode);

                  return (
                  <div key={field.id} className="grid grid-cols-12 gap-2 p-3 border rounded-md relative">
                    <div className="col-span-12 sm:col-span-4">
                       <FormField
                        control={form.control}
                        name={`billOfMaterials.${index}.component`}
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel>Componente</FormLabel>
                             <Popover open={openComboboxIndex === index} onOpenChange={(isOpen) => setOpenComboboxIndex(isOpen ? index : null)}>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    role="combobox"
                                    className={cn(
                                      "w-full justify-between",
                                      !field.value && "text-muted-foreground"
                                    )}
                                  >
                                    {field.value
                                      ? rawMaterials.find(
                                          (material) => material.code === field.value
                                        )?.code
                                      : "Seleziona componente..."}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                <Command>
                                  <CommandInput placeholder="Cerca componente..." />
                                  <CommandEmpty>Nessun componente trovato.</CommandEmpty>
                                  <CommandGroup>
                                    <ScrollArea className="h-48">
                                    {rawMaterials.map((material) => (
                                      <CommandItem
                                        value={material.code}
                                        key={material.id}
                                        onSelect={() => {
                                          form.setValue(`billOfMaterials.${index}.component`, material.code);
                                          form.setValue(`billOfMaterials.${index}.unit`, material.unitOfMeasure);
                                          setOpenComboboxIndex(null);
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            material.code === field.value
                                              ? "opacity-100"
                                              : "opacity-0"
                                          )}
                                        />
                                        {material.code}
                                      </CommandItem>
                                    ))}
                                    </ScrollArea>
                                  </CommandGroup>
                                </Command>
                              </PopoverContent>
                            </Popover>
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
                            <FormControl><Input type="number" step="any" placeholder="0.0" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {componentMaterial?.unitOfMeasure !== 'n' ? (
                       <div className="col-span-6 sm:col-span-3">
                        <FormField
                            control={form.control}
                            name={`billOfMaterials.${index}.lunghezzaTaglioMm`}
                            render={({ field }) => (
                            <FormItem>
                                <FormLabel>Lunghezza Taglio (mm)</FormLabel>
                                <FormControl><Input type="number" step="any" placeholder="Es. 500" {...field} value={field.value ?? ''} /></FormControl>
                                <FormMessage />
                            </FormItem>
                            )}
                        />
                       </div>
                    ) : (
                         <div className="col-span-6 sm:col-span-3" /> // Placeholder
                    )}
                    
                    <div className="col-span-12 sm:col-span-3">
                      <FormField
                        control={form.control}
                        name={`billOfMaterials.${index}.note`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Note</FormLabel>
                            <FormControl><Input placeholder="Es. 3,5x16mm, taglio a 45°..." {...field} value={field.value ?? ''} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="absolute top-2 right-2">
                      <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                )})}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full mt-4"
                  onClick={() => append({ component: '', unit: 'n', quantity: 1, lunghezzaTaglioMm: undefined, note: '' })}
                >
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Aggiungi Componente
                </Button>
              </div>
            </ScrollArea>
            
            <DialogFooter className="p-4 border-t sticky bottom-0 bg-background">
              <Button type="button" variant="outline" onClick={() => onClose()}>Annulla</Button>
              <Button type="submit" disabled={isPending}>
                 {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                {article ? 'Salva Modifiche' : 'Crea Articolo'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
