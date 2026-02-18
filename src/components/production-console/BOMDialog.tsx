"use client";

import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { JobOrder, JobBillOfMaterialsItem, RawMaterial } from '@/lib/mock-data';
import { ClipboardList, Check } from 'lucide-react';
import { Badge } from '../ui/badge';
import { formatDisplayStock } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { cn } from '@/lib/utils';

interface BOMDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobOrder;
  allRawMaterials: RawMaterial[];
}

export default function BOMDialog({ isOpen, onOpenChange, job, allRawMaterials }: BOMDialogProps) {
  if (!job) return null;

  const materialsMap = useMemo(() => new Map(allRawMaterials.map(m => [m.code, m])), [allRawMaterials]);
  
  const withdrawnByComponent = useMemo(() => {
    const map = new Map<string, number>();
    (job.phases || []).forEach(phase => {
      (phase.materialConsumptions || []).forEach(consumption => {
        const materialCode = consumption.materialCode;
        const material = materialsMap.get(materialCode);
        let unitsConsumed = 0;

        const isSessionClosed = consumption.grossOpeningWeight !== undefined && consumption.closingWeight !== undefined;
        const isImmediateWithdrawal = consumption.grossOpeningWeight === undefined && consumption.pcs !== undefined;

        if (isSessionClosed) {
          const consumedWeight = (consumption.grossOpeningWeight || 0) - (consumption.closingWeight || 0);
          if (material) {
            if (material.unitOfMeasure === 'kg') {
              unitsConsumed = consumedWeight;
            } else if (material.conversionFactor && material.conversionFactor > 0) {
              unitsConsumed = consumedWeight / material.conversionFactor;
            }
          }
        } else if (isImmediateWithdrawal) {
          unitsConsumed = consumption.pcs || 0;
        }
        
        const current = map.get(materialCode) || 0;
        map.set(materialCode, current + unitsConsumed);
      });
    });
    return map;
  }, [job.phases, materialsMap]);

  const combinedBOM = useMemo(() => {
    const bom = job.billOfMaterials || [];
    const bomMap = new Map<string, JobBillOfMaterialsItem>();
    
    // Add items from the template first
    bom.forEach(item => {
      bomMap.set(item.component, { ...item, isFromTemplate: true });
    });

    // Add consumed items that might not be in the template
    (job.phases || []).forEach(phase => {
      (phase.materialConsumptions || []).forEach(consumption => {
        const material = materialsMap.get(consumption.materialCode);
        const withdrawnQtyForThisMaterial = withdrawnByComponent.get(consumption.materialCode) || 0;

        if (!bomMap.has(consumption.materialCode) && withdrawnQtyForThisMaterial > 0) {
          bomMap.set(consumption.materialCode, {
            component: consumption.materialCode,
            quantity: 0,
            unit: material?.unitOfMeasure || 'n',
            status: 'withdrawn',
            isFromTemplate: false,
          });
        }
      });
    });

    return Array.from(bomMap.values());
  }, [job.billOfMaterials, job.phases, materialsMap, withdrawnByComponent]);
  
  const isAggregatedView = job.id.startsWith('group-');

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            {isAggregatedView ? `Distinta Base Aggregata per Gruppo ${job.id}` : `Distinta Base per ${job.ordinePF}`}
          </DialogTitle>
          <DialogDescription>
             {isAggregatedView 
              ? `Componenti totali necessari per la produzione di ${job.qta} pz di ${job.details} (tutte le commesse).`
              : `Componenti necessari per la produzione di ${job.qta} pz di ${job.details}.`
            }
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Componente</TableHead>
                {!isAggregatedView && <TableHead>Q.tà x Pz</TableHead>}
                <TableHead>Fabbisogno Tot.</TableHead>
                <TableHead>UM</TableHead>
                <TableHead>Peso Stimato (KG)</TableHead>
                <TableHead>Disponibilità</TableHead>
                <TableHead>Prelevato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {combinedBOM.length > 0 ? (
                combinedBOM.map((item, index) => {
                  const material = materialsMap.get(item.component);
                  const withdrawnQty = withdrawnByComponent.get(item.component) || 0;
                  let totalRequirement = 0;
                  let displayUnit = item.unit;

                  if (item.isFromTemplate) {
                      if (item.lunghezzaTaglioMm && item.lunghezzaTaglioMm > 0) {
                          totalRequirement = (item.quantity * job.qta * item.lunghezzaTaglioMm) / 1000;
                          displayUnit = 'mt';
                      } else {
                          totalRequirement = item.quantity * job.qta;
                          displayUnit = item.unit;
                      }
                  } else if ((item as any).isAggregated) {
                      totalRequirement = item.quantity;
                      displayUnit = item.unit;
                  } else {
                      totalRequirement = withdrawnQty;
                      displayUnit = material?.unitOfMeasure || 'n';
                  }

                  let estimatedWeight = 0;
                   if (material) {
                      if (displayUnit === 'mt' && material.rapportoKgMt && material.rapportoKgMt > 0) {
                          estimatedWeight = totalRequirement * material.rapportoKgMt;
                      } else if (material.unitOfMeasure === 'kg') {
                          estimatedWeight = totalRequirement;
                      } else if (material.conversionFactor && material.conversionFactor > 0) {
                          estimatedWeight = totalRequirement * material.conversionFactor;
                      }
                  }

                  const isFullyWithdrawn = totalRequirement > 0 && withdrawnQty >= totalRequirement - 0.001;
                  const stockAvailable = material?.currentStockUnits || 0;
                  const remainingRequirement = totalRequirement - withdrawnQty;
                  const isAvailable = stockAvailable >= remainingRequirement;

                  return (
                    <TableRow key={index}>
                        <TableCell className="font-medium">
                            {item.component}
                            {!item.isFromTemplate && !isAggregatedView && !((item as any).isAggregated) && <Badge variant="outline" className="ml-2">Aggiunto</Badge>}
                        </TableCell>
                        {!isAggregatedView && <TableCell>{item.isFromTemplate ? item.quantity : '-'}</TableCell>}
                        <TableCell className="font-semibold">{formatDisplayStock(totalRequirement, displayUnit as 'n' | 'mt' | 'kg')}</TableCell>
                        <TableCell>{displayUnit}</TableCell>
                        <TableCell>{formatDisplayStock(estimatedWeight, 'kg')}</TableCell>
                        <TableCell className="text-center">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <div className="flex items-center justify-center">
                                            {isFullyWithdrawn ? (
                                                <Check className="h-5 w-5 text-muted-foreground" />
                                            ) : (
                                                <Check className={cn("h-5 w-5", isAvailable ? "text-green-500" : "text-destructive")} />
                                            )}
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {isFullyWithdrawn ? "Materiale completamente prelevato." :
                                        isAvailable ? `Disponibile a magazzino.` :
                                        `Stock insufficiente! Disponibile: ${formatDisplayStock(stockAvailable, displayUnit as 'n'|'mt'|'kg')}, Richiesto ancora: ${formatDisplayStock(remainingRequirement, displayUnit as 'n'|'mt'|'kg')}`
                                        }
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </TableCell>
                        <TableCell className="text-center">
                             <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <Checkbox checked={isFullyWithdrawn} disabled />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {isFullyWithdrawn ?
                                            `Completamente prelevato (${formatDisplayStock(withdrawnQty, displayUnit as 'n'|'mt'|'kg')})` :
                                            `Parzialmente/Non prelevato (Prelevato: ${formatDisplayStock(withdrawnQty, displayUnit as 'n'|'mt'|'kg')})`
                                        }
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-24">
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