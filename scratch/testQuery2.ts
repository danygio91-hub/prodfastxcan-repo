import { adminDb } from '../src/lib/firebase-admin';

async function test() {
    const paddedWeek = '23'.padStart(2, '0');
    const currentKey = `2026_${paddedWeek}`;

    console.log("Querying for <=", currentKey);
    const masterSnap = await adminDb.collection("defaultCapacityAssignments")
        .where("validFromKey", "<=", currentKey)
        .orderBy("validFromKey", "desc")
        .limit(1)
        .get();

    console.log("Empty?", masterSnap.empty);
    if (!masterSnap.empty) {
        console.log("Data:", JSON.stringify(masterSnap.docs[0].data(), null, 2));
    }
}
test().catch(console.error);
