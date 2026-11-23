import { describe, it, expect } from 'vitest';
import {
    parseStrictCutLengthMm,
    normalizeOptionalCutLengthMm,
    optionalCutLengthMmSchema,
    parseExcelBomRows,
    mergeServerAndLocalJobForOdlPrint,
} from './bom-import-utils';
import { syncJobBOMItems } from './inventory-utils';
import type { RawMaterial } from '@/types';

describe('FASE 105-BIS: BOM Integrity, Cut Lengths & ODL Print Precedence', () => {
    describe('1. parseStrictCutLengthMm (Excel BOM import cut length parser)', () => {
        it('rejects alphanumeric note strings and routes them to noteFromCutField without extracting leading digits', () => {
            expect(parseStrictCutLengthMm('45° TAGLIO OBLIQUO')).toEqual({
                lengthMm: undefined,
                noteFromCutField: '45° TAGLIO OBLIQUO',
            });
            expect(parseStrictCutLengthMm('10X2')).toEqual({
                lengthMm: undefined,
                noteFromCutField: '10X2',
            });
            expect(parseStrictCutLengthMm('2 VIE')).toEqual({
                lengthMm: undefined,
                noteFromCutField: '2 VIE',
            });
        });

        it('parses decimal comma and integer strings accurately', () => {
            expect(parseStrictCutLengthMm('120,5')).toEqual({
                lengthMm: 120.5,
            });
            expect(parseStrictCutLengthMm('82')).toEqual({
                lengthMm: 82,
            });
            expect(parseStrictCutLengthMm('82,5 mm')).toEqual({
                lengthMm: 82.5,
            });
        });

        it('handles Italian thousands separator format ("1.500" -> 1500)', () => {
            expect(parseStrictCutLengthMm('1.500')).toEqual({
                lengthMm: 1500,
                isAmbiguousThousands: true,
            });
        });

        it('returns lengthMm: undefined for empty string, null, undefined, or zero', () => {
            expect(parseStrictCutLengthMm('')).toEqual({ lengthMm: undefined });
            expect(parseStrictCutLengthMm(null)).toEqual({ lengthMm: undefined });
            expect(parseStrictCutLengthMm(undefined)).toEqual({ lengthMm: undefined });
            expect(parseStrictCutLengthMm(0)).toEqual({ lengthMm: undefined });
        });
    });

    describe('2. Zod optionalCutLengthMmSchema & normalizeOptionalCutLengthMm (No null/"" -> 0 coercion)', () => {
        it('normalizes null, empty string, undefined, and 0 to undefined (never 0)', () => {
            expect(normalizeOptionalCutLengthMm(null)).toBeUndefined();
            expect(normalizeOptionalCutLengthMm('')).toBeUndefined();
            expect(normalizeOptionalCutLengthMm('   ')).toBeUndefined();
            expect(normalizeOptionalCutLengthMm(undefined)).toBeUndefined();
            expect(normalizeOptionalCutLengthMm(0)).toBeUndefined();

            expect(optionalCutLengthMmSchema.parse(null)).toBeUndefined();
            expect(optionalCutLengthMmSchema.parse('')).toBeUndefined();
            expect(optionalCutLengthMmSchema.parse(undefined)).toBeUndefined();
        });

        it('parses comma decimals ("82,5") and valid positive numbers accurately', () => {
            expect(optionalCutLengthMmSchema.parse('82,5')).toBe(82.5);
            expect(optionalCutLengthMmSchema.parse(250)).toBe(250);
        });

        it('parses Excel BOM rows supporting both Export Flat headers and Import headers', () => {
            const rows = [
                {
                    'Articolo Padre': 'ART-TEST-01',
                    'Componente': '150X020X38FT',
                    'Unità di Misura': 'mt',
                    'Q.tà per Pz': '2',
                    'L. Taglio (mm)': '120,5',
                    'Note': 'Taglio netto',
                },
                {
                    'Articolo Padre': 'ART-TEST-01',
                    'Componente': 'GUAINA-10',
                    'Q.tà per Pz': 1,
                    'L. Taglio (mm)': '45° TAGLIO OBLIQUO',
                    'Note': '',
                },
            ];

            const articles = parseExcelBomRows(rows);
            expect(articles).toHaveLength(1);
            expect(articles[0].code).toBe('ART-TEST-01');
            expect(articles[0].billOfMaterials).toHaveLength(2);
            expect(articles[0].billOfMaterials[0]).toMatchObject({
                component: '150X020X38FT',
                unit: 'mt',
                quantity: 2,
                lunghezzaTaglioMm: 120.5,
                note: 'Taglio netto',
            });
            expect(articles[0].billOfMaterials[1]).toMatchObject({
                component: 'GUAINA-10',
                quantity: 1,
                note: '45° TAGLIO OBLIQUO',
            });
            expect(articles[0].billOfMaterials[1].lunghezzaTaglioMm).toBeUndefined();
        });
    });

    describe('3. syncJobBOMItems with multiple rows of the same component at different cut lengths', () => {
        const mockMaterials: RawMaterial[] = [
            {
                id: '150X020X38FT',
                code: '150X020X38FT',
                description: 'Treccia rame',
                type: 'TRECCIA',
                unitOfMeasure: 'mt',
                conversionFactor: 0.5,
                rapportoKgMt: 0.5,
                safetyStock: 0,
                batches: [],
            } as unknown as RawMaterial,
        ];

        const mockGlobalSettings = {
            rawMaterialTypes: [
                {
                    id: 'TRECCIA',
                    name: 'Treccia',
                    defaultUnit: 'mt',
                    requiresCutLength: true,
                },
            ],
        };

        it('preserves both rows and their respective cut lengths (250 mm and 480 mm) and statuses', () => {
            const currentJobBOM = [
                {
                    component: '150X020X38FT',
                    unit: 'mt',
                    quantity: 1,
                    lunghezzaTaglioMm: 250,
                    status: 'withdrawn',
                    isFromTemplate: true,
                },
                {
                    component: '150X020X38FT',
                    unit: 'mt',
                    quantity: 2,
                    lunghezzaTaglioMm: 480,
                    status: 'pending',
                    isFromTemplate: true,
                },
            ];

            const articleBOM = [
                {
                    component: '150X020X38FT',
                    unit: 'n', // even if stale 'n' in input, canonical unit 'mt' from rawMaterials is resolved
                    quantity: 1,
                    lunghezzaTaglioMm: 250,
                    note: 'Spezzone corto',
                },
                {
                    component: '150X020X38FT',
                    unit: 'mt',
                    quantity: 2,
                    lunghezzaTaglioMm: 480,
                    note: 'Spezzone lungo',
                },
            ];

            const synced = syncJobBOMItems(10, currentJobBOM, articleBOM, mockMaterials, mockGlobalSettings);

            expect(synced).toHaveLength(2);
            expect(synced[0]).toMatchObject({
                component: '150X020X38FT',
                unit: 'mt',
                quantity: 1,
                lunghezzaTaglioMm: 250,
                status: 'withdrawn',
                note: 'Spezzone corto',
            });
            expect(synced[1]).toMatchObject({
                component: '150X020X38FT',
                unit: 'mt',
                quantity: 2,
                lunghezzaTaglioMm: 480,
                status: 'pending',
                note: 'Spezzone lungo',
            });
            // 10 pcs * 1 * 0.25m = 2.5m
            expect(synced[0].fabbisognoTotale).toBeCloseTo(2.5, 4);
            // 10 pcs * 2 * 0.48m = 9.6m
            expect(synced[1].fabbisognoTotale).toBeCloseTo(9.6, 4);
        });
    });

    describe('4. mergeServerAndLocalJobForOdlPrint (Server truth precedence over stale localJob)', () => {
        it('gives absolute precedence to serverJob.billOfMaterials and serverJob fields over stale localJob', () => {
            const staleLocalJob = {
                id: 'JOB-100',
                ordinePF: '100/PF.1',
                qta: 10,
                details: 'ART-OLD',
                note: 'Nota vecchia',
                billOfMaterials: [
                    {
                        component: '150X020X38FT',
                        unit: 'mt',
                        quantity: 1,
                        lunghezzaTaglioMm: 95, // Stale cut length in local React state
                    },
                ],
                externalizedMaterials: [],
            };

            const freshServerJob = {
                id: 'JOB-100',
                ordinePF: '100/PF.1',
                qta: 25,
                details: 'ART-NEW',
                note: 'Nota aggiornata da DB',
                billOfMaterials: [
                    {
                        component: '150X020X38FT',
                        unit: 'mt',
                        quantity: 1,
                        lunghezzaTaglioMm: 82, // Updated cut length on Firestore
                    },
                ],
                externalizedMaterials: ['GUAINA-X'],
            };

            const merged = mergeServerAndLocalJobForOdlPrint(staleLocalJob, freshServerJob, ['GUAINA-X']);

            expect(merged.qta).toBe(25);
            expect(merged.details).toBe('ART-NEW');
            expect(merged.note).toBe('Nota aggiornata da DB');
            expect(merged.billOfMaterials).toHaveLength(1);
            expect(merged.billOfMaterials[0].lunghezzaTaglioMm).toBe(82);
            expect(merged.externalizedMaterials).toEqual(['GUAINA-X']);
        });
    });
});

