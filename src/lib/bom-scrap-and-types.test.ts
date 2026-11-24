import { describe, it, expect } from 'vitest';
import {
  calculateBOMRequirement,
  buildJobBOMItemsFromArticle,
} from './inventory-utils';
import {
  DEFAULT_GLOBAL_SETTINGS,
  findMaterialTypeConfig,
  resolveMaterialOdlSection,
  resolveTabletWithdrawalMode,
  type GlobalSettings,
  type RawMaterialTypeConfig,
} from './settings-types';
import { isBOMItemPhaseCompleted } from './mrp-utils';
import { parseExcelBomRows } from './bom-import-utils';
import type { JobOrder, RawMaterial } from '@/types';

describe('FASE 104-BIS: Parametri Globali Dinamici (BARRA, PIATTO-CU, Tipi Futuri) & Scarto %', () => {
  const piattoCuConfig: RawMaterialTypeConfig = {
    id: 'PIATTO-CU',
    label: 'Piatto Rame',
    defaultUnit: 'mt',
    hasConversion: true,
    conversionType: 'kg/mt',
    requiresCutLength: true,
    enableScrap: true,
    odlSection: 'TRECCIA',
    tabletWithdrawalMode: 'direct',
  };

  const barraWithScrapConfig: RawMaterialTypeConfig = {
    id: 'BARRA',
    label: 'Barra',
    defaultUnit: 'mt',
    hasConversion: true,
    conversionType: 'kg/mt',
    requiresCutLength: true,
    enableScrap: true,
    odlSection: 'TRECCIA',
    tabletWithdrawalMode: 'direct',
  };

  const mockSettingsWithCustomTypes: GlobalSettings = {
    ...DEFAULT_GLOBAL_SETTINGS,
    rawMaterialTypes: [
      ...DEFAULT_GLOBAL_SETTINGS.rawMaterialTypes.filter((t) => t.id !== 'BARRA'),
      barraWithScrapConfig,
      piattoCuConfig,
    ],
  };

  const barraMat: RawMaterial = {
    id: 'mat-barra-1',
    type: 'BARRA',
    code: 'BARRA-CU-30X5',
    description: 'Barra rame 30x5',
    details: {},
    unitOfMeasure: 'mt',
    rapportoKgMt: 1.335,
    conversionFactor: 1.335,
    currentStockUnits: 100,
    currentWeightKg: 133.5,
    batches: [],
  };

  const piattoMat: RawMaterial = {
    id: 'mat-piatto-1',
    type: 'PIATTO-CU',
    code: 'PIATTO-20X3',
    description: 'Piatto in rame 20x3',
    details: {},
    unitOfMeasure: 'mt',
    rapportoKgMt: 2.0,
    conversionFactor: 2.0,
    currentStockUnits: 50,
    currentWeightKg: 100,
    batches: [],
  };

  describe('1. Switch enableScrap OFF vs ON in calculateBOMRequirement', () => {
    it('ignora qualsiasi scrapPercentage quando enableScrap è false (Netto === Lordo)', () => {
      const disabledScrapConfig: RawMaterialTypeConfig = {
        ...barraWithScrapConfig,
        enableScrap: false,
      };

      const res = calculateBOMRequirement(
        10,
        {
          quantity: 1,
          lunghezzaTaglioMm: 1000,
          unit: 'mt',
          scrapPercentage: 5,
        },
        barraMat,
        disabledScrapConfig
      );

      expect(res.appliedScrapPercent).toBe(0);
      expect(res.totalPieces).toBe(10);
      expect(res.netMeters).toBe(10);
      expect(res.totalMeters).toBe(10);
      expect(res.netInBaseUnits).toBe(10);
      expect(res.totalInBaseUnits).toBe(10);
      expect(res.netWeightKg).toBeCloseTo(13.35, 4);
      expect(res.weightKg).toBeCloseTo(13.35, 4);
    });

    it('applica +5% solo ai valori LORDI approvvigionamenti per BARRA e PIATTO-CU lasciando invariato il NETTO officina', () => {
      const resPiatto = calculateBOMRequirement(
        10,
        {
          quantity: 1,
          lunghezzaTaglioMm: 1000,
          unit: 'mt',
          scrapPercentage: 5,
        },
        piattoMat,
        piattoCuConfig
      );

      expect(resPiatto.appliedScrapPercent).toBe(5);
      expect(resPiatto.totalPieces).toBe(10);
      // Netto (ODL / Tablet)
      expect(resPiatto.netMeters).toBe(10);
      expect(resPiatto.netInBaseUnits).toBe(10);
      expect(resPiatto.netWeightKg).toBeCloseTo(20, 4);
      // Lordo (MRP / Impegnato Magazzino Live)
      expect(resPiatto.totalMeters).toBe(10.5);
      expect(resPiatto.totalInBaseUnits).toBe(10.5);
      expect(resPiatto.weightKg).toBeCloseTo(21, 4);

      const resBarra = calculateBOMRequirement(
        10,
        {
          quantity: 1,
          lunghezzaTaglioMm: 1000,
          unit: 'mt',
          scrapPercentage: 5,
        },
        barraMat,
        barraWithScrapConfig
      );

      expect(resBarra.netInBaseUnits).toBe(10);
      expect(resBarra.totalInBaseUnits).toBe(10.5);
      expect(resBarra.totalPieces).toBe(10);
    });

    it('arrotonda per eccesso (Math.ceil) solo quando UOM base è n e appliedScrapPercent > 0', () => {
      const discreteMat: RawMaterial = {
        ...piattoMat,
        unitOfMeasure: 'n',
        rapportoKgMt: 0,
        conversionFactor: 0.2,
      };
      const discreteCfg: RawMaterialTypeConfig = {
        id: 'CUSTOM-PZ',
        label: 'Custom Pezzi',
        defaultUnit: 'n',
        hasConversion: true,
        conversionType: 'kg/unit',
        requiresCutLength: false,
        enableScrap: true,
        odlSection: 'TUBI',
        tabletWithdrawalMode: 'direct',
      };

      const res = calculateBOMRequirement(
        10,
        { quantity: 1, unit: 'n', scrapPercentage: 5 },
        discreteMat,
        discreteCfg
      );

      expect(res.totalPieces).toBe(10);
      expect(res.netInBaseUnits).toBe(10);
      // 10 * 1.05 = 10.5 -> Math.ceil = 11
      expect(res.totalInBaseUnits).toBe(11);
      expect(res.netWeightKg).toBeCloseTo(2.0, 4);
      expect(res.weightKg).toBeCloseTo(2.2, 4);
    });
  });

  describe('2. buildJobBOMItemsFromArticle (Lordo vs Netto distinto su commessa)', () => {
    it('popola fabbisognoTotale (Lordo), fabbisognoNetto (Netto), pesoStimato e pesoNettoStimato', () => {
      const disabledMat: RawMaterial = {
        ...barraMat,
        id: 'mat-bob-1',
        type: 'BOB',
        code: 'BOB-CU-1',
        unitOfMeasure: 'mt',
        rapportoKgMt: 0.5,
      };

      const jobBom = buildJobBOMItemsFromArticle({
        jobQta: 10,
        articleBOM: [
          {
            component: 'PIATTO-20X3',
            unit: 'mt',
            quantity: 1,
            lunghezzaTaglioMm: 1000,
            scrapPercentage: 5,
            note: 'Taglio piatto',
          },
          {
            component: 'BARRA-CU-30X5',
            unit: 'mt',
            quantity: 1,
            lunghezzaTaglioMm: 1000,
            scrapPercentage: 5,
          },
          {
            component: 'BOB-CU-1',
            unit: 'mt',
            quantity: 2,
            lunghezzaTaglioMm: 500,
            scrapPercentage: 10, // BOB ha enableScrap: false in settings -> va azzerato!
          },
        ],
        rawMaterials: [piattoMat, barraMat, disabledMat],
        globalSettings: mockSettingsWithCustomTypes,
      });

      expect(jobBom).toHaveLength(3);

      // PIATTO-CU (enableScrap: true, 5%)
      expect(jobBom[0].fabbisognoNetto).toBe(10);
      expect(jobBom[0].fabbisognoTotale).toBe(10.5);
      expect(jobBom[0].pesoNettoStimato).toBeCloseTo(20, 4);
      expect(jobBom[0].pesoStimato).toBeCloseTo(21, 4);
      expect(jobBom[0].scrapPercentage).toBe(5);

      // BARRA (enableScrap: true, 5%)
      expect(jobBom[1].fabbisognoNetto).toBe(10);
      expect(jobBom[1].fabbisognoTotale).toBe(10.5);
      expect(jobBom[1].scrapPercentage).toBe(5);

      // BOB (enableScrap: false -> ignora 10%)
      expect(jobBom[2].fabbisognoNetto).toBe(10);
      expect(jobBom[2].fabbisognoTotale).toBe(10);
      expect(jobBom[2].scrapPercentage).toBeNull();
    });
  });

  describe('3. Risoluzione dinamica PIATTO-CU & tipi futuri (ODL Section, Tablet Mode & MRP)', () => {
    it('risolve dinamicamente odlSection e tabletWithdrawalMode per PIATTO-CU e tipi futuri', () => {
      const cfg = findMaterialTypeConfig('piatto-cu', mockSettingsWithCustomTypes);
      expect(cfg?.id).toBe('PIATTO-CU');
      expect(resolveMaterialOdlSection(cfg, 'PIATTO-CU', true)).toBe('TRECCIA');
      expect(resolveTabletWithdrawalMode(cfg, 'PIATTO-CU')).toBe('direct');

      // Custom configurato su sezione GUAINA e scarico a sessione
      const customType: RawMaterialTypeConfig = {
        id: 'FUTURO-X',
        label: 'Futuro X',
        defaultUnit: 'mt',
        hasConversion: false,
        requiresCutLength: true,
        odlSection: 'GUAINA',
        tabletWithdrawalMode: 'session',
      };
      expect(resolveMaterialOdlSection(customType, 'FUTURO-X', true)).toBe('GUAINA');
      expect(resolveTabletWithdrawalMode(customType, 'FUTURO-X')).toBe('session');

      // Fallback retrocompatibile quando i campi nuovi sono assenti
      expect(
        resolveMaterialOdlSection(
          { id: 'NUOVO-PZ', defaultUnit: 'n', requiresCutLength: false, hasConversion: false },
          'NUOVO-PZ'
        )
      ).toBe('TUBI');
      expect(resolveTabletWithdrawalMode(undefined, 'BOB')).toBe('session');
      expect(resolveTabletWithdrawalMode(undefined, 'PF3V0')).toBe('session');
      expect(resolveTabletWithdrawalMode(undefined, 'BARRA')).toBe('direct');
      expect(resolveTabletWithdrawalMode(undefined, 'PIATTO-CU')).toBe('direct');
    });

    it('impedisce che Taglio Treccia/Corda completato estingua erroneamente BARRA o PIATTO-CU in MRP', () => {
      const job: JobOrder = {
        id: 'job-test-decouple',
        ordinePF: '999/PF.1',
        cliente: 'Test',
        qta: 10,
        department: 'CP',
        details: 'ART-CUSTOM',
        dataConsegnaFinale: '2026-12-01',
        postazioneLavoro: '',
        status: 'IN_PREPARAZIONE',
        billOfMaterials: [
          { component: 'PIATTO-20X3', unit: 'mt', quantity: 1, lunghezzaTaglioMm: 1000, status: 'pending', isFromTemplate: true },
          { component: 'BARRA-CU-30X5', unit: 'mt', quantity: 1, lunghezzaTaglioMm: 1000, status: 'pending', isFromTemplate: true },
        ],
        phases: [
          {
            id: 'phase-template-1',
            name: 'Taglio Treccia/Corda',
            type: 'preparation',
            status: 'completed',
            sequence: 1,
            materialReady: true,
            workPeriods: [],
            materialConsumptions: [],
            departmentCodes: ['MAG'],
          },
        ],
      };

      expect(isBOMItemPhaseCompleted(job, job.billOfMaterials![0], piattoMat).completed).toBe(false);
      expect(isBOMItemPhaseCompleted(job, job.billOfMaterials![1], barraMat).completed).toBe(false);
    });
  });

  describe('4. Supporto colonna opzionale Scarto (%) in Import Excel BOM', () => {
    it('legge la colonna Scarto (%) se presente e resta retrocompatibile se assente', () => {
      const parsed = parseExcelBomRows([
        {
          'Articolo Padre': 'ART-1',
          'Componente': 'PIATTO-20X3',
          'Unità di Misura': 'mt',
          'Q.tà per Pz': 1,
          'L. Taglio (mm)': 1000,
          'Scarto (%)': '5%',
        },
        {
          'Articolo Padre': 'ART-2',
          'Componente': 'BOB-CU-1',
          'Unità di Misura': 'mt',
          'Q.tà per Pz': 1,
          'L. Taglio (mm)': 500,
        },
      ]);

      expect(parsed[0].billOfMaterials[0].scrapPercentage).toBe(5);
      expect(parsed[1].billOfMaterials[0].scrapPercentage).toBeUndefined();
    });
  });
});

