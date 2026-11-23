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
    jobsBomVersion?: number;
}

export const QUICK_ARTICLE_CACHE_TTL_MS = 60 * 1000; // 60 secondi di default

export class QuickArticleCache {
    private cache = new Map<string, CacheEntry>();
    private currentJobsBomVersion: number | undefined = undefined;

    syncJobsBomVersion(version?: number): void {
        if (typeof version !== 'number' || !Number.isFinite(version)) return;
        if (this.currentJobsBomVersion !== undefined && version > this.currentJobsBomVersion) {
            this.cache.clear();
        }
        this.currentJobsBomVersion = version;
    }

    get(code: string, ttlMs: number = QUICK_ARTICLE_CACHE_TTL_MS, expectedJobsBomVersion?: number): ArticleMasterData | null {
        const key = (code || '').trim().toUpperCase();
        if (!key) return null;

        if (typeof expectedJobsBomVersion === 'number') {
            this.syncJobsBomVersion(expectedJobsBomVersion);
        }

        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() - entry.timestamp > ttlMs) {
            this.cache.delete(key);
            return null;
        }

        if (
            typeof expectedJobsBomVersion === 'number' &&
            entry.jobsBomVersion !== undefined &&
            entry.jobsBomVersion !== expectedJobsBomVersion
        ) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    set(code: string, data: ArticleMasterData, jobsBomVersion?: number): void {
        const key = (code || '').trim().toUpperCase();
        if (!key) return;

        if (typeof jobsBomVersion === 'number') {
            this.currentJobsBomVersion = jobsBomVersion;
        }

        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            jobsBomVersion: jobsBomVersion ?? this.currentJobsBomVersion,
        });
    }

    updateArticle(updatedArticle: Article, fallbackMaster?: Partial<ArticleMasterData>): void {
        const key = (updatedArticle.code || updatedArticle.id || '').trim().toUpperCase();
        if (!key) return;

        const existing = this.cache.get(key);
        if (existing) {
            const existingMatCodes = new Set(
                (existing.data.materials || []).map((m) => (m.code || '').trim().toUpperCase()).filter(Boolean)
            );
            const hasMissingMaterials = (updatedArticle.billOfMaterials || []).some((b) => {
                const c = (b.component || '').trim().toUpperCase();
                return c && !existingMatCodes.has(c);
            });
            if (hasMissingMaterials && !fallbackMaster?.materials) {
                // Invalida la entry se contiene nuovi componenti non presenti nell'array materials precaricato
                this.cache.delete(key);
                return;
            }
            this.cache.set(key, {
                data: {
                    ...existing.data,
                    ...(fallbackMaster || {}),
                    article: updatedArticle,
                },
                timestamp: Date.now(),
                jobsBomVersion: this.currentJobsBomVersion,
            });
        } else {
            this.cache.set(key, {
                data: {
                    article: updatedArticle,
                    workCycles: fallbackMaster?.workCycles || [],
                    phaseTemplates: fallbackMaster?.phaseTemplates || [],
                    globalSettings: fallbackMaster?.globalSettings ?? null,
                    materials: fallbackMaster?.materials || [],
                },
                timestamp: Date.now(),
                jobsBomVersion: this.currentJobsBomVersion,
            });
        }
    }

    mutate(
        code: string,
        updater: ArticleMasterData | ((current: ArticleMasterData | null) => ArticleMasterData | null)
    ): ArticleMasterData | null {
        const key = (code || '').trim().toUpperCase();
        if (!key) return null;

        const current = this.cache.get(key)?.data ?? null;
        const next = typeof updater === 'function' ? updater(current) : updater;
        if (!next) {
            this.cache.delete(key);
            return null;
        }
        this.cache.set(key, {
            data: next,
            timestamp: Date.now(),
        });
        return next;
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
