"use client";

import React, { useState, useEffect } from 'react';
import { format, addDays, startOfWeek, isSameDay, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { 
  Users, 
  Save, 
  X, 
  Check, 
  ArrowRightLeft, 
  ChevronRight, 
  Calendar as CalendarIcon,
  UserPlus,
  Trash2,
  Copy,
  Zap
} from 'lucide-react';

import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { type Operator, type Department, type OperatorAssignment } from '@/types';
import { bulkSaveOperatorAssignments } from './actions';

interface ResourceAssignmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  operators: Operator[];
  departments: Department[];
  initialAssignments: OperatorAssignment[];
  currentDate: Date;
  uid: string;
}

export default function ResourceAssignmentDialog({
  isOpen,
  onClose,
  operators,
  departments,
  initialAssignments,
  currentDate,
  uid
}: ResourceAssignmentDialogProps) {
  const [localAssignments, setLocalAssignments] = useState<Record<string, Record<string, string>>>({});
  const [selectedOperators, setSelectedOperators] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const startOfSelectedWeek = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 5 }).map((_, i) => addDays(startOfSelectedWeek, i));

  // Filter allowed departments for assignment
  const allowedDeptCodes = ['CG', 'CP', 'BF', 'SUPPORT'];
  const filteredDepartments = departments.filter(d => allowedDeptCodes.includes(d.code));

  // Initialize local state from initialAssignments
  useEffect(() => {
    if (isOpen) {
      const state: Record<string, Record<string, string>> = {};
      
      operators.forEach(op => {
        state[op.id] = {};
        weekDays.forEach(day => {
          const ds = format(day, 'yyyy-MM-dd');
          const existing = initialAssignments.find(a => 
            a.operatorId === op.id && 
            ds >= a.startDate && 
            ds <= a.endDate
          );
          state[op.id][ds] = existing?.departmentCode || 'none';
        });
      });
      
      setLocalAssignments(state);
      setSelectedOperators([]);
    }
  }, [isOpen, initialAssignments, operators, currentDate]);

  const handleCellChange = (operatorId: string, dateStr: string, deptCode: string) => {
    setLocalAssignments(prev => ({
      ...prev,
      [operatorId]: {
        ...prev[operatorId],
        [dateStr]: deptCode
      }
    }));
  };

  const handleRowBulkAssign = (operatorId: string, deptCode: string) => {
    setLocalAssignments(prev => {
      const newOpState = { ...prev[operatorId] };
      weekDays.forEach(day => {
        newOpState[format(day, 'yyyy-MM-dd')] = deptCode;
      });
      return { ...prev, [operatorId]: newOpState };
    });
  };

  const handleSelectionBulkAssign = (deptCode: string) => {
    if (selectedOperators.length === 0) return;
    
    setLocalAssignments(prev => {
      const newState = { ...prev };
      selectedOperators.forEach(opId => {
        const newOpState = { ...newState[opId] };
        weekDays.forEach(day => {
          newOpState[format(day, 'yyyy-MM-dd')] = deptCode;
        });
        newState[opId] = newOpState;
      });
      return newState;
    });
    
    toast({
      title: "Assegnazione completata",
      description: `Assegnati ${selectedOperators.length} operatori ${deptCode === 'none' ? 'alla rimozione assegnazione' : 'al reparto ' + deptCode} per tutta la settimana.`
    });
  };

  const toggleOperatorSelection = (opId: string) => {
    setSelectedOperators(prev => 
      prev.includes(opId) ? prev.filter(id => id !== opId) : [...prev, opId]
    );
  };

  const toggleAllSelection = () => {
    setSelectedOperators(prev => 
      prev.length === operators.length ? [] : operators.map(op => op.id)
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const assignmentsToSave: Omit<OperatorAssignment, 'id' | 'createdAt'>[] = [];
      
      // Group contiguous days for the same operator and department to minimize documents
      operators.forEach(op => {
        const opDays = localAssignments[op.id];
        if (!opDays) return;

        let currentDept = '';
        let currentStart = '';
        let currentEnd = '';

        weekDays.forEach((day, index) => {
          const ds = format(day, 'yyyy-MM-dd');
          let dept = opDays[ds];
          if (dept === 'none') dept = ''; // Convert back for storage

          if (dept !== currentDept) {
            // Push previous range if exists
            if (currentDept) {
              assignmentsToSave.push({
                operatorId: op.id,
                departmentCode: currentDept,
                startDate: currentStart,
                endDate: currentEnd,
                type: op.reparto?.includes(currentDept) ? 'base' : 'loan'
              });
            }
            // Start new range
            currentDept = dept;
            currentStart = ds;
            currentEnd = ds;
          } else {
            // Extend existing range
            currentEnd = ds;
          }

          // Final day handler
          if (index === weekDays.length - 1 && currentDept) {
            assignmentsToSave.push({
              operatorId: op.id,
              departmentCode: currentDept,
              startDate: currentStart,
              endDate: currentEnd,
              type: op.reparto?.includes(currentDept) ? 'base' : 'loan'
            });
          }
        });
      });

      const res = await bulkSaveOperatorAssignments(
        assignmentsToSave, 
        format(weekDays[0], 'yyyy-MM-dd'), 
        format(weekDays[weekDays.length - 1], 'yyyy-MM-dd'),
        uid
      );

      if (res.success) {
        toast({ title: "Salvataggio completato", description: res.message });
        onClose();
      } else {
        toast({ variant: "destructive", title: "Errore", description: res.message });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Errore", description: "Impossibile salvare le assegnazioni." });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-[#0a0e14] border-slate-800 text-slate-200">
        <DialogHeader className="p-6 pb-2 border-b border-slate-800">
          <div className="flex justify-between items-center">
            <div>
              <DialogTitle className="text-xl flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-400" />
                Assegnazione Risorse Settimanale
              </DialogTitle>
              <DialogDescription className="text-slate-400 mt-1">
                Settimana dal {format(weekDays[0], 'd MMMM', { locale: it })} al {format(weekDays[4], 'd MMMM yyyy', { locale: it })}
              </DialogDescription>
            </div>
            
            <div className="flex items-center gap-3">
               {selectedOperators.length > 0 && (
                 <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/30 px-3 py-1.5 rounded-lg animate-in fade-in slide-in-from-right-2">
                    <span className="text-xs font-semibold text-blue-400">{selectedOperators.length} selezionati</span>
                    <div className="h-4 w-px bg-blue-500/30 mx-1" />
                    <Select onValueChange={handleSelectionBulkAssign}>
                      <SelectTrigger className="h-7 w-40 bg-transparent border-none focus:ring-0 text-xs text-blue-300">
                        <Zap className="h-3 w-3 mr-1" />
                        <SelectValue placeholder="Assegna a tutti..." />
                      </SelectTrigger>
                      <SelectContent className="bg-[#151c27] border-slate-700">
                        {filteredDepartments.map(d => (
                          <SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>
                        ))}
                        <SelectItem value="none">Senza Assegnazione</SelectItem>
                      </SelectContent>
                    </Select>
                 </div>
               )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-[#0a0e14] z-10 shadow-sm">
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="w-12 text-center">
                  <Checkbox 
                    checked={selectedOperators.length === operators.length && operators.length > 0}
                    onCheckedChange={toggleAllSelection}
                  />
                </TableHead>
                <TableHead className="w-48 text-slate-400 italic font-normal">Operatore</TableHead>
                {weekDays.map(day => (
                  <TableHead key={day.toISOString()} className="text-center w-32 border-l border-slate-800 pb-1">
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">{format(day, 'EEEE', { locale: it })}</span>
                      <span className="text-sm font-bold text-slate-300">{format(day, 'd MMM', { locale: it })}</span>
                    </div>
                  </TableHead>
                ))}
                <TableHead className="w-24 text-center border-l border-slate-800 text-slate-500 font-normal">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operators.map((op) => (
                <TableRow key={op.id} className="border-slate-900 hover:bg-white/5 transition-colors">
                  <TableCell className="text-center">
                    <Checkbox 
                      checked={selectedOperators.includes(op.id)}
                      onCheckedChange={() => toggleOperatorSelection(op.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium py-4">
                    <div className="flex flex-col">
                       <span className={selectedOperators.includes(op.id) ? "text-blue-400" : ""}>{op.nome}</span>
                       <div className="flex gap-1 mt-1">
                          {op.reparto?.map(r => (
                            <span key={r} className="text-[9px] px-1 bg-slate-800 text-slate-400 rounded uppercase">{r}</span>
                          ))}
                       </div>
                    </div>
                  </TableCell>
                  {weekDays.map(day => {
                    const ds = format(day, 'yyyy-MM-dd');
                    const currentVal = localAssignments[op.id]?.[ds] || 'none';
                    const isLoan = currentVal !== 'none' && currentVal !== '' && !op.reparto?.includes(currentVal);

                    return (
                      <TableCell key={ds} className="p-1 border-l border-slate-900">
                        <Select 
                          value={currentVal} 
                          onValueChange={(v) => handleCellChange(op.id, ds, v)}
                        >
                          <SelectTrigger className={cn(
                            "h-9 w-full bg-slate-900/50 border-none focus:ring-1 focus:ring-blue-500/50 text-xs",
                            isLoan ? "text-amber-400 font-semibold" : "text-slate-300"
                          )}>
                            <SelectValue placeholder="-" />
                          </SelectTrigger>
                          <SelectContent className="bg-[#151c27] border-slate-700">
                          {filteredDepartments.map(d => (
                              <SelectItem key={d.code} value={d.code}>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold w-6">{d.code}</span>
                                  <span className="text-xs opacity-60">{d.name}</span>
                                </div>
                              </SelectItem>
                            ))}
                            <SelectItem value="none">Nessuno</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center border-l border-slate-900 p-2">
                    <div className="flex justify-center gap-1">
                      <Select onValueChange={(v) => handleRowBulkAssign(op.id, v)}>
                        <SelectTrigger className="h-8 w-8 p-0 flex items-center justify-center bg-slate-800 border-none hover:bg-slate-700">
                          <Zap className="h-4 w-4 text-blue-400" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#151c27] border-slate-700">
                          <div className="px-2 py-1 text-[10px] text-slate-500 uppercase">Imposta tutta la settimana</div>
                          {filteredDepartments.map(d => (
                            <SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>
                          ))}
                          <SelectItem value="none">Svuota Settimana</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="p-6 border-t border-slate-800 bg-slate-900/20">
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>Annulla</Button>
          <Button 
            className="bg-blue-600 hover:bg-blue-700 px-8" 
            onClick={handleSave} 
            disabled={isSaving}
          >
            {isSaving ? (
              <span className="flex items-center gap-2 italic text-blue-200">
                <Zap className="h-4 w-4 animate-spin" />
                Salvataggio...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Save className="h-4 w-4" />
                Salva Assegnazioni
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
