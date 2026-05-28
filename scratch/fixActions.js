const fs = require('fs');
const path = require('path');

const filesToFix = [
    'src/app/admin/production-console/actions.ts',
    'src/components/production-console/actions.ts'
];

for (const filePath of filesToFix) {
    let content = fs.readFileSync(filePath, 'utf8');

    // Add import for getItemRefAndSnap if not present
    if (!content.includes('getItemRefAndSnap')) {
        content = content.replace(
            "import { getOverallStatus } from '@/lib/types';",
            "import { getOverallStatus } from '@/lib/types';\nimport { getItemRefAndSnap } from '@/lib/firestore-utils';"
        ).replace(
            "import { updateArticleHistoricalTimes } from '@/lib/production-time-server-utils';",
            "import { updateArticleHistoricalTimes } from '@/lib/production-time-server-utils';\nimport { getItemRefAndSnap } from '@/lib/firestore-utils';"
        );
    }

    // Replace forceFinishProduction pattern
    // pattern: const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
    // followed by runTransaction and snap = await transaction.get(itemRef);
    const regex1 = /const\s+itemRef\s*=\s*adminDb\.collection\(isGroup\s*\?\s*'workGroups'\s*:\s*'jobOrders'\)\.doc\((\w+)\);\s*await\s+adminDb\.runTransaction\(async\s*\(transaction(:\s*admin\.firestore\.Transaction)?\)\s*=>\s*\{\s*const\s+(snap|itemSnap)\s*=\s*await\s+transaction\.get\(itemRef\);/g;
    
    content = content.replace(regex1, (match, idVar, type, snapVar) => {
        return `await adminDb.runTransaction(async (transaction${type || ''}) => {\n        const { itemRef, itemSnap: ${snapVar} } = await getItemRefAndSnap(adminDb, ${idVar}, transaction);`;
    });

    const regex2 = /const\s+jobRef\s*=\s*adminDb\.collection\('jobOrders'\)\.doc\((\w+)\);\s*await\s+adminDb\.runTransaction\(async\s*\(transaction(:\s*admin\.firestore\.Transaction)?\)\s*=>\s*\{\s*const\s+(snap|jobSnap)\s*=\s*await\s+transaction\.get\(jobRef\);/g;

    content = content.replace(regex2, (match, idVar, type, snapVar) => {
        return `await adminDb.runTransaction(async (transaction${type || ''}) => {\n        const { itemRef: jobRef, itemSnap: ${snapVar} } = await getItemRefAndSnap(adminDb, ${idVar}, transaction);`;
    });

    const regex3 = /const\s+itemRef\s*=\s*adminDb\.collection\(isGroup\s*\?\s*'workGroups'\s*:\s*'jobOrders'\)\.doc\((\w+)\);\s*const\s+templateRef\s*=\s*adminDb\.collection\('workPhaseTemplates'\)\.doc\(phaseId\);\s*await\s+adminDb\.runTransaction\(async\s*\(transaction(:\s*admin\.firestore\.Transaction)?\)\s*=>\s*\{\s*const\s+\[(itemSnap|snap),\s*tSnap\]\s*=\s*await\s+Promise\.all\(\[\s*transaction\.get\(itemRef\),\s*transaction\.get\(templateRef\)\s*\]\);/g;

    content = content.replace(regex3, (match, idVar, type, snapVar) => {
        return `const templateRef = adminDb.collection('workPhaseTemplates').doc(phaseId);\n    await adminDb.runTransaction(async (transaction${type || ''}) => {\n        const { itemRef, itemSnap: ${snapVar} } = await getItemRefAndSnap(adminDb, ${idVar}, transaction);\n        const tSnap = await transaction.get(templateRef);`;
    });

    const regex4 = /const\s+itemRef\s*=\s*adminDb\.collection\(isGroup\s*\?\s*'workGroups'\s*:\s*'jobOrders'\)\.doc\((\w+)\);\s*try\s*\{\s*await\s+adminDb\.runTransaction\(async\s*\(t(:\s*admin\.firestore\.Transaction)?\)\s*=>\s*\{\s*const\s+\[snap,\s*opSnap\]\s*=\s*await\s+Promise\.all\(\[\s*t\.get\(itemRef\),\s*t\.get\(adminDb\.collection\('operators'\)\.doc\(uid\)\)\s*\]\);/g;

    content = content.replace(regex4, (match, idVar, type) => {
        return `try {\n    await adminDb.runTransaction(async (t${type || ''}) => {\n      const { itemRef, itemSnap: snap } = await getItemRefAndSnap(adminDb, ${idVar}, t);\n      const opSnap = await t.get(adminDb.collection('operators').doc(uid));`;
    });
    
    // Non-transactional forceCompleteJob
    const regex5 = /adminDb\.collection\('jobOrders'\)\.doc\((\w+)\)\.update\(/g;
    // this one is tricky, let's look at it manually
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${filePath}`);
}
