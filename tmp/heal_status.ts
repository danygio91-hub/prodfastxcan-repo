import { adminDb } from '../src/lib/firebase-admin';
import { getOverallStatus } from '../src/lib/types';

async function healDbStatuses() {
    console.log("Iniziando operazione di healing degli stati...");
    
    // Fetch all active jobOrders (excluding completed ones to save reads, but ideally we heal everything we care about)
    // We'll fetch everything to be safe, up to a limit or paginated
    const snapshot = await adminDb.collection('jobOrders').get();
    
    let updated = 0;
    
    const batch = adminDb.batch();
    
    for (const doc of snapshot.docs) {
        const data = doc.data();
        
        // We need to pass the data to getOverallStatus
        // getOverallStatus expects JobOrder format
        const currentCalculatedStatus = getOverallStatus(data as any);
        
        if (data.status !== currentCalculatedStatus) {
            console.log(`Aggiornamento Commessa ODL ${data.ordinePF}: ${data.status} -> ${currentCalculatedStatus}`);
            batch.update(doc.ref, { status: currentCalculatedStatus });
            updated++;
        }
    }
    
    if (updated > 0) {
        console.log(`Esecuzione batch per ${updated} documenti...`);
        await batch.commit();
        console.log("Agiornamento completato con successo.");
    } else {
        console.log("Nessun documento necessitava di aggiornamento. Tutto sincronizzato!");
    }
}

healDbStatuses()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
