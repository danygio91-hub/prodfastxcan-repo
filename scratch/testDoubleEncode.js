const admin = require('firebase-admin');

async function run() {
  const app = admin.initializeApp({ projectId: 'demo-test' });
  const db = admin.firestore();
  
  try {
    const id = '339%252FPF.1-9';
    const ref = db.collection('jobOrders').doc(id);
    console.log("Ref path:", ref.path);
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
