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
  autoFillQuantity?: boolean;
}

export function useBatchSelection({
  form,
  materialId,
  onLotMetadataFound,
  quantityFieldName = 'quantity',
  packagingFieldName = 'packagingId',
  autoFillQuantity = true
}: UseBatchSelectionProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [lotAvailability, setLotAvailability] = useState<LotInfo | null>(null);
  const [isFixedTare, setIsFixedTare] = useState(false);
  const [calculatedNet, setCalculatedNet] = useState<number>(0);
  const [batchMetadata, setBatchMetadata] = useState<any>(null);
  const [isLottoLocked, setIsLottoLocked] = useState(false);
  const isLottoVerified = !!lotAvailability;

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

      // Se troviamo qualcosa (o stock o metadati storici), blocchiamo il campo
      if (matched || lottoData) {
        setIsLottoLocked(true);
      }

      if (lottoData) {
        // Auto-fill Tara
        const pkgId = lottoData.packagingId || 'none';
        form.setValue(packagingFieldName, pkgId);
        setIsFixedTare(pkgId !== 'none');

        // Calcolo Lordo Atteso
        const tare = lottoData.tareWeight || 0;
        const net = matched?.available ?? (lottoData.netWeight || 0);
        const expectedGross = net + tare;
        
        if (autoFillQuantity) {
          form.setValue(quantityFieldName, Number(expectedGross.toFixed(3)));
        } else {
          // TASSATIVO: Campo vuoto per flussi manuali (Flow B)
          form.setValue(quantityFieldName, null);
        }
        setCalculatedNet(net);

        if (onLotMetadataFound) onLotMetadataFound(lottoData);
      } else {
        setIsFixedTare(false);
        setBatchMetadata(null);
        // Assicura campo vuoto se non c'è storico e non vogliamo auto-fill
        if (!autoFillQuantity) form.setValue(quantityFieldName, null);
      }
    } catch (error) {
      console.error("Error updating batch info:", error);
    } finally {
      setIsLoading(false);
    }
  }, [materialId, form, packagingFieldName, quantityFieldName, onLotMetadataFound, autoFillQuantity]);

  // Handle lotto changes (debounced)
  useEffect(() => {
    if (isLottoLocked) return;

    if (lottoValue && lottoValue.length >= 2 && materialId) {
      const timer = setTimeout(() => {
        updateBatchInfo(lottoValue);
      }, 600);
      return () => clearTimeout(timer);
    } else if (!lottoValue) {
      setLotAvailability(null);
      setIsFixedTare(false);
      setBatchMetadata(null);
      setIsLottoLocked(false);
    }
  }, [lottoValue, materialId, updateBatchInfo, isLottoLocked]);

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
      // Fallback: Arrotondamento pezzi anche se non abbiamo metadati completi
      const gross = Number(currentGross) || 0;
      const uom = lotAvailability.unit?.toLowerCase();
      
      if (uom === 'n') {
          setCalculatedNet(Math.round(gross)); 
      } else {
          setCalculatedNet(Number(gross.toFixed(3)));
      }
    }
  }, [currentGross, batchMetadata, lotAvailability]);

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
