
const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json'); // I need to check if this exists or use env

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function run() {
  const jobsSnap = await db.collection("jobOrders").get();
  let count = 0;
  let batch = db.batch();
  let ops = 0;
  
  const productionStates = ['DA_INIZIARE', 'IN_PREPARAZIONE', 'PRONTO_PROD', 'IN_PRODUZIONE', 'FINE_PRODUZIONE', 'QLTY_PACK', 'production', 'suspended', 'paused'];
  
  for (const doc of jobsSnap.docs) {
    const job = doc.data();
    if (productionStates.includes(job.status) && !job.odlCreationDate) {
      batch.update(doc.ref, { status: 'planned' });
      count++;
      ops++;
      if (ops === 450) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
  }
  
  if (ops > 0) {
    await batch.commit();
  }
  
  console.log(`Ripristinate ${count} commesse.`);
  process.exit(0);
}

run();
