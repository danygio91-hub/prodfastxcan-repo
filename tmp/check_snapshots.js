const admin = require('firebase-admin');
const fs = require('fs');

function loadEnv() {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  const env = {};
  envContent.split(/\r?\n/).forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      let key = parts[0].trim();
      let val = parts.slice(1).join('=').trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.substring(1, val.length - 1);
      env[key] = val;
    }
  });
  return env;
}

const env = loadEnv();
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

async function check() {
  console.log('--- Checking Planning Snapshots ---');
  const snap = await db.collection('planningSnapshots').get();
  if (snap.empty) {
      console.log('No snapshots found.');
      return;
  }
  snap.forEach(doc => {
    const data = doc.data();
    console.log(`Snapshot ${doc.id}:`);
    console.log(`  Fields: ${Object.keys(data).join(', ')}`);
    if (data.macroAreas) {
        console.log(`  MacroAreas keys: ${Object.keys(data.macroAreas).join(', ')}`);
    } else {
        console.log(`  [ISSUE] MacroAreas is MISSING`);
    }
  });
}

check().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
