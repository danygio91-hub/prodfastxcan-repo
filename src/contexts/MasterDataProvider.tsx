"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { 
    Operator, 
    Article, 
    Department, 
    RawMaterial, 
    WorkingHoursConfig, 
    ProductionSettings 
} from '@/types';
import { GlobalSettings, DEFAULT_GLOBAL_SETTINGS } from '@/lib/settings-types';

interface MasterDataContextType {
    operators: Operator[];
    articles: Article[];
    articlesMap: Map<string, Article>;
    departments: Department[];
    rawMaterials: RawMaterial[];
    rawMaterialsMap: Map<string, RawMaterial>;
    settings: ProductionSettings | null;
    globalSettings: GlobalSettings | null;
    workingHours: WorkingHoursConfig | null;
    isLoading: boolean;
    refreshMasterData: () => Promise<void>;
}

const MasterDataContext = createContext<MasterDataContextType | undefined>(undefined);

export function MasterDataProvider({ children }: { children: React.ReactNode }) {
    const [operators, setOperators] = useState<Operator[]>([]);
    const [articles, setArticles] = useState<Article[]>([]);
    const [articlesMap, setArticlesMap] = useState<Map<string, Article>>(new Map());
    const [departments, setDepartments] = useState<Department[]>([]);
    const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
    const [rawMaterialsMap, setRawMaterialsMap] = useState<Map<string, RawMaterial>>(new Map());
    const [settings, setSettings] = useState<ProductionSettings | null>(null);
    const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
    const [workingHours, setWorkingHours] = useState<WorkingHoursConfig | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const loadMasterData = useCallback(async () => {
        setIsLoading(true);
        console.log("MasterDataProvider: Inizio caricamento anagrafiche in cache...");
        const start = performance.now();

        try {
            // Fetch everything in parallel via Client SDK
            const [
                opsSnap,
                deptsSnap,
                matsSnap,
                artsSnap,
                prodSettingsSnap,
                hoursConfigSnap,
                globalSettingsSnap
            ] = await Promise.all([
                getDocs(collection(db, "operators")),
                getDocs(collection(db, "departments")),
                getDocs(collection(db, "rawMaterials")),
                getDocs(collection(db, "articles")),
                getDoc(doc(db, "system", "productionSettings")),
                getDoc(doc(db, "configuration", "workingHours")),
                getDoc(doc(db, "settings", "global"))
            ]);

            const ops = opsSnap.docs.map(d => ({ ...d.data(), id: d.id } as Operator));
            const depts = deptsSnap.docs.map(d => ({ ...d.data(), id: d.id } as Department));
            const mats = matsSnap.docs.map(d => ({ ...d.data(), id: d.id } as RawMaterial));
            const arts = artsSnap.docs.map(d => ({ ...d.data(), id: d.id } as Article));

            // Default values for settings if not found
            const prodSettings = prodSettingsSnap.exists() 
                ? prodSettingsSnap.data() as ProductionSettings 
                : { capacityBufferPercent: 85, autoUpdateGanttIntervalHours: 1, prioritizeActualTime: true };
            
            const hoursConfig = hoursConfigSnap.exists()
                ? hoursConfigSnap.data() as WorkingHoursConfig
                : { workingDays: [1,2,3,4,5], shifts: [], efficiencyPercentage: 95 };

            const gSettings = globalSettingsSnap.exists()
                ? { ...DEFAULT_GLOBAL_SETTINGS, ...globalSettingsSnap.data() } as GlobalSettings
                : DEFAULT_GLOBAL_SETTINGS;

            // Build dictionary for articles
            const artMap = new Map<string, Article>();
            arts.forEach((a: Article) => artMap.set(a.code.toUpperCase(), a));

            const matMap = new Map<string, RawMaterial>();
            mats.forEach((m: RawMaterial) => matMap.set(m.code.toUpperCase(), m));

            setOperators(ops);
            setDepartments(depts);
            setRawMaterials(mats);
            setRawMaterialsMap(matMap);
            setArticles(arts);
            setArticlesMap(artMap);
            setSettings(prodSettings);
            setGlobalSettings(gSettings);
            setWorkingHours(hoursConfig);

            const end = performance.now();
            console.log(`MasterDataProvider: Caricamento completato in ${(end - start).toFixed(0)}ms. 
                Record in cache: ${ops.length} Operatori, ${depts.length} Reparti, ${arts.length} Articoli.`);
        } catch (error) {
            console.error("MasterDataProvider: Errore durante il caricamento delle anagrafiche:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadMasterData();
    }, [loadMasterData]);

    const value = {
        operators,
        articles,
        articlesMap,
        departments,
        rawMaterials,
        rawMaterialsMap,
        settings,
        globalSettings,
        workingHours,
        isLoading,
        refreshMasterData: loadMasterData
    };

    return (
        <MasterDataContext.Provider value={value}>
            {children}
        </MasterDataContext.Provider>
    );
}

export function useMasterData() {
    const context = useContext(MasterDataContext);
    if (context === undefined) {
        throw new Error('useMasterData must be used within a MasterDataProvider');
    }
    return context;
}
