import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'prodfastxcan', // assuming projectId, let's just let it run if it's already using firebase-admin in the project
    });
}
const adminDb = admin.firestore();

async function test() {
    const paddedWeek = '24'.padStart(2, '0');
    const currentKey = `2026_${paddedWeek}`;

    console.log("Querying for <= ", currentKey);
    const masterSnap = await adminDb.collection("defaultCapacityAssignments")
        .where("validFromKey", "<=", currentKey)
        .orderBy("validFromKey", "desc")
        .limit(1)
        .get();

    console.log("Empty?", masterSnap.empty);
    if (!masterSnap.empty) {
        console.log("Data:", masterSnap.docs[0].data());
    }
}
test().catch(console.error);
