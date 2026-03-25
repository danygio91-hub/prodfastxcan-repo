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
  console.log('--- Checking Article Count ---');
  const articlesSnap = await db.collection('articles').get();
  console.log(`Total articles: ${articlesSnap.size}`);

  console.log('\n--- Testing Production Report Query ---');
  try {
    const jobsSnap = await db.collection("jobOrders")
        .where("status", "in", ["completed", "production", "suspended", "paused"])
        .orderBy("dataConsegnaFinale", "desc")
        .limit(10)
        .get();
    console.log(`Query successful, found ${jobsSnap.size} jobs.`);
  } catch (e) {
    console.log(`[QUERY FAILURE] ${e.message}`);
  }
}

check().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
