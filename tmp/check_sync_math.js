
const jobQta = 800;
const articleBOM = [
    { component: '120X025RR', unit: 'mt', quantity: 1, lunghezzaTaglioMm: 205 }
];
const currentBOM = [
    { component: '120X025RR', unit: 'mt', quantity: 8.4, isFromTemplate: true, status: 'pending' }
];
const rawMaterials = [
    { 
        code: '120X025RR', 
        type: 'PROFILO', 
        unitOfMeasure: 'mt', 
        rapportoKgMt: 1.2, 
        conversionFactor: 1.2 
    }
];
const globalSettings = {
    rawMaterialTypes: [
        { id: 'PROFILO', label: 'Profilo', defaultUnit: 'mt', hasConversion: true }
    ]
};

// Simplified calculateBOMRequirement math
function calculateBOMRequirement(qta, item, material, config) {
    const pieces = qta * item.quantity;
    const lmt = (item.lunghezzaTaglioMm || 0) / 1000;
    const totalMeters = pieces * lmt;
    const totalInBaseUnits = totalMeters;
    const weightKg = totalInBaseUnits * (material.rapportoKgMt || 0);
    return { totalInBaseUnits, weightKg };
}

function syncJobBOMItems(jobQta, currentBOM, articleBOM, rawMaterials, globalSettings) {
    const updatedBOM = [];
    const currentBOMMap = new Map(currentBOM.map(item => [item.component.toUpperCase(), item]));

    articleBOM.forEach(artItem => {
        const compCode = artItem.component.toUpperCase();
        const existingItem = currentBOMMap.get(compCode);
        
        let newItem = {
            component: artItem.component,
            unit: artItem.unit,
            quantity: artItem.quantity,
            lunghezzaTaglioMm: artItem.lunghezzaTaglioMm,
            status: existingItem?.status || 'pending',
            isFromTemplate: true
        };

        const material = rawMaterials.find(m => m.code.toUpperCase() === compCode);
        if (material) {
             const config = globalSettings.rawMaterialTypes.find(t => t.id === material.type);
             const req = calculateBOMRequirement(jobQta, newItem, material, config);
             newItem.fabbisognoTotale = req.totalInBaseUnits;
             newItem.pesoStimato = req.weightKg;
        }
        updatedBOM.push(newItem);
    });
    return updatedBOM;
}

const result = syncJobBOMItems(jobQta, currentBOM, articleBOM, rawMaterials, globalSettings);
console.log(JSON.stringify(result, null, 2));

const item = result[0];
const expectedFabbisogno = (205 / 1000) * 800; // 164
const expectedPeso = 164 * 1.2; // 196.8

if (Math.abs(item.fabbisognoTotale - expectedFabbisogno) < 0.001 && Math.abs(item.pesoStimato - expectedPeso) < 0.001) {
    console.log("VERIFICA SUPERATA: Matematica corretta.");
} else {
    console.log("VERIFICA FALLITA!");
    process.exit(1);
}
