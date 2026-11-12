import { useState, useCallback, useEffect, useRef } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { findLastWeightForLotto, getLotInfoForMaterial } from '@/app/scan-job/actions';
import { extractHydratedLots, normStockLot, type HydratedLotInfo } from '@/lib/stock-logic';
import type { RawMaterial } from '@/types';

interface UseBatchSelectionProps {
  form: UseFormReturn<any>;
  materialId: string | undefined;
  hydratedMaterial?: RawMaterial | null;
  selectedTareKg?: number;
  onLotMetadataFound?: (metadata: any) => void;
  quantityFieldName?: string;
  packagingFieldName?: string;
  autoFillQuantity?: boolean;
}

export function useBatchSelection({
  form,
  materialId,
  hydratedMaterial,
  selectedTareKg,
  onLotMetadataFound,
  quantityFieldName = 'quantity',
  packagingFieldName = 'packagingId',
  autoFillQuantity = true
}: UseBatchSelectionProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [lotAvailability, setLotAvailability] = useState<HydratedLotInfo | null>(null);
  const [isFixedTare, setIsFixedTare] = useState(false);
  const [calculatedNet, setCalculatedNet] = useState<number>(0);
  const [batchMetadata, setBatchMetadata] = useState<any>(null);
  const [isLottoLocked, setIsLottoLocked] = useState(false);
  const isLottoVerified = !!lotAvailability;
  const lastFetchedKeyRef = useRef<string>('');

  const lottoValue = form.watch('lotto');
  const currentGross = form.watch(quantityFieldName);

  // Sincronizza immediatamente lotAvailability quando cambia hydratedMaterial in memoria (es. dopo scarico parziale)
  useEffect(() => {
    if (!hydratedMaterial || !lottoValue) return;
    const lots = extractHydratedLots(hydratedMaterial);
    const targetNorm = normStockLot(lottoValue);
    const matched = lots.find((l) => normStockLot(l.lotto) === targetNorm) || null;
    setLotAvailability(matched);
    if (!matched) {
      // Lotto esaurito: aggiorna residuo disponibile a 0 se era stato verificato per questo materiale
      setLotAvailability((prev) =>
        prev && normStockLot(prev.lotto) === targetNorm
          ? { ...prev, available: 0, availableWeightKg: 0, batches: [] }
          : null
      );
    }
  }, [hydratedMaterial, lottoValue]);

  const updateBatchInfo = useCallback(async (lotto: string) => {
    if (!materialId || !lotto) return;
    const cleanLotto = lotto.trim();
    if (!cleanLotto) return;
    const targetNorm = normStockLot(cleanLotto);
    lastFetchedKeyRef.current = `${materialId}::${targetNorm}`;

    setIsLoading(true);
    try {
      const [lottoData, lots] = await Promise.all([
        findLastWeightForLotto(materialId, cleanLotto),
        getLotInfoForMaterial(materialId)
      ]);

      const matched = lots.find(l => normStockLot(l.lotto) === targetNorm) || null;
      setLotAvailability(matched);
      setBatchMetadata(lottoData);

      // Blocca il campo di testo dopo riconoscimento automatico/da lista (sbloccabile col tasto modifica)
      if (matched || lottoData) {
        setIsLottoLocked(true);
      }

      if (lottoData) {
        // Auto-fill Tara
        const pkgId = lottoData.packagingId || 'none';
        form.setValue(packagingFieldName, pkgId);
        setIsFixedTare(pkgId !== 'none');

        // Calcolo Lordo Atteso basato esclusivamente sul peso residuo idratato SSoT
        const tare = lottoData.tareWeight || 0;
        const netKg = lottoData.netWeight ?? matched?.availableWeightKg ?? 0;
        const expectedGross = netKg + tare;
        
        if (autoFillQuantity) {
          form.setValue(quantityFieldName, Number(expectedGross.toFixed(3)));
        } else {
          // TASSATIVO: Campo vuoto per flussi manuali (Flow B)
          form.setValue(quantityFieldName, null);
        }
        setCalculatedNet(matched?.available ?? netKg);

        if (onLotMetadataFound) onLotMetadataFound(lottoData);
      } else {
        setIsFixedTare(false);
        setBatchMetadata(null);
        if (!autoFillQuantity) form.setValue(quantityFieldName, null);
      }
    } catch (error) {
      console.error("Error updating batch info:", error);
    } finally {
      setIsLoading(false);
    }
  }, [materialId, form, packagingFieldName, quantityFieldName, onLotMetadataFound, autoFillQuantity]);

  // Handle lotto changes (debounced): aggiorna sempre quando cambia il lotto selezionato o digitato
  useEffect(() => {
    const clean = (lottoValue || '').trim();
    if (!clean) {
      lastFetchedKeyRef.current = '';
      setLotAvailability(null);
      setIsFixedTare(false);
      setBatchMetadata(null);
      setIsLottoLocked(false);
      return;
    }

    if (clean.length >= 2 && materialId) {
      const fetchKey = `${materialId}::${normStockLot(clean)}`;
      if (lastFetchedKeyRef.current === fetchKey) return;

      const timer = setTimeout(() => {
        updateBatchInfo(clean);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [lottoValue, materialId, updateBatchInfo]);

  // Real-time calculation of Net based on Gross input e tara corrente
  useEffect(() => {
    const tare = selectedTareKg ?? batchMetadata?.tareWeight ?? 0;
    const material = hydratedMaterial || batchMetadata?.material;
    const gross = Number(currentGross) || 0;

    if (material) {
      const netWeightKg = Math.max(0, gross - tare);
      const uom = material.unitOfMeasure?.toLowerCase();
      if (uom === 'n') {
        const factor = material.conversionFactor || 1;
        setCalculatedNet(Math.round(netWeightKg / factor));
      } else if (uom === 'mt') {
        const factor = material.rapportoKgMt || 1;
        setCalculatedNet(Number((netWeightKg / factor).toFixed(3)));
      } else {
        setCalculatedNet(Number(netWeightKg.toFixed(3)));
      }
    } else if (lotAvailability) {
      const uom = lotAvailability.unit?.toLowerCase();
      if (uom === 'n') {
        setCalculatedNet(Math.round(gross));
      } else {
        setCalculatedNet(Number(gross.toFixed(3)));
      }
    } else {
      setCalculatedNet(0);
    }
  }, [currentGross, batchMetadata, lotAvailability, hydratedMaterial, selectedTareKg]);

  return {
    isLoading,
    lotAvailability,
    isLottoLocked,
    setIsLottoLocked,
    isLottoVerified,
    isFixedTare,
    calculatedNet,
    batchMetadata,
    updateBatchInfo
  };
}
