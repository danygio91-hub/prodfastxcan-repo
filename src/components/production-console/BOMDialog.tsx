

"use client";

import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { JobOrder, JobBillOfMaterialsItem, MaterialConsumption, RawMaterial } from '@/lib/mock-data';
import { ClipboardList } from 'lucide-react';
import { Badge } from '../ui/badge';
import { formatDisplayStock } from '@/lib/utils';

interface BOMDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobOrder;
  allRawMaterials: RawMaterial[];
}

export default function BOMDialog({ isOpen, onOpenChange, job, allRawMaterials }: BOMDialogProps) {
  if (!job) return null;

  const materialsMap = useMemo(() => new Map(allRawMaterials.map(m => [m.code, m])), [allRawMaterials]);
  const baseBOM = job.billOfMaterials || [];
  const baseBOMComponentCodes = new Set(baseBOM.map(item => item.component));
  const additionalConsumptions = new Map<string, { quantity: number }>();

  (job.phases || []).forEach(phase => {
    (phase.materialConsumptions || []).forEach(consumption => {
      if (!baseBOMComponentCodes.has(consumption.materialCode)) {
        const existing = additionalConsumptions.get(consumption.materialCode) || { quantity: 0 };
        existing.quantity += consumption.pcs || 0; 
        additionalConsumptions.set(consumption.materialCode, existing);
      }
    });
  });

  const additionalItems: JobBillOfMaterialsItem[] = [];
  additionalConsumptions.forEach((data, code) => {
    const material = materialsMap.get(code);
    if (data.quantity > 0) {
      additionalItems.push({
        component: code,
        quantity: data.quantity, // This is already the total quantity
        unit: material ? material.unitOfMeasure : 'n/d',
        status: 'withdrawn',
        isFromTemplate: false,
      });
    }
  });
      
  const combinedBOM = [...baseBOM, ...additionalItems];

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
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
                <TableHead>Q.tà x Pz</TableHead>
                <TableHead>Lungh. Taglio</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Fabbisogno Tot.</TableHead>
                <TableHead>UM</TableHead>
                <TableHead>Peso Stimato (KG)</TableHead>
                <TableHead>Impegnato</TableHead>
                <TableHead>Prelevato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {combinedBOM.length > 0 ? (
                combinedBOM.map((item, index) => {
                  const material = materialsMap.get(item.component);
                  let totalRequirement = 0;
                  let estimatedWeight = 0;
                  let displayUnit = item.unit;

                  if (item.isFromTemplate) {
                     // Case 1: Item is defined by a cut length. Fabbisogno is in meters.
                    if (item.lunghezzaTaglioMm && item.lunghezzaTaglioMm > 0) {
                        totalRequirement = (item.quantity * job.qta * item.lunghezzaTaglioMm) / 1000;
                        displayUnit = 'mt';

                        if (material && material.rapportoKgMt && material.rapportoKgMt > 0) {
                            estimatedWeight = totalRequirement * material.rapportoKgMt;
                        }

                    } else {
                        // Case 2: Item is defined by count or weight per piece.
                        totalRequirement = item.quantity * job.qta;
                        displayUnit = item.unit;
                        
                        if (material) {
                            if (material.unitOfMeasure === 'kg') {
                                estimatedWeight = totalRequirement;
                            } else if (material.conversionFactor && material.conversionFactor > 0) {
                                estimatedWeight = totalRequirement * material.conversionFactor;
                            }
                        }
                    }
                  } else {
                     // For additionally consumed items, quantity is already the total
                     totalRequirement = item.quantity;
                     displayUnit = item.unit;
                     if(material) {
                        if (material.unitOfMeasure === 'kg') {
                            estimatedWeight = totalRequirement;
                        } else if (material.conversionFactor && material.conversionFactor > 0) {
                            estimatedWeight = totalRequirement * material.conversionFactor;
                        }
                     }
                  }


                  return (
                    <TableRow key={index}>
                        <TableCell className="font-medium">
                            {item.component}
                            {!item.isFromTemplate && <Badge variant="outline" className="ml-2">Aggiunto</Badge>}
                        </TableCell>
                        <TableCell>{item.isFromTemplate ? item.quantity : '-'}</TableCell>
                        <TableCell>{item.lunghezzaTaglioMm ? `${item.lunghezzaTaglioMm} mm` : 'N/A'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.note || 'N/D'}</TableCell>
                        <TableCell className="font-semibold">{formatDisplayStock(totalRequirement, displayUnit as 'n' | 'mt' | 'kg')}</TableCell>
                        <TableCell>{displayUnit}</TableCell>
                        <TableCell>{formatDisplayStock(estimatedWeight, 'kg')}</TableCell>
                        <TableCell><Checkbox disabled /></TableCell>
                        <TableCell><Checkbox disabled /></TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-center h-24">
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
