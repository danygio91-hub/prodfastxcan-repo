import type { Article, WorkCycle, WorkPhaseTemplate, RawMaterial } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';

export interface ArticleMasterData {
    article: Article | null;
    workCycles: WorkCycle[];
    phaseTemplates: WorkPhaseTemplate[];
    globalSettings: GlobalSettings | null;
    materials: RawMaterial[];
}

interface CacheEntry {
    data: ArticleMasterData;
    timestamp: number;
}

export const QUICK_ARTICLE_CACHE_TTL_MS = 60 * 1000; // 60 secondi di default

export class QuickArticleCache {
    private cache = new Map<string, CacheEntry>();

    get(code: string, ttlMs: number = QUICK_ARTICLE_CACHE_TTL_MS): ArticleMasterData | null {
        const key = (code || '').trim().toUpperCase();
        if (!key) return null;

        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() - entry.timestamp > ttlMs) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    set(code: string, data: ArticleMasterData): void {
        const key = (code || '').trim().toUpperCase();
        if (!key) return;

        this.cache.set(key, {
            data,
            timestamp: Date.now(),
        });
    }

    updateArticle(updatedArticle: Article): void {
        const key = (updatedArticle.code || updatedArticle.id || '').trim().toUpperCase();
        if (!key) return;

        const existing = this.cache.get(key);
        if (existing) {
            existing.data.article = updatedArticle;
            existing.timestamp = Date.now();
        } else {
            this.cache.set(key, {
                data: {
                    article: updatedArticle,
                    workCycles: [],
                    phaseTemplates: [],
                    globalSettings: null,
                    materials: [],
                },
                timestamp: Date.now(),
            });
        }
    }

    invalidate(code?: string): void {
        if (code) {
            this.cache.delete(code.trim().toUpperCase());
        } else {
            this.cache.clear();
        }
    }

    size(): number {
        return this.cache.size;
    }
}

export const quickArticleCache = new QuickArticleCache();
