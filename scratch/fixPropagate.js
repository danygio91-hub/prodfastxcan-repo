const fs = require('fs');
const path = require('path');

const filesToFix = [
    'src/app/admin/production-console/actions.ts',
    'src/components/production-console/actions.ts'
];

for (const filePath of filesToFix) {
    let content = fs.readFileSync(filePath, 'utf8');

    const regex1 = /const\s+jobRefs\s*=\s*groupData\.jobOrderIds\.map\(id\s*=>\s*\{\s*const\s+sanitizedId\s*=\s*id\.replace\(\/\\\\\/\/g,\s*'-'\);\s*return\s+adminDb\.collection\('jobOrders'\)\.doc\(sanitizedId\);\s*\}\);\s*const\s+jobDocs\s*=\s*await\s+Promise\.all\(jobRefs\.map\(ref\s*=>\s*transaction\.get\(ref\)\)\);/g;
    content = content.replace(regex1, `const jobRefsAndSnaps = await Promise.all(\n        groupData.jobOrderIds.map(id => getItemRefAndSnap(adminDb, id, transaction))\n    );\n    const jobDocs = jobRefsAndSnaps.map(r => r.itemSnap);\n    const jobRefs = jobRefsAndSnaps.map(r => r.itemRef);`);
    
    // Also update updatePhasesForJob
    const regex2 = /const\s+itemRef\s*=\s*adminDb\.collection\(isGroup\s*\?\s*'workGroups'\s*:\s*'jobOrders'\)\.doc\(jobId\);\s*const\s+finalPhases\s*=\s*updatePhasesMaterialReadiness/g;
    content = content.replace(regex2, `const { itemRef } = await getItemRefAndSnap(adminDb, jobId);\n  const finalPhases = updatePhasesMaterialReadiness`);

    // In reportMaterialMissing and resolveMaterialMissing, there's `const itemRef = ...` and then `t.get(itemRef)` but wait, those were already replaced by the first script!
    // But updateJobDeliveryDate in components/production-console/actions.ts:
    const regex3 = /const\s+itemRef\s*=\s*adminDb\.collection\(isGroup\s*\?\s*'workGroups'\s*:\s*'jobOrders'\)\.doc\(itemId\);\s*await\s+adminDb\.runTransaction\(async\s*\(t(:\s*admin\.firestore\.Transaction)?\)\s*=>\s*\{\s*const\s+snap\s*=\s*await\s+t\.get\(itemRef\);/g;
    content = content.replace(regex3, (match, type) => {
        return `await adminDb.runTransaction(async (t${type || ''}) => {\n        const { itemRef, itemSnap: snap } = await getItemRefAndSnap(adminDb, itemId, t);`;
    });

    // forceCompleteMultiple in components/production-console/actions.ts
    const regex4 = /batch\.update\(adminDb\.collection\(isGroup\s*\?\s*'workGroups'\s*:\s*'jobOrders'\)\.doc\(id\),\s*\{\s*status:\s*'completed',\s*overallEndTime:\s*admin\.firestore\.Timestamp\.now\(\),\s*forcedCompletion:\s*true\s*\}\);/g;
    content = content.replace(regex4, `const { itemRef } = await getItemRefAndSnap(adminDb, id);\n      batch.update(itemRef, { status: 'completed', overallEndTime: admin.firestore.Timestamp.now(), forcedCompletion: true });`);
    
    const regex5 = /const\s+snap\s*=\s*await\s+adminDb\.collection\(id\.startsWith\('group-'\)\s*\?\s*'workGroups'\s*:\s*'jobOrders'\)\.doc\(id\)\.get\(\);/g;
    content = content.replace(regex5, `const { itemSnap: snap } = await getItemRefAndSnap(adminDb, id);`);
    
    // resetSingleCompletedJobOrder -> delete itemRef (replaced by first script)

    fs.writeFileSync(filePath, content, 'utf8');
}

// Manually fix propagateGroupUpdatesToJobs because regex string matching is annoying
for (const filePath of filesToFix) {
    let content = fs.readFileSync(filePath, 'utf8');
    const toFind = `    const jobRefs = groupData.jobOrderIds.map(id => {
        const sanitizedId = id.replace(/\\//g, '-');
        return adminDb.collection('jobOrders').doc(sanitizedId);
    });
    const jobDocs = await Promise.all(jobRefs.map(ref => transaction.get(ref)));`;
    const toReplace = `    const jobRefsAndSnaps = await Promise.all(
        groupData.jobOrderIds.map(id => getItemRefAndSnap(adminDb, id, transaction))
    );
    const jobDocs = jobRefsAndSnaps.map(r => r.itemSnap);
    const jobRefs = jobRefsAndSnaps.map(r => r.itemRef);`;
    content = content.replace(toFind, toReplace);
    
    fs.writeFileSync(filePath, content, 'utf8');
}

console.log('Fixed additional ones.');
