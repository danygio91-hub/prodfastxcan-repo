import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuickArticleCache, type ArticleMasterData } from './quick-article-cache';
import type { Article } from '@/types';

const mockArticleData: ArticleMasterData = {
    article: {
        id: 'E60025',
        code: 'E60025',
        billOfMaterials: [{ component: 'TUBO-01', unit: 'mt', quantity: 2 }],
        phaseTimes: { 'fase-1': { expectedMinutesPerPiece: 1.5, detectedMinutesPerPiece: 1.2, enabled: true } },
    } as Article,
    workCycles: [{ id: 'wc-1', name: 'Ciclo Standard', description: 'Ciclo test', phaseTemplateIds: ['fase-1'] }],
    phaseTemplates: [{ id: 'fase-1', name: 'Taglio', description: 'Taglio', departmentCodes: ['DEP1'], type: 'standard' }],
    globalSettings: null,
    materials: [{ id: 'mat-1', code: 'TUBO-01', type: 'TUBO', unitOfMeasure: 'mt' } as any],
};

describe('FASE 82: Client-Side QuickArticleCache', () => {
    let cache: QuickArticleCache;

    beforeEach(() => {
        cache = new QuickArticleCache();
    });

    it('memorizza e recupera istantaneamente i dati anagrafica per codice articolo (case-insensitive e trimmed)', () => {
        cache.set(' E60025 ', mockArticleData);

        const retrieved = cache.get('e60025');
        expect(retrieved).not.toBeNull();
        expect(retrieved?.article?.code).toBe('E60025');
        expect(retrieved?.workCycles).toHaveLength(1);
        expect(retrieved?.materials).toHaveLength(1);
    });

    it('rispetta il TTL ed elimina la voce se scaduta', () => {
        vi.useFakeTimers();
        try {
            cache.set('E60025', mockArticleData);

            // Entro il TTL di 5000ms
            expect(cache.get('E60025', 5000)).not.toBeNull();

            // Avanza il tempo di 5001ms
            vi.advanceTimersByTime(5001);

            expect(cache.get('E60025', 5000)).toBeNull();
            expect(cache.size()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('aggiorna la voce in cache quando l articolo viene modificato e salvato', () => {
        cache.set('E60025', mockArticleData);

        const updatedArticle: Article = {
            ...mockArticleData.article!,
            expectedMinutesDefault: 42,
        };

        cache.updateArticle(updatedArticle);

        const retrieved = cache.get('E60025');
        expect(retrieved?.article?.expectedMinutesDefault).toBe(42);
    });

    it('consente invalidazione mirata o totale', () => {
        cache.set('ART-1', mockArticleData);
        cache.set('ART-2', mockArticleData);
        expect(cache.size()).toBe(2);

        cache.invalidate('ART-1');
        expect(cache.get('ART-1')).toBeNull();
        expect(cache.get('ART-2')).not.toBeNull();

        cache.invalidate();
        expect(cache.size()).toBe(0);
    });
});
