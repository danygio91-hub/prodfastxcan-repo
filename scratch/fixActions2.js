const fs = require('fs');
let c = fs.readFileSync('src/app/admin/data-management/actions.ts', 'utf8');

c = c.replace(
    /\.doc\(job\.details\.toUpperCase\(\)\)\s*\.select\('code',\s*'phaseTimes',\s*'billOfMaterials'\)\s*\.get\(\);/,
    '.where(admin.firestore.FieldPath.documentId(), "==", job.details.toUpperCase()).select("code", "phaseTimes", "billOfMaterials").limit(1).get();'
);

c = c.replace(
    /if\s*\(articleSnap\.exists\)\s*\{\s*article\s*=\s*articleSnap\.data\(\)\s*as\s*Partial<Article>;\s*\}/,
    'if (!articleSnap.empty) { article = articleSnap.docs[0].data() as Partial<Article>; }'
);

fs.writeFileSync('src/app/admin/data-management/actions.ts', c);
