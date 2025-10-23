
"use client";

import React, { useEffect, useState } from 'react';
import * as z from 'zod';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';

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
import { PlusCircle, Trash2, Save, Loader2 } from 'lucide-react';

import type { Article } from '@/lib/mock-data';
import { saveArticle } from './actions';

const bomItemSchema = z.object({
  component: z.string().min(1, "Il nome del componente è obbligatorio."),
  unit: z.string().min(1, "L'unità di misura è obbligatoria."),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  size: z.string().optional(),
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
}

export default function ArticleFormDialog({ isOpen, onClose, article }: ArticleFormDialogProps) {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);

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
        const defaultBOM = Array(10).fill({ component: '', unit: 'n', quantity: 1, size: '' });
        form.reset({
            id: undefined,
            code: '',
            billOfMaterials: defaultBOM,
        });
        }
    }
  }, [article, form, isOpen]);

  const onSubmit = async (data: ArticleFormValues) => {
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
                {fields.map((field, index) => (
                  <div key={field.id} className="grid grid-cols-12 gap-2 p-3 border rounded-md relative">
                    <div className="col-span-12 sm:col-span-4">
                      <FormField
                        control={form.control}
                        name={`billOfMaterials.${index}.component`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Componente</FormLabel>
                            <FormControl><Input placeholder="Codice componente..." {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="col-span-6 sm:col-span-2">
                      <FormField
                        control={form.control}
                        name={`billOfMaterials.${index}.unit`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>UM</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger><SelectValue placeholder="Unità" /></SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="n">n</SelectItem>
                                <SelectItem value="mt">mt</SelectItem>
                                <SelectItem value="kg">kg</SelectItem>
                              </SelectContent>
                            </Select>
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
                            <FormLabel>Quantità</FormLabel>
                            <FormControl><Input type="number" step="any" placeholder="0.0" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="col-span-12 sm:col-span-3">
                      <FormField
                        control={form.control}
                        name={`billOfMaterials.${index}.size`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Numero/Misura</FormLabel>
                            <FormControl><Input placeholder="Es. 3,5x16mm" {...field} /></FormControl>
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
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full mt-4"
                  onClick={() => append({ component: '', unit: 'n', quantity: 1, size: '' })}
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
