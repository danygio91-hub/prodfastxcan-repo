const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Basic env parser for .env.local
function loadEnv() {
  try {
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
  } catch (e) {
    console.error('Error reading .env.local:', e.message);
    return {};
  }
}

const env = loadEnv();

if (!env.FIREBASE_PROJECT_ID) {
  console.error('FIREBASE_PROJECT_ID not found in .env.local');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

async function check() {
  console.log('--- Checking Job Orders ---');
  const jobsSnap = await db.collection('jobOrders').limit(100).get();
  let issuesFound = 0;
  jobsSnap.forEach(doc => {
    const job = doc.data();
    let jobHasIssue = false;
    if (job.details === undefined || job.details === null) {
        console.log(`[ISSUE] Job ${doc.id} (${job.ordinePF || 'N/A'}) has NULL/UNDEFINED details`);
        jobHasIssue = true;
    }
    if (!job.phases) {
        console.log(`[ISSUE] Job ${doc.id} (${job.ordinePF || 'N/A'}) has NO phases field`);
        jobHasIssue = true;
    } else if (!Array.isArray(job.phases)) {
        console.log(`[ISSUE] Job ${doc.id} (${job.ordinePF || 'N/A'}) phases is NOT an array:`, typeof job.phases);
        jobHasIssue = true;
    }
    if (jobHasIssue) issuesFound++;
  });
  console.log(`Checked ${jobsSnap.size} jobs, found ${issuesFound} with potential issues.`);

  console.log('\n--- Checking Articles ---');
  const articlesSnap = await db.collection('articles').limit(100).get();
  let artIssues = 0;
  articlesSnap.forEach(doc => {
    const art = doc.data();
    if (!art.phaseTimes) {
        console.log(`[INFO] Article ${art.code} has NO phaseTimes`);
        artIssues++;
    }
  });
  console.log(`Checked ${articlesSnap.size} articles, ${artIssues} have no phaseTimes.`);
}

check().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
