'use client';

import React, { useState, useRef } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { MaskedDatePicker } from '@/components/ui/masked-date-picker';
import { ArrowUpDown, Loader2, PlusCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import type { Department, WorkCycle, Article, JobOrder } from '@/types';
import { saveManualJobOrder } from '@/app/admin/data-management/actions';
import { getArticles } from '@/app/admin/article-management/actions';

const manualCreateSchema = z.object({
  cliente: z.string().min(1, "Il cliente è obbligatorio."),
  ordinePF: z.string().min(1, "L'Ordine PF è obbligatorio."),
  articleCode: z.string().min(1, "L'articolo è obbligatorio."),
  qta: z.coerce.number().positive("La quantità deve essere positiva."),
  dataConsegnaFinale: z.string().min(1, "La data di consegna è obbligatoria."),
  dataFinePreparazione: z.string().optional(),
  department: z.string().min(1, "Il reparto è obbligatorio."),
  workCycleId: z.string().min(1, "Il ciclo di lavoro è obbligatorio."),
  numeroODLInterno: z.string().optional(),
}).refine(data => {
  if (data.dataFinePreparazione && data.dataConsegnaFinale) {
    return data.dataFinePreparazione <= data.dataConsegnaFinale;
  }
  return true;
}, {
  message: "La data fine preparazione non può essere successiva alla consegna finale.",
  path: ["dataFinePreparazione"]
});

export type ManualCreateValues = z.infer<typeof manualCreateSchema>;

interface ManualJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  workCycles: WorkCycle[];
  departments: Department[];
  onJobCreated?: (job: JobOrder) => void;
}

