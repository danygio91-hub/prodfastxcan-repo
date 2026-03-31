import type { RawMaterial, JobOrder, Article, PurchaseOrder, ManualCommitment } from "@/types";
import { RawMaterialTypeConfig } from "./settings-types";
import { calculateBOMRequirement } from "./inventory-utils";

/**
 * Calcola il fabbisogno di materiale convertendolo nell'unità del magazzino (KG, MT o N).
 * Ora utilizza la logica centralizzata di inventory-utils per precisione totale.
 */
export function calculateCommitmentQty(
    jobQta: number, 
    bomItem: any, 
    material: RawMaterial | undefined,
    config: RawMaterialTypeConfig | undefined
): number {
    if (!material || !config) return 0;
    const res = calculateBOMRequirement(jobQta, bomItem, material, config as any);
    return res.totalInBaseUnits;
}

/**
 * Centralize the MRP calculation logic to be used across Data Management and Power Planning.
 */
export function buildMRPTimelines(
    jobOrders: JobOrder[],
    rawMaterials: RawMaterial[],
    articles: Article[],
    purchaseOrders: PurchaseOrder[],
    manualCommitments: ManualCommitment[],
    materialTypesConfig: RawMaterialTypeConfig[]
) {
    const timelines = new Map<string, { date: string, qty: number, jobId: string }[]>();
    const demands: { materialCode: string, qty: number, date: string, deliveryDate: string, id: string }[] = [];

    // 1. Gather demands from Job Orders
    const allJobs = jobOrders.filter(j => j.status !== 'completed');
    allJobs.forEach(job => {
        (job.billOfMaterials || []).forEach(item => {
            if (item.status !== 'withdrawn') {
                const mat = rawMaterials.find(m => m.code.toUpperCase() === item.component.toUpperCase());
                if (mat) {
                    const config = materialTypesConfig.find(c => c.id === mat.type);
                    demands.push({
                        materialCode: mat.code.toUpperCase(),
                        qty: calculateCommitmentQty(job.qta, item, mat, config),
                        date: job.assignedDate || '9999-12-31',
                        deliveryDate: job.dataConsegnaFinale || '9999-12-31',
                        id: job.id
                    });
                }
            }
        });
    });

    // 2. Gather demands from Manual Commitments
    (manualCommitments || []).filter(c => c.status === 'pending').forEach(c => {
        const art = articles.find(a => a.code.toUpperCase() === c.articleCode.toUpperCase());
        if (art) {
            art.billOfMaterials.forEach(item => {
                const mat = rawMaterials.find(m => m.code.toUpperCase() === item.component.toUpperCase());
                if (mat) {
                    const config = materialTypesConfig.find(c => c.id === mat.type);
                    demands.push({
                        materialCode: mat.code.toUpperCase(),
                        qty: calculateCommitmentQty(c.quantity, item, mat, config),
                        date: '9999-12-31',
                        deliveryDate: c.deliveryDate || '9999-12-31',
                        id: c.id
                    });
                }
            });
        }
    });

    // Sort demands
    demands.sort((a: any, b: any) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.deliveryDate.localeCompare(b.deliveryDate);
    });

    // 3. Gather supplies from Purchase Orders
    const supplies = (purchaseOrders || [])
        .filter(po => po.status === 'pending' || po.status === 'partially_received')
        .map(po => ({
            materialCode: po.materialCode.toUpperCase(),
            qty: po.quantity - (po.receivedQuantity || 0),
            date: po.expectedDeliveryDate,
            id: po.id
        }));

    supplies.sort((a, b) => a.date.localeCompare(b.date));

    // 4. Calculate Timelines for each material
    rawMaterials.forEach(mat => {
        const code = mat.code.toUpperCase();
        let balance = mat.currentStockUnits || 0;
        const matDemands = demands.filter(d => d.materialCode === code);
        const matSupplies = [...supplies.filter(s => s.materialCode === code)];

        const timeline: { date: string, qty: number, jobId: string }[] = [];

        matDemands.forEach(demand => {
            balance -= demand.qty;

            let coverDate = 'IMMEDIATA';
            if (balance < -0.001) {
                let tempBalance = balance;
                for (const supply of matSupplies) {
                    if (tempBalance >= -0.001) break;
                    tempBalance += supply.qty;
                    coverDate = supply.date;
                }

                if (tempBalance < -0.001) {
                    coverDate = 'MAI';
                }
            }

            timeline.push({ date: coverDate, qty: demand.qty, jobId: demand.id });
        });

        timelines.set(code, timeline);
    });

    return timelines;
}
