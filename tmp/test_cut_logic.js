
// Mock de-esm calculation for testing purposes
function calculateBOMRequirement(
  jobQta,
  bomItem,
  material,
  config
) {
  const qta = Number(jobQta) || 0;
  const bomQty = Number(bomItem.quantity) || 0;
  const baseUnit = config.defaultUnit;
  const totalPieces = qta * bomQty;
  const factor = material.conversionFactor || 1;

  const isLengthApplicable = config.requiresCutLength !== false;
  const lengthMm = isLengthApplicable ? (Number(bomItem.lunghezzaTaglioMm) || 0) : 0;

  let totalInBaseUnits = 0;
  let totalMeters = undefined;

  if (lengthMm > 0) {
      totalMeters = (totalPieces * lengthMm) / 1000;
  } else if (bomItem.unit === 'mt') {
      totalMeters = totalPieces;
  }

  if (baseUnit === 'kg') {
      if (totalMeters !== undefined) {
          totalInBaseUnits = totalMeters * factor;
      } else {
          totalInBaseUnits = totalPieces * factor;
      }
  } else if (baseUnit === 'mt') {
      totalInBaseUnits = totalMeters ?? totalPieces;
  } else {
      totalInBaseUnits = totalPieces;
  }

  return { totalInBaseUnits };
}

function test() {
    const jobQta = 10;
    const materialKG = { unitOfMeasure: 'kg', conversionFactor: 1.2 }; // ES: 1.2 kg per pezzo o per metro
    const materialMT = { unitOfMeasure: 'mt', conversionFactor: 1 };
    
    // Test 1: BOB (Requires Cut, Base UOM: mt)
    const configBOB = { defaultUnit: 'mt', requiresCutLength: true };
    const bomItem1 = { quantity: 2, lunghezzaTaglioMm: 500, unit: 'n' };
    const res1 = calculateBOMRequirement(jobQta, bomItem1, materialMT, configBOB);
    console.log('Result BOB (10 jobs * 2 pcs * 0.5m):', res1.totalInBaseUnits, 'mt');

    // Test 2: TUBI (No Cut, Base UOM: n)
    const configTUBI = { defaultUnit: 'n', requiresCutLength: false };
    const bomItem2 = { quantity: 2, lunghezzaTaglioMm: 500, unit: 'n' }; // mm ignora
    const res2 = calculateBOMRequirement(jobQta, bomItem2, materialMT, configTUBI);
    console.log('Result TUBI (10 jobs * 2 pcs):', res2.totalInBaseUnits, 'n');

    // Test 3: PF3V0 (No Cut, Base UOM: kg, 1.2kg/pz)
    const configPF = { defaultUnit: 'kg', requiresCutLength: false };
    const bomItem3 = { quantity: 1, unit: 'n' };
    const res3 = calculateBOMRequirement(jobQta, bomItem3, materialKG, configPF);
    console.log('Result PF3V0 (10 jobs * 1 pc * 1.2kg):', res3.totalInBaseUnits, 'kg');

    if (res1.totalInBaseUnits === 10 && res2.totalInBaseUnits === 20 && res3.totalInBaseUnits === 12) {
        console.log('--- VERIFIED: UOM Logic is 100% Correct! ---');
    } else {
        console.log('--- FAILED: Logic error in UOM. ---');
        console.log('Results:', { res1: res1.totalInBaseUnits, res2: res2.totalInBaseUnits, res3: res3.totalInBaseUnits });
    }
}

test();
