
"use client";

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, UserCheck, UserX, AlertCircle } from 'lucide-react';
import { getOperators } from '@/app/admin/operator-management/actions';
import { bulkDeclareAttendance } from '@/app/admin/attendance-calendar/actions';
import type { Operator } from '@/lib/mock-data';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface OperatorStatus {
  operatorId: string;
  operatorName: string;
  isPresent: boolean;
  reason?: string;
}

interface DailyAttendanceModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  uid: string;
  onDeclared: () => void;
}

export function DailyAttendanceModal({ isOpen, onOpenChange, uid, onDeclared }: DailyAttendanceModalProps) {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [statuses, setStatuses] = useState<OperatorStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    if (isOpen) {
      loadOperators();
    }
  }, [isOpen]);

  const loadOperators = async () => {
    setIsLoading(true);
    try {
      const allOps = await getOperators();
      // Only "real" operators and supervisors
      const realOps = allOps.filter(op => op.isReal !== false && (op.role === 'operator' || op.role === 'supervisor'));
      setOperators(realOps);
      setStatuses(realOps.map(op => ({
        operatorId: op.id,
        operatorName: op.nome,
        isPresent: true,
        reason: 'vacation'
      })));
    } catch (error) {
      toast({ variant: 'destructive', title: 'Errore', description: 'Impossibile caricare gli operatori.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = (id: string, present: boolean) => {
    setStatuses(prev => prev.map(s => s.operatorId === id ? { ...s, isPresent: present } : s));
  };

  const handleReasonChange = (id: string, reason: string) => {
    setStatuses(prev => prev.map(s => s.operatorId === id ? { ...s, reason } : s));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const res = await bulkDeclareAttendance(today, uid, statuses);
    if (res.success) {
      toast({ title: 'Successo', description: 'Presenze di oggi dichiarate correttamente.' });
      onDeclared();
      onOpenChange(false);
    } else {
      toast({ variant: 'destructive', title: 'Errore', description: res.message });
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Dichiarazione Presenze Giornaliera</DialogTitle>
          <DialogDescription>
            Conferma chi è presente oggi ({format(new Date(), 'dd/MM/yyyy')}). Per gli assenti, indica il motivo.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
            {statuses.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground italic">
                Nessun operatore reale configurato.
              </div>
            ) : (
              statuses.map((status) => (
                <div key={status.operatorId} className="flex flex-col gap-2 p-3 border rounded-lg bg-muted/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {status.isPresent ? (
                        <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                          <UserCheck className="h-4 w-4 text-green-600" />
                        </div>
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center">
                          <UserX className="h-4 w-4 text-destructive" />
                        </div>
                      )}
                      <span className="font-semibold text-sm">{status.operatorName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground">
                            {status.isPresent ? "Presente" : "Assente"}
                        </span>
                        <Switch 
                            checked={status.isPresent} 
                            onCheckedChange={(val) => handleToggle(status.operatorId, val)}
                        />
                    </div>
                  </div>
                  
                  {!status.isPresent && (
                    <div className="flex items-center gap-2 mt-1 animate-in fade-in slide-in-from-top-1 px-1">
                        <span className="text-xs text-muted-foreground min-w-[50px]">Motivo:</span>
                        <Select value={status.reason} onValueChange={(val) => handleReasonChange(status.operatorId, val)}>
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="vacation">Ferie / Permesso</SelectItem>
                                <SelectItem value="sick">Malattia / Mutua</SelectItem>
                                <SelectItem value="other">Altro / Chiusura</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Annulla
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || isSubmitting || statuses.length === 0} className="bg-primary text-primary-foreground">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Conferma Foglio Presenze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
