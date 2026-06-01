const admin = require('firebase-admin');
try {
  const db = admin.firestore();
  console.log("Testing 339/PF.1-9");
  const ref = db.collection('jobOrders').doc('339/PF.1-9');
  console.log("Ref path:", ref.path);
} catch (e) {
  console.error("Error:", e.message);
}
