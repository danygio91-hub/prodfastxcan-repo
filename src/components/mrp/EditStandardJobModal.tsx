'use client';

import React, { useState, useEffect, useTransition } from 'react';
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
  Pencil, Loader2, Save, X, Calendar, Lock
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { JobOrder, WorkCycle, Department } from '@/types';
import { format, parseISO } from 'date-fns';
import { MaskedDatePicker } from '@/components/ui/masked-date-picker';
import { updateJobOrder } from '@/app/admin/data-management/actions';
import { useRouter } from 'next/navigation';

interface EditStandardJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: JobOrder | null;
  workCycles: WorkCycle[];
  departments: Department[];
}

export function EditStandardJobModal({ isOpen, onClose, job, workCycles, departments }: EditStandardJobModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  
  // Form State
  const [cliente, setCliente] = useState('');
  const [ordinePF, setOrdinePF] = useState('');
  const [qta, setQta] = useState('1');
  const [dataConsegna, setDataConsegna] = useState('');
  const [dataPrep, setDataPrep] = useState('');
  const [selectedCycleId, setSelectedCycleId] = useState('');
  const [selectedDept, setSelectedDept] = useState('');

  useEffect(() => {
    if (job && isOpen) {
      setCliente(job.cliente || '');
      setOrdinePF(job.ordinePF || '');
      setQta(job.qta?.toString() || '1');
      setDataConsegna(job.dataConsegnaFinale || '');
      setDataPrep(job.dataFinePreparazione || '');
      setSelectedCycleId(job.workCycleId || '');
      setSelectedDept(job.department || '');
    }
  }, [job, isOpen]);

  const handleSave = async () => {
    if (!job) return;
    if (!cliente.trim() || !ordinePF.trim() || !qta || !selectedCycleId) {
      toast({ variant: "destructive", title: "Dati mancanti", description: "Compila tutti i campi obbligatori." });
      return;
    }

    setLoading(true);
    try {
      const res = await updateJobOrder(job.id, {
        cliente,
        ordinePF,
        qta: Number(qta),
        department: selectedDept,
        workCycleId: selectedCycleId,
        dataFinePreparazione: dataPrep,
        dataConsegnaFinale: dataConsegna
      });

      if (res.success) {
        toast({ title: "Successo", description: res.message });
        startTransition(() => {
          onClose();
          router.refresh();
        });
      } else {
        toast({ variant: "destructive", title: "Errore", description: res.message });
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Errore", description: "Impossibile aggiornare la commessa." });
    } finally {
      setLoading(false);
    }
  };

  if (!job) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-slate-900 border-slate-800 text-white shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Pencil className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">Modifica Commessa</DialogTitle>
              <DialogDescription className="text-slate-400">Aggiorna i dettagli della commessa esistente.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Article Lock Section */}
          <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Lock className="h-4 w-4 text-amber-500" />
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Articolo (Sola Lettura)</p>
                <p className="text-sm font-mono font-bold text-blue-400">{job.details}</p>
              </div>
            </div>
            <div className="text-[9px] bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20 font-bold">LOCKED</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-slate-400">Cliente</Label>
              <Input 
                value={cliente} 
                onChange={(e) => setCliente(e.target.value)} 
                className="bg-slate-800 border-slate-700 focus:border-blue-500 h-10"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-slate-400">Ordine PF</Label>
              <Input 
                value={ordinePF} 
                onChange={(e) => setOrdinePF(e.target.value)} 
                className="bg-slate-800 border-slate-700 focus:border-blue-500 h-10"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-amber-500 font-black uppercase text-[10px] tracking-widest">Fine Prep. (Magazzino)</Label>
              <MaskedDatePicker 
                value={dataPrep ? parseISO(dataPrep) : null} 
                onChange={(date) => setDataPrep(date ? format(date, 'yyyy-MM-dd') : '')} 
                className="border-amber-500/30 focus:border-amber-500 bg-amber-500/5"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-emerald-500 font-black uppercase text-[10px] tracking-widest">Consegna Finale (Cliente)</Label>
              <MaskedDatePicker 
                value={dataConsegna ? parseISO(dataConsegna) : null} 
                onChange={(date) => setDataConsegna(date ? format(date, 'yyyy-MM-dd') : '')} 
                className="border-emerald-500/30 focus:border-emerald-500 bg-emerald-500/5"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-xs text-slate-400">Quantità</Label>
              <Input 
                type="number" 
                value={qta} 
                onChange={(e) => setQta(e.target.value)} 
                className="bg-slate-800 border-slate-700 h-10"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-slate-400">Reparto</Label>
              <Select onValueChange={setSelectedDept} value={selectedDept}>
                <SelectTrigger className="bg-slate-800 border-slate-700 h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {departments.map(d => (
                    <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-slate-400">Ciclo di Lavoro</Label>
            <Select onValueChange={setSelectedCycleId} value={selectedCycleId}>
              <SelectTrigger className="bg-slate-800 border-blue-500/20 bg-blue-500/5 h-10">
                <SelectValue placeholder="Seleziona..." />
              </SelectTrigger>
              <SelectContent>
                {workCycles.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading} className="text-slate-400 hover:text-white">Annulla</Button>
          <Button onClick={handleSave} disabled={loading} className="bg-blue-600 hover:bg-blue-500 text-white gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salva Modifiche
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
