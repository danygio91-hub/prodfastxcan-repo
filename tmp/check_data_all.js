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
  console.log('--- Checking ALL Planned/Production Job Orders ---');
  const jobsSnap = await db.collection('jobOrders').where("status", "in", ["planned", "production"]).get();
  let issuesFound = 0;
  jobsSnap.forEach(doc => {
    const job = doc.data();
    let jobHasIssue = false;
    if (!job.details) {
        console.log(`[ISSUE] Job ${doc.id} (${job.ordinePF || 'N/A'}) has missing details`);
        jobHasIssue = true;
    }
    if (!job.phases) {
        console.log(`[ISSUE] Job ${doc.id} (${job.ordinePF || 'N/A'}) has missing phases`);
        jobHasIssue = true;
    } else if (!Array.isArray(job.phases)) {
        console.log(`[ISSUE] Job ${doc.id} (${job.ordinePF || 'N/A'}) phases is not an array`);
        jobHasIssue = true;
    }
    if (jobHasIssue) issuesFound++;
  });
  console.log(`Checked ${jobsSnap.size} active jobs, found ${issuesFound} with potential issues.`);
}

check().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
