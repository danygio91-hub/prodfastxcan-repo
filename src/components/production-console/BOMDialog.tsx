
"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { JobOrder, JobBillOfMaterialsItem, RawMaterial, MaterialConsumption } from '@/types';
import { ClipboardList, Check, Hourglass, Loader2, RefreshCcw } from 'lucide-react';
import { Badge } from '../ui/badge';
import { formatDisplayStock, cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { getRawMaterialsByCodes } from '@/app/admin/production-console/actions';
import { forceResetStuckMaterialSession } from '@/app/scan-job/actions';
import { calculateBOMRequirement } from '@/lib/inventory-utils';
import { useMasterData } from '@/contexts/MasterDataProvider';
import { useToast } from '@/hooks/use-toast';

interface BOMDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobOrder;
}

export default function BOMDialog({ isOpen, onOpenChange, job }: BOMDialogProps) {
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState<string | null>(null);
  const { globalSettings } = useMasterData();
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && job) {
      const bomCodes = (job.billOfMaterials || []).map(m => m.component);
      const consumedCodes = (job.phases || []).flatMap(p => (p.materialConsumptions || []).map(c => c.materialCode));
      const allCodes = Array.from(new Set([...bomCodes, ...consumedCodes])).filter(Boolean);
      
      if (allCodes.length > 0) {
        setIsLoading(true);
        getRawMaterialsByCodes(allCodes)
          .then(setMaterials)
          .finally(() => setIsLoading(false));
      }
    }
  }, [isOpen, job]);

  const materialsMap = useMemo(() => new Map(materials.map(m => [m.code, m])), [materials]);

  const withdrawnByComponent = useMemo(() => {
    const map = new Map<string, { units: number, hasActiveSession: boolean }>();
    (job?.phases || []).forEach(phase => {
      (phase.materialConsumptions || []).forEach(consumption => {
        const materialCode = consumption.materialCode;
        const material = materialsMap.get(materialCode);
        let unitsConsumed = 0;
        let isSessionActive = false;

        const isSessionClosed = consumption.grossOpeningWeight !== undefined && consumption.closingWeight !== undefined;
        const isImmediateWithdrawal = consumption.grossOpeningWeight === undefined && consumption.pcs !== undefined;
        const isOpenSession = consumption.grossOpeningWeight !== undefined && consumption.closingWeight === undefined;

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
        } else if (isOpenSession) {
          isSessionActive = true;
        }

        const current = map.get(materialCode) || { units: 0, hasActiveSession: false };
        map.set(materialCode, {
          units: current.units + unitsConsumed,
          hasActiveSession: current.hasActiveSession || isSessionActive
        });
      });
    });
    return map;
  }, [job?.phases, materialsMap]);

  const combinedBOM = useMemo(() => {
    const bom = job?.billOfMaterials || [];
    const bomMap = new Map<string, JobBillOfMaterialsItem>();

    bom.forEach(item => {
      bomMap.set(item.component, { ...item, isFromTemplate: true });
    });

    withdrawnByComponent.forEach((data, materialCode) => {
      const material = materialsMap.get(materialCode);
      if (!bomMap.has(materialCode) && (data.units > 0 || data.hasActiveSession)) {
        bomMap.set(materialCode, {
          component: materialCode,
          quantity: data.units,
          unit: material?.unitOfMeasure || 'n',
          status: 'withdrawn',
          isFromTemplate: false,
        });
      }
    });

    return Array.from(bomMap.values());
  }, [job?.billOfMaterials, materialsMap, withdrawnByComponent]);

  if (!job) return null;

  const handleResetSession = async (materialCode: string) => {
    setIsResetting(materialCode);
    const result = await forceResetStuckMaterialSession(job.id, materialCode);
    if (result.success) {
      toast({ title: "Sessione Resettata", description: `Il prelievo per ${materialCode} è stato sbloccato.` });
    } else {
      toast({ variant: "destructive", title: "Errore", description: result.message });
    }
    setIsResetting(null);
  };

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
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Caricamento componenti...</p>
          </div>
        ) : (
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
                  const withdrawData = withdrawnByComponent.get(item.component) || { units: 0, hasActiveSession: false };
                  const withdrawnQty = withdrawData.units;

                  let totalRequirement = 0;
                  let displayUnit = item.unit;
                  let estimatedWeight = 0;

                  if (material && globalSettings) {
                    const config = globalSettings.rawMaterialTypes.find(t => t.id === material.type) || { defaultUnit: material.unitOfMeasure };
                    
                    // Case for template items (standard BOM) or manual/consumed items
                    const calcQty = item.isFromTemplate ? job.qta : 1;
                    const calcBomItem = item.isFromTemplate ? item : { ...item, quantity: withdrawnQty || (withdrawData.hasActiveSession ? 0.001 : 0) };
                    
                    const req = calculateBOMRequirement(calcQty, calcBomItem as any, material, config as any);
                    
                    totalRequirement = req.totalInBaseUnits;
                    displayUnit = req.totalMeters !== undefined ? 'mt' : req.baseUnit;
                    estimatedWeight = req.weightKg;
                  } else {
                    // Fallback simpler math if settings/material not yet ready
                    totalRequirement = item.isFromTemplate ? item.quantity * job.qta : (withdrawnQty || 0);
                    displayUnit = item.unit;
                  }

                  const isFullyWithdrawn = totalRequirement > 0 && withdrawnQty >= totalRequirement - 0.001;
                  const stockAvailable = material?.currentStockUnits || 0;
                  const remainingRequirement = Math.max(0, totalRequirement - withdrawnQty);
                  const isAvailable = stockAvailable >= remainingRequirement - 0.001;

                  return (
                    <TableRow key={index} className={withdrawData.hasActiveSession ? "bg-blue-500/5" : ""}>
                      <TableCell className="font-medium">
                        {item.component}
                        {!item.isFromTemplate && <Badge variant="outline" className="ml-2">Manuale</Badge>}
                        {withdrawData.hasActiveSession && (
                          <div className="inline-flex items-center gap-1 ml-2">
                             <Badge variant="secondary" className="bg-blue-100 text-blue-700">In prelievo...</Badge>
                             <TooltipProvider>
                               <Tooltip>
                                 <TooltipTrigger asChild>
                                   <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-6 w-6 text-blue-600 hover:text-blue-800 hover:bg-blue-100"
                                    onClick={() => handleResetSession(item.component)}
                                    disabled={isResetting === item.component}
                                   >
                                      {isResetting === item.component ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
                                   </Button>
                                 </TooltipTrigger>
                                 <TooltipContent>Sblocca sessione appesa</TooltipContent>
                               </Tooltip>
                             </TooltipProvider>
                          </div>
                        )}
                      </TableCell>
                      {!isAggregatedView && <TableCell>{item.isFromTemplate ? item.quantity : '-'}</TableCell>}
                      <TableCell className="font-semibold">{formatDisplayStock(totalRequirement, displayUnit)}</TableCell>
                      <TableCell>{displayUnit}</TableCell>
                      <TableCell className="font-bold text-primary">{formatDisplayStock(estimatedWeight, 'kg')}</TableCell>
                      <TableCell className="text-center">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <div className="flex items-center justify-center">
                                {isFullyWithdrawn ? (
                                  <Check className="h-5 w-5 text-muted-foreground opacity-50" />
                                ) : (
                                  <Check className={cn("h-5 w-5", isAvailable ? "text-green-500" : "text-destructive")} />
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isFullyWithdrawn ? "Materiale già prelevato." :
                                isAvailable ? `Disponibile a magazzino.` :
                                  `Stock insufficiente! Disponibile: ${formatDisplayStock(stockAvailable, displayUnit)}, Richiesto: ${formatDisplayStock(remainingRequirement, displayUnit)}`
                              }
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="text-center">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              {withdrawData.hasActiveSession ? (
                                <Hourglass className="h-5 w-5 text-blue-500 animate-pulse mx-auto" />
                              ) : (
                                <Checkbox checked={isFullyWithdrawn || withdrawnQty > 0} disabled />
                              )}
                            </TooltipTrigger>
                            <TooltipContent>
                              {withdrawData.hasActiveSession ? "Sessione di prelievo attiva." :
                                isFullyWithdrawn ? `Prelevato: ${formatDisplayStock(withdrawnQty, displayUnit)}` :
                                  withdrawnQty > 0 ? `Parzialmente prelevato (${formatDisplayStock(withdrawnQty, displayUnit)})` :
                                    "Non ancora prelevato."
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
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Chiudi</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
