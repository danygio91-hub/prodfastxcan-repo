const fs = require('fs');

const filesToFix = [
    'src/app/admin/production-console/actions.ts',
    'src/components/production-console/actions.ts'
];

for (const filePath of filesToFix) {
    let content = fs.readFileSync(filePath, 'utf8');

    // Fix duplicate imports
    let lines = content.split('\n');
    let hasImport = false;
    lines = lines.filter(line => {
        if (line.includes("import { getItemRefAndSnap } from '@/lib/firestore-utils';")) {
            if (hasImport) return false;
            hasImport = true;
        }
        return true;
    });
    content = lines.join('\n');

    // Fix forEach async
    content = content.replace(/jobIds\.forEach\(id\s*=>\s*\{/g, 'for (const id of jobIds) {');
    content = content.replace(/batch\.update\(itemRef,\s*\{\s*status:\s*'completed',\s*overallEndTime:\s*admin\.firestore\.Timestamp\.now\(\),\s*forcedCompletion:\s*true\s*\}\);\s*\}\);/g, "batch.update(itemRef, { status: 'completed', overallEndTime: admin.firestore.Timestamp.now(), forcedCompletion: true });\n  }");
    // Wait, the regex `\s*\}\);` might fail if indentation varies. Let's just do an exact replace for the whole block:
    const toFind = `  jobIds.forEach(id => {
      const isGroup = id.startsWith('group-');
      const { itemRef } = await getItemRefAndSnap(adminDb, id);
      batch.update(itemRef, { status: 'completed', overallEndTime: admin.firestore.Timestamp.now(), forcedCompletion: true });
  });`;
    const toReplace = `  for (const id of jobIds) {
      const isGroup = id.startsWith('group-');
      const { itemRef } = await getItemRefAndSnap(adminDb, id);
      batch.update(itemRef, { status: 'completed', overallEndTime: admin.firestore.Timestamp.now(), forcedCompletion: true });
  }`;
    content = content.replace(toFind, toReplace);

    fs.writeFileSync(filePath, content, 'utf8');
}

console.log('Fixed compile errors.');