export function ManualJobModal({
  isOpen,
  onClose,
  workCycles,
  departments,
  onJobCreated,
}: ManualJobModalProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isArticlePopoverOpen, setIsArticlePopoverOpen] = useState(false);
  const [articleSuggestions, setArticleSuggestions] = useState<Article[]>([]);
  const [isSearchingArticles, setIsSearchingArticles] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const form = useForm<ManualCreateValues>({
    resolver: zodResolver(manualCreateSchema),
    defaultValues: {
      cliente: '',
      ordinePF: '',
      articleCode: '',
      qta: 1,
      dataConsegnaFinale: '',
      dataFinePreparazione: '',
      department: '',
      workCycleId: '',
      numeroODLInterno: '',
    },
  });

  const filteredDepartments = departments.filter(
    (d) => d.macroAreas?.includes('PRODUZIONE') || d.code === 'CP' || d.code === 'CG' || d.code === 'BF'
  );

  const handleSearchArticle = (term: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!term || term.trim().length < 2) {
      setArticleSuggestions([]);
      setIsSearchingArticles(false);
      return;
    }
    setIsSearchingArticles(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await getArticles(term);
        setArticleSuggestions(res);
      } catch (e) {
        console.error("Errore ricerca articoli:", e);
      } finally {
        setIsSearchingArticles(false);
      }
    }, 350);
  };

  const onSubmit = async (values: ManualCreateValues) => {
    setIsSubmitting(true);
    try {
      const res = await saveManualJobOrder(values);
      if (res.success) {
        toast({ title: "Commessa Creata", description: res.message });
        const job = (res as any).job;
        if (onJobCreated && job) {
          onJobCreated(job);
        } else if (onJobCreated) {
          // Fallback optimistic object
          const optimisticJob: JobOrder = {
            id: values.ordinePF.replace(/\//g, '-'),
            ordinePF: values.ordinePF,
            cliente: values.cliente,
            details: values.articleCode.toUpperCase(),
            qta: Number(values.qta),
            department: values.department,
            dataConsegnaFinale: values.dataConsegnaFinale,
            dataFinePreparazione: values.dataFinePreparazione || '',
            workCycleId: values.workCycleId,
            numeroODLInterno: values.numeroODLInterno || null,
            numeroODL: values.numeroODLInterno || 'MANUALE',
            status: 'Pianificata',
            phases: [],
            billOfMaterials: [],
            postazioneLavoro: 'Da Assegnare',
            isPrinted: false,
            odlPrinted: false,
            createdAt: new Date().toISOString() as any,
            updatedAt: new Date().toISOString() as any,
          };
          onJobCreated(optimisticJob);
        }
        form.reset();
        onClose();
      } else {
        toast({ variant: "destructive", title: "Errore", description: res.message });
      }
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Errore",
        description: e.message || "Impossibile salvare la commessa manuale.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="max-w-2xl bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-primary" />
            Nuova Commessa Manuale
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="cliente"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cliente</FormLabel>
                    <FormControl>
                      <Input placeholder="Nome cliente..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ordinePF"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ordine PF</FormLabel>
                    <FormControl>
                      <Input placeholder="Es. 100/PF" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="articleCode"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Articolo</FormLabel>
                  <Popover open={isArticlePopoverOpen} onOpenChange={setIsArticlePopoverOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between font-bold text-blue-500 border-blue-500/20"
                        >
                          {field.value || "Seleziona Articolo dall'Anagrafica..."}
                          <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput
                          placeholder="Cerca per codice (minimo 2 lettere)..."
                          onValueChange={handleSearchArticle}
                        />
                        <CommandList>
                          <CommandEmpty>
                            {isSearchingArticles ? (
                              <Loader2 className="h-4 w-4 animate-spin mx-auto my-2 text-primary" />
                            ) : (
                              "Nessun articolo trovato."
                            )}
                          </CommandEmpty>
                          <CommandGroup>
                            {articleSuggestions.map((a) => (
                              <CommandItem
                                key={a.id}
                                value={a.code}
                                onSelect={() => {
                                  form.setValue("articleCode", a.code);
                                  if (a.workCycleId) {
                                    form.setValue("workCycleId", a.workCycleId);
                                  }
                                  if (!form.getValues("department")) {
                                    const artDept = (a as any).department;
                                    const defaultDept =
                                      filteredDepartments.find((d) => d.code === artDept || d.id === artDept) ||
                                      filteredDepartments.find((d) => d.macroAreas?.includes('PRODUZIONE')) ||
                                      filteredDepartments[0];
                                    if (defaultDept) {
                                      form.setValue("department", defaultDept.code || defaultDept.id);
                                    }
                                  }
                                  setIsArticlePopoverOpen(false);
                                }}
                              >
                                <span className="font-bold">{a.code}</span>
                                {a.description && (
                                  <span className="text-xs text-muted-foreground ml-2 truncate">
                                    - {a.description}
                                  </span>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="dataFinePreparazione"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-amber-500 font-black uppercase text-[10px] tracking-widest">
                      Fine Prep. (Magazzino)
                    </FormLabel>
                    <FormControl>
                      <MaskedDatePicker
                        value={field.value ? parseISO(field.value) : null}
                        onChange={(date) => field.onChange(date ? format(date, 'yyyy-MM-dd') : '')}
                        className="border-amber-500/30 focus:border-amber-500 bg-amber-500/5"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dataConsegnaFinale"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-emerald-500 font-black uppercase text-[10px] tracking-widest">
                      Consegna Finale (Cliente) *
                    </FormLabel>
                    <FormControl>
                      <MaskedDatePicker
                        value={field.value ? parseISO(field.value) : null}
                        onChange={(date) => field.onChange(date ? format(date, 'yyyy-MM-dd') : '')}
                        className="border-emerald-500/30 focus:border-emerald-500 bg-emerald-500/5"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="qta"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantità *</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reparto *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {filteredDepartments.map((d) => (
                          <SelectItem key={d.id} value={d.code}>
                            {d.name} ({d.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="workCycleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ciclo di Lavoro *</FormLabel>
                  <Select
                    onValueChange={(val) => {
                      field.onChange(val);
                      if (!form.getValues("department")) {
                        const defaultDept =
                          filteredDepartments.find((d) => d.macroAreas?.includes('PRODUZIONE')) ||
                          filteredDepartments[0];
                        if (defaultDept) {
                          form.setValue("department", defaultDept.code || defaultDept.id);
                        }
                      }
                    }}
                    value={field.value || ""}
                  >
                    <FormControl>
                      <SelectTrigger className="border-blue-500/20 bg-blue-500/5">
                        <SelectValue placeholder="Seleziona Ciclo..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {workCycles.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Annulla
              </Button>
              <Button type="submit" disabled={isSubmitting} className="gap-2">
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Salva Commessa
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
