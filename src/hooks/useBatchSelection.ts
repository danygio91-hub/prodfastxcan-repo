import { useState, useCallback, useEffect } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { findLastWeightForLotto } from '@/app/scan-job/actions';
import { getLotInfoForMaterial, type LotInfo } from '@/app/admin/raw-material-management/actions';

interface UseBatchSelectionProps {
  form: UseFormReturn<any>;
  materialId: string | undefined;
  onLotMetadataFound?: (metadata: any) => void;
  quantityFieldName?: string;
  packagingFieldName?: string;
}

export function useBatchSelection({
  form,
  materialId,
  onLotMetadataFound,
  quantityFieldName = 'quantity',
  packagingFieldName = 'packagingId'
}: UseBatchSelectionProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [lotAvailability, setLotAvailability] = useState<LotInfo | null>(null);
  const [isFixedTare, setIsFixedTare] = useState(false);
  const [calculatedNet, setCalculatedNet] = useState<number>(0);
  const [batchMetadata, setBatchMetadata] = useState<any>(null);

  const lottoValue = form.watch('lotto');
  const currentGross = form.watch(quantityFieldName);
  const packagingId = form.watch(packagingFieldName);

  const updateBatchInfo = useCallback(async (lotto: string) => {
    if (!materialId || !lotto) return;
    
    setIsLoading(true);
    try {
      const [lottoData, lots] = await Promise.all([
        findLastWeightForLotto(materialId, lotto),
        getLotInfoForMaterial(materialId)
      ]);

      const matched = lots.find(l => l.lotto === lotto);
      setLotAvailability(matched || null);
      setBatchMetadata(lottoData);

      if (lottoData) {
        // Auto-fill Tara
        const pkgId = lottoData.packagingId || 'none';
        form.setValue(packagingFieldName, pkgId);
        setIsFixedTare(pkgId !== 'none');

        // Auto-fill Gross Weight (expected)
        const tare = lottoData.tareWeight || 0;
        // PRIORITY: use matched.available (current stock) instead of initial lot weight
        const net = matched?.available ?? (lottoData.netWeight || 0);
        const expectedGross = net + tare;
        
        form.setValue(quantityFieldName, Number(expectedGross.toFixed(3)));
        setCalculatedNet(net);

        if (onLotMetadataFound) onLotMetadataFound(lottoData);
      } else {
        setIsFixedTare(false);
        setBatchMetadata(null);
      }
    } catch (error) {
      console.error("Error updating batch info:", error);
    } finally {
      setIsLoading(true);
      // Wait a bit to avoid flickering if needed, or just set to false
      setIsLoading(false);
    }
  }, [materialId, form, packagingFieldName, quantityFieldName, onLotMetadataFound]);

  // Handle lotto changes (debounced)
  useEffect(() => {
    if (lottoValue && lottoValue.length >= 2 && materialId) {
      const timer = setTimeout(() => {
        updateBatchInfo(lottoValue);
      }, 600);
      return () => clearTimeout(timer);
    } else {
      setLotAvailability(null);
      setIsFixedTare(false);
      setBatchMetadata(null);
    }
  }, [lottoValue, materialId, updateBatchInfo]);

  // Real-time calculation of Net based on Gross input
  useEffect(() => {
    if (batchMetadata) {
      const tare = batchMetadata.tareWeight || 0;
      const gross = Number(currentGross) || 0;
      const netWeightKg = Math.max(0, gross - tare);
      
      const material = batchMetadata.material;
      if (material) {
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
      } else {
        setCalculatedNet(Number(netWeightKg.toFixed(3)));
      }
    } else if (lotAvailability) {
      // Fallback if we only have summary info
      const gross = Number(currentGross) || 0;
      setCalculatedNet(gross); // This case might need more data if we want precise units without batchMetadata
    }
  }, [currentGross, batchMetadata, lotAvailability]);

  return {
    isLoading,
    lotAvailability,
    isFixedTare,
    calculatedNet,
    batchMetadata,
    updateBatchInfo
  };
}
