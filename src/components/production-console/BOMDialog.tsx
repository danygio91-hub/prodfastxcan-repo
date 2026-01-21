
"use client";

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { JobOrder, JobBillOfMaterialsItem, MaterialConsumption } from '@/lib/mock-data';
import { ClipboardList } from 'lucide-react';
import { Badge } from '../ui/badge';

interface BOMDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobOrder;
}

export default function BOMDialog({ isOpen, onOpenChange, job }: BOMDialogProps) {
  if (!job) return null;

  const baseBOM = job.billOfMaterials || [];
  const baseBOMComponentCodes = new Set(baseBOM.map(item => item.component));

  const additionalConsumptions = new Map<string, { quantity: number }>();

  (job.phases || []).forEach(phase => {
    (phase.materialConsumptions || []).forEach(consumption => {
      if (!baseBOMComponentCodes.has(consumption.materialCode)) {
        const existing = additionalConsumptions.get(consumption.materialCode) || { quantity: 0 };
        // We sum 'pcs' if available, as it represents a direct unit consumption.
        // This is a simplification and might need refinement if weight-based additional consumptions are a case.
        existing.quantity += consumption.pcs || 0; 
        additionalConsumptions.set(consumption.materialCode, existing);
      }
    });
  });

  const additionalItems: JobBillOfMaterialsItem[] = [];
  additionalConsumptions.forEach((data, code) => {
    if (data.quantity > 0) {
      additionalItems.push({
        component: code,
        quantity: data.quantity,
        unit: 'n/d', // Unit is not available on consumption records, marked as Not/Available
        status: 'withdrawn',
        isFromTemplate: false,
      });
    }
  });
      
  const combinedBOM = [...baseBOM, ...additionalItems];

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            Distinta Base per {job.ordinePF}
          </DialogTitle>
          <DialogDescription>
            Componenti necessari per la produzione di {job.qta} pz di <span className="font-semibold">{job.details}</span>.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Componente</TableHead>
                <TableHead className="w-[120px]">Q.tà Necessaria</TableHead>
                <TableHead className="w-[80px]">UM</TableHead>
                <TableHead className="w-[100px]">Impegnato</TableHead>
                <TableHead className="w-[100px]">Prelevato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {combinedBOM.length > 0 ? (
                combinedBOM.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">
                        {item.component} {item.size ? `(${item.size})` : ''}
                        {!item.isFromTemplate && <Badge variant="outline" className="ml-2">Aggiunto</Badge>}
                    </TableCell>
                    <TableCell>{item.quantity % 1 !== 0 ? item.quantity.toFixed(2) : item.quantity}</TableCell>
                    <TableCell>{item.unit}</TableCell>
                    <TableCell><Checkbox disabled /></TableCell>
                    <TableCell><Checkbox disabled /></TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24">
                    Nessuna distinta base definita per questo articolo.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Chiudi</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
