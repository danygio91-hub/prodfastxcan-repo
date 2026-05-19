'use client';

import React, { useState, useEffect, useMemo, useTransition } from 'react';
import { 
  Dialog, DialogContent, DialogDescription, DialogHeader, 
  DialogTitle, DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from '@/components/ui/select';
import { 
  Combine, Loader2, Save, X, Info, 
  AlertCircle, CheckCircle2, History, PackagePlus, Timer,
  ExternalLink, Layers, PlusCircle, Lock, ShieldCheck
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Department, BillOfMaterialsItem, Client, WorkCycle } from '@/types';
import { GlobalSettings, SmartCodeField } from '@/lib/settings-types';
import { getCustomerPrefix } from '@/lib/customer-utils';
import { 
  saveSmartJobOrder, 
  getClients, 
  getWorkCycles, 
  getDepartments,
  checkArticleExists 
} from '@/app/admin/data-management/actions';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import SmartBOMEditor from './SmartBOMEditor';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface SmartJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: GlobalSettings | null;
  initialJob?: any;
}

export function SmartJobModal({ isOpen, onClose, settings: globalSettings, initialJob }: SmartJobModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(true);
  const [cycles, setCycles] = useState<WorkCycle[]>([]);
  
  // Form State
  const [clienteName, setClienteName] = useState('');
  const [ordinePF, setOrdinePF] = useState('');
  const [qta, setQta] = useState('1');
  const [dataConsegna, setDataConsegna] = useState('');
  const [dataPrep, setDataPrep] = useState('');
  const [selectedCycleId, setSelectedCycleId] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  
  // Master Data State
  const [departments, setDepartments] = useState<Department[]>([]);
  const [bom, setBom] = useState<BillOfMaterialsItem[]>([]);
  const [expectedMinutes, setExpectedMinutes] = useState<string>('');
  const [articleExists, setArticleExists] = useState<boolean | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Sub-UI States
  const [isBOMDialogOpen, setIsBOMDialogOpen] = useState(false);

  const smart = globalSettings?.smartCodeSettings;

  useEffect(() => {
    if (isOpen) {
      setFetchingData(true);
      Promise.all([getWorkCycles(), getDepartments()])
        .then(([cyclesRes, deptsRes]) => {
          setCycles(cyclesRes);
          if (cyclesRes.length > 0 && !selectedCycleId) setSelectedCycleId(cyclesRes[0].id);
          
          setDepartments(deptsRes);
          if (deptsRes.length > 0 && !selectedDept) {
            // Priority to "CORE" departments if possible
            const defaultDept = deptsRes.find(d => d.macroAreas?.includes('PRODUZIONE')) || deptsRes[0];
            setSelectedDept(defaultDept.code || defaultDept.id);
          }
        })
        .finally(() => setFetchingData(false));
    }
  }, [isOpen]);

  const articleCode = useMemo(() => {
    if (!smart || !smart.enabled) return "";
    const prefix = clienteName.trim() ? getCustomerPrefix(clienteName) : "??";
    const parts = smart.pattern
      .map(fieldId => fieldValues[fieldId]?.toUpperCase().trim())
      .filter(Boolean); 

    return [prefix, ...parts].join(smart.separator);
  }, [clienteName, fieldValues, smart]);

  // Restore state from initialJob (Edit Mode)
  useEffect(() => {
    if (initialJob && isOpen) {
      setClienteName(initialJob.cliente || "");
      setOrdinePF(initialJob.ordinePF || "");
      setQta(initialJob.qta?.toString() || "");
      setDataConsegna(initialJob.dataConsegnaFinale || "");
      setDataPrep(initialJob.dataFinePreparazione || "");
      setSelectedCycleId(initialJob.workCycleId || "");
      setFieldValues(initialJob.smartCodeParams || {});
      setBom(initialJob.billOfMaterials || []);
      
      const deptCode = departments.find(d => d.name === initialJob.department || d.code === initialJob.department)?.code || initialJob.department || '';
      setSelectedDept(deptCode);
      
      // If we have article-level data to fetch, we could do it here.
      // But for basic fields, this is enough.
    } else if (!isOpen) {
      // Reset only when closed to prevent flicker
      setOrdinePF('');
      setClienteName('');
      setFieldValues({});
      setBom([]);
      setExpectedMinutes('');
      setArticleExists(null);
    }
  }, [initialJob, isOpen, departments]);

  // Live Validation
  useEffect(() => {
    if (articleCode && !articleCode.includes("??")) {
      setIsValidating(true);
      const timeout = setTimeout(async () => {
        try {
          const exists = await checkArticleExists(articleCode);
          setArticleExists(exists);
        } finally {
          setIsValidating(false);
        }
      }, 500);
      return () => clearTimeout(timeout);
    } else {
      setArticleExists(null);
    }
  }, [articleCode]);

  const handleSave = async () => {
    if (!clienteName.trim() || !ordinePF || !articleCode || !selectedCycleId || !qta) {
      toast({ variant: "destructive", title: "Dati mancanti", description: "Compila tutti i campi obbligatori del prodotto." });
      return;
    }

    if (!expectedMinutes || Number(expectedMinutes) <= 0) {
      toast({ variant: "destructive", title: "Tempo Mancante", description: "Inserisci il Tempo Previsto (minuti) per procedere." });
      return;
    }

    setLoading(true);
    try {
      const res = await saveSmartJobOrder({
        cliente: clienteName.trim(),
        ordinePF,
        articleCode,
        description: `Articolo Smart: ${articleCode}`,
        dataConsegnaFinale: dataConsegna,
        dataFinePreparazione: dataPrep,
        workCycleId: selectedCycleId,
        qta: Number(qta),
        billOfMaterials: bom,
        expectedMinutes: expectedMinutes ? Number(expectedMinutes) : undefined,
        fieldValues,
        department: selectedDept,
        isEdit: !!initialJob
      });

      if (res.success) {
        toast({ title: initialJob ? "Aggiornato" : "Creato", description: res.message });
        startTransition(() => {
          onClose();
          router.refresh();
        });
      } else {
        toast({ variant: "destructive", title: "Errore", description: res.message });
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Errore", description: "Impossibile salvare la commessa." });
    } finally {
      setLoading(false);
    }
  };

  const isFormValid = clienteName.trim() && ordinePF && articleCode !== "??" && selectedCycleId && qta && expectedMinutes;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl bg-slate-950 border-slate-800 text-white shadow-2xl overflow-hidden p-0">
        <div className="bg-gradient-to-r from-primary/20 to-blue-500/10 p-6 border-b border-white/10">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-primary/20 rounded-lg">
                {initialJob ? <Lock className="h-6 w-6 text-amber-500" /> : <Combine className="h-6 w-6 text-primary" />}
              </div>
              <div>
                <DialogTitle className="text-xl font-bold">
                  {initialJob ? `Modifica Commessa: ${initialJob.ordinePF}` : "Nuova Commessa Rapida"}
                </DialogTitle>
                <DialogDescription className="text-slate-400">
                  {initialJob ? "I parametri dell'articolo sono bloccati per sicurezza." : "Configura l'articolo e genera l'ODL in un unico passaggio."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-slate-300 font-semibold">Cliente (Libero)</Label>
              <Input 
                value={clienteName}
                onChange={(e) => setClienteName(e.target.value)}
                placeholder="Es. Zucchini"
                className="bg-slate-900 border-slate-700 h-11 focus:ring-primary"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 font-semibold">Ordine PF (Identificativo Univoco)</Label>
              <Input 
                value={ordinePF}
                onChange={(e) => setOrdinePF(e.target.value)}
                placeholder="Es. PF24-001"
                className="bg-slate-900 border-slate-700 h-11 focus:ring-primary uppercase font-mono"
              />
            </div>
          </div>

          <Separator className="bg-white/5" />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-primary font-bold uppercase tracking-wider text-xs">Configurazione Prodotto</Label>
              <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 px-3 py-1">
                {smart?.separator === '' ? 'Nessun Separatore' : `Separatore: "${smart?.separator}"`}
              </Badge>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {smart?.pattern.map(fieldId => {
                const field = smart.fields.find(f => f.id === fieldId);
                if (!field) return null;

                return (
                  <div key={fieldId} className="space-y-1.5 p-3 bg-white/5 rounded-xl border border-white/5 hover:border-primary/30 transition-all">
                    <Label className="text-[10px] uppercase font-bold text-slate-400 ml-1">{field.name}</Label>
                    
                    {field.type === 'dropdown' ? (
                      <Select 
                        onValueChange={(val) => setFieldValues(prev => ({ ...prev, [field.id]: val === " " ? "" : val }))} 
                        value={fieldValues[field.id] || ""}
                        disabled={!!initialJob}
                      >
                        <SelectTrigger className="bg-slate-950 border-slate-800 h-9 text-sm">
                          <SelectValue placeholder={`Scegli ${field.name}`} />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-950 border-slate-800 text-white">
                          <SelectItem value=" " className="italic text-slate-500">Nessuno</SelectItem>
                          {field.options.map(opt => (
                            <SelectItem key={opt.code} value={opt.code} className="focus:bg-primary/20">
                              {opt.label} <span className="text-[10px] text-primary/60 ml-2">({opt.code})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input 
                        placeholder={`Digita ${field.name}...`}
                        value={fieldValues[field.id] || ""}
                        onChange={(e) => setFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                        className="bg-slate-950 border-slate-800 h-9 text-sm uppercase font-mono"
                        disabled={!!initialJob}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Preview & Validation */}
          <div className="p-5 bg-primary/10 rounded-2xl border border-primary/20 shadow-inner relative overflow-hidden">
            <div className="flex flex-col gap-2 relative z-10">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-primary font-mono uppercase font-bold tracking-widest">Codice Articolo Generato</span>
                <div className="flex items-center gap-2">
                  {isValidating && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                  {!isValidating && articleExists === false && (
                    <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 gap-1 animate-in fade-in slide-in-from-right-1">
                      <PackagePlus className="h-3 w-3" /> Nuovo Articolo
                    </Badge>
                  )}
                  {!isValidating && articleExists === true && (
                    <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 gap-1 animate-in fade-in slide-in-from-right-1">
                      <History className="h-3 w-3" /> Articolo Esistente
                    </Badge>
                  )}
                </div>
              </div>
              <div className="text-2xl md:text-3xl font-mono font-bold text-white tracking-wider flex flex-wrap gap-1">
                {articleCode.split(smart?.separator || '').map((part, i, arr) => (
                  <React.Fragment key={i}>
                    <span className={cn(
                      part === '??' ? 'text-white/20' : 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]',
                      i === 0 && 'text-primary'
                    )}>
                      {part}
                    </span>
                    {i < arr.length - 1 && <span className="text-white/20">{smart?.separator}</span>}
                  </React.Fragment>
                ))}
              </div>
              {articleExists === false && <p className="text-[10px] text-emerald-500/60 font-medium">L'articolo verrà creato automaticamente in anagrafica al salvataggio.</p>}
              {articleExists === true && <p className="text-[10px] text-amber-500/60 font-medium">L'articolo esiste già. BOM e Cicli verranno aggiornati se modificati qui.</p>}
            </div>
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
              <Layers className="h-24 w-24" />
            </div>
          </div>

          {/* Master Data: BOM & Tempi */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label className="text-primary font-bold uppercase tracking-wider text-xs">Master Data (Dati Anagrafici)</Label>
              <Separator className="flex-1 bg-white/5" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* BOM Section */}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Button 
                    variant="outline" 
                    onClick={() => setIsBOMDialogOpen(true)}
                    className={cn(
                      "flex-1 justify-between h-12 border-slate-800 hover:border-primary/50 transition-all",
                      bom.length > 0 && "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <PackagePlus className="h-4 w-4" />
                      <span>{bom.length > 0 ? 'Modifica BOM' : 'Distinta Base (BOM)'}</span>
                    </div>
                    <ExternalLink className="h-4 w-4 opacity-30" />
                  </Button>
                  {bom.length > 0 && (
                    <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 py-2 h-12 px-4 flex items-center gap-2 shadow-lg shadow-emerald-500/5">
                      <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="font-bold">{bom.length} Componenti</span>
                    </Badge>
                  )}
                </div>

                <Dialog open={isBOMDialogOpen} onOpenChange={setIsBOMDialogOpen}>
                  <DialogContent className="max-w-4xl bg-slate-950 border-slate-800 text-white shadow-2xl p-0 overflow-hidden">
                    <div className="bg-gradient-to-r from-emerald-500/20 to-blue-500/10 p-6 border-b border-white/10">
                      <DialogHeader>
                        <DialogTitle className="text-xl font-bold flex items-center gap-2">
                          <PackagePlus className="h-5 w-5 text-emerald-500" />
                          Configurazione Distinta Base (BOM)
                        </DialogTitle>
                        <DialogDescription className="text-slate-400 italic">
                          Definisci i componenti per l'articolo <span className="text-white font-mono">{articleCode}</span>
                        </DialogDescription>
                      </DialogHeader>
                    </div>
                    <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                      <SmartBOMEditor bom={bom} onChange={setBom} />
                    </div>
                    <DialogFooter className="p-4 bg-slate-900 border-t border-white/5">
                      <Button onClick={() => setIsBOMDialogOpen(false)} className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        Salva Distinta Base
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              {/* Time Section */}
              <div className="space-y-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button 
                      variant="outline" 
                      className={cn(
                        "w-full justify-between h-12 border-slate-800 hover:border-primary/50 transition-all",
                        expectedMinutes && "border-amber-500/30 bg-amber-500/5 text-amber-400"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Timer className="h-4 w-4" />
                        <span>Tempo Previsto</span>
                        {expectedMinutes && <span className="ml-1 font-mono font-bold">{expectedMinutes}m</span>}
                      </div>
                      <ExternalLink className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 bg-slate-900 border-slate-800 text-white p-4 shadow-2xl">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-xs font-bold uppercase text-slate-400">Tempo Totale (minuti)</Label>
                        <Input 
                          type="number"
                          value={expectedMinutes}
                          onChange={(e) => setExpectedMinutes(e.target.value)}
                          placeholder="Es. 45"
                          className="bg-slate-950 border-slate-800"
                        />
                        <p className="text-[10px] text-slate-500 leading-tight">
                          Il tempo verrà impostato come target predefinito per questo articolo.
                        </p>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          <Separator className="bg-white/5" />

          {/* Production Data */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
               <div className="space-y-2">
                <Label className="text-slate-300 font-semibold">Quantità Ordine</Label>
                <Input 
                  type="number"
                  value={qta}
                  onChange={(e) => setQta(e.target.value)}
                  className="bg-slate-900 border-slate-700 h-10 font-bold text-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 font-semibold">Ciclo di Lavorazione</Label>
                <Select value={selectedCycleId} onValueChange={setSelectedCycleId}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 h-10">
                    <SelectValue placeholder="Seleziona Ciclo" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    {cycles.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 font-semibold">Reparto (Destinazione)</Label>
                <Select value={selectedDept} onValueChange={setSelectedDept}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 h-10">
                    <SelectValue placeholder="Seleziona Reparto" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    {departments.filter(d => d.macroAreas?.includes('PRODUZIONE') || d.code === 'MAG').map(d => (
                      <SelectItem key={d.id} value={d.code || d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-amber-500 font-black uppercase text-[10px] tracking-widest">Data Fine Preparazione (Magazzino)</Label>
                <Input 
                  type="date"
                  value={dataPrep}
                  onChange={(e) => setDataPrep(e.target.value)}
                  className="bg-amber-500/5 border-amber-500/30 h-10 [color-scheme:dark] text-amber-500 font-bold shadow-[0_0_10px_rgba(245,158,11,0.05)]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-emerald-500 font-black uppercase text-[10px] tracking-widest">Data Consegna Finale (Cliente)</Label>
                <Input 
                  type="date"
                  value={dataConsegna}
                  onChange={(e) => setDataConsegna(e.target.value)}
                  className="bg-emerald-500/5 border-emerald-500/30 h-10 [color-scheme:dark] text-emerald-500 font-bold shadow-[0_0_10px_rgba(16,185,129,0.05)]"
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="p-6 bg-slate-900 border-t border-white/5 gap-3">
          <Button variant="ghost" onClick={onClose} disabled={loading} className="text-slate-400 hover:text-white hover:bg-white/5">
            Annulla
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={loading || !isFormValid}
            className="bg-primary hover:bg-primary/80 text-white min-w-[200px] gap-2 shadow-lg shadow-primary/20"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Crea Tutto & Avvia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

