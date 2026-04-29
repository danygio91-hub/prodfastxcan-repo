const admin = require('firebase-admin');
const pid = 'prodfastxcanwork';
const email = 'firebase-adminsdk-fbsvc@prodfastxcanwork.iam.gserviceaccount.com';
const pk = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDHpUms4GZFw1XV\nF9uHnBEDcSac0qAP3KgmXPfIDJb1yeP7dS7zSLgCxEaTHflatLKg3vkDNPGwmFHg\nusNiXSzhdkPQRuF3bQ1GtWBxvH4cxGgfVifoaSyaZmkd4myIWPVGajbysNrIhtkw\nLXGHXyzv+37ZjftmQpbNoRm+oTUF3J6uXKHYuKuZNG7qOUu6qqRYP9nc0jnrPFVz\nM304Q9TxqM8BIAcdazeTXLLY78qDxcFPsmdiHh/pnOaVjgYifpDvVuB/kDnpne8g\nVFQWanHI0cQcBd2J+I3vvWh7xiO0zgyE4LBbZuaKFMW8nrNOxqfeBnphEGKb6rO6\nc0aM8bbVAgMBAAECggEADHKMVnxoNqh1jnNuGHVSeeaLtoKLAGoszArcV7Xx5zxc\nRpuOtD7qsCDOLf0pWe6DEPTN+D/3DgsKgdU1z4keflEqFw8wSV/8ewCIf+w1aF7r\nh1akZtZrNZY12Ws6V+xEoKGzMCxMJm1X7GvM6gM1BqJld97PwkIGa9GD93wkFZZz\nK/3EzDPPR7KXC42YVTczks17SVx3NFh5bjIQhcs5XoPaiPK0aQzU8xh3VsYKQ0VF\nallloLb5vVPKL+R1uflHBSsqH90hdIhX3MxX7/uqFE0OaQFY1biGzfr7XERBRbYO\nrSNfLVwnlYeUoOBP/0KHkOa/wEfxKykie7ll3kgn4QKBgQD8ZC7txwQoYoM0Hjel\n2lYgGeCKXPPxJ5mi7nZrALckNPyge2GaG1qdN/l2ZyTFS9igsoGcDnybOnhLJXZI\YMclQpMJD3G1oNlg1aY1+jJSguBv1oCSu3DMEmC9dkwHGlG+jNyBESq1NX90Ip55\UmfLmXsxN+soJrrogbEEu1hPNQKBgQDKgAq0a7fq8DJIO2BuclZ2KD4MH0pkDOaU\nLIvS3o2VWTRMwPykgGGvSC9ZVTHlu3DDOWHvfEEK9C7tmsUsrjHtCHhj/BvdiXk3\n8ZDsPsE7QSw0DJCLATwRNm30SD2lK6uud10CoYOlLW/BH9AbhaoxvqCT6v+envTU\nX1q+2YydIQKBgAcmy5GfPwXp7K/QX2FKs4ALW6pwAdWGerr8KMzVY1saSUI+3MAi\nIEouKNprB8azZHsBM9z5KBy55miysgxQ+bOblFEAaAdufFpbE2+aHEzsOnHQ0SnX\nN9YAe09DB9p3q3NLyH+7vcsOrgLbbEQhyqEhQzVc0UP8/PTTn/FzYYg1AoGAbhEm\nwGaEc1jXm9daVO4k/Nhm0WP4pWU1t3h3D8kUIAd6m/WR3UBC2GleAyqBkqNNaW+5\nQdjB6dhL4a5sWhrc3D/sYDxaURI2JyhQY3jAwxprkmb58fRb1+dD4LGbgDm6eXw7\nvABac9+8jLZkAXGnzp4U3hGvm2I/JWgnBPFussECgYEA4nQI2abjj1P+rH8GH8LH\nX0DdfYf6rd7Ugo5nhe1b6goVNWbtMV0BOq18XFcHtbVNTfJS7aWTq8o4PbMzQzQi\nh1B89Jjx1zGUKLEFD2+4jtwTXYALxRTVRHAz+Ha2QfNVQbblpIAwgKWuem3nIt8b\n/ROukFov/0urqCNh4ibBz54=\n-----END PRIVATE KEY-----\n'.replace(/\\n/g, '\n');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: pid,
            clientEmail: email,
            privateKey: pk
        })
    });
}

const db = admin.firestore();

async function simulateMRP() {
    const matCode = '50X005X33FR';
    const matSnap = await db.collection('rawMaterials').where('code', '==', matCode).get();
    const mat = matSnap.docs[0].data();
    mat.id = matSnap.docs[0].id;
    
    // 1. Inizializzazione Balance con Fallback Legacy Stock (In-Memory)
    const batchesSum = (mat.batches || []).reduce((sum, b) => sum + (b.currentQuantity || 0), 0);
    let initialStock = mat.currentStockUnits || 0;
    if (batchesSum <= 0.001 && (mat.stock || 0) > 0) {
        initialStock = mat.stock || 0;
    }
    console.log('Initial Stock:', initialStock);

    const posSnap = await db.collection('purchaseOrders').where('materialCode', '==', matCode).get();
    const purchaseOrders = posSnap.docs.map(d => ({ ...d.data(), id: d.id }));
    console.log('Total POs in DB:', purchaseOrders.length);

    const jobsSnap = await db.collection('jobOrders').get();
    const allJobs = jobsSnap.docs.map(d => ({ ...d.data(), id: d.id }));
    console.log('Total Jobs in DB:', allJobs.length);

    // Filter POs
    const matchedPOs = purchaseOrders.filter(po => {
        if (!po || po.status === 'cancelled' || po.status === 'completed' || po.status === 'received') return false;
        return true;
    });
    console.log('Matched POs:', matchedPOs.length, 'Sum Qty:', matchedPOs.reduce((s, p) => s + p.quantity, 0));

    // Simulation Job
    const simulationJob = {
        id: 'SIM-1',
        dataFinePreparazione: '2026-07-17',
        billOfMaterials: [{
            component: matCode,
            fabbisognoTotale: 10.80,
            status: 'pending'
        }]
    };

    const jobsToSimulate = [...allJobs, simulationJob];

    // Events collection
    const events = [];
    const todayISO = new Date().toISOString();
    const now = new Date();

    // Supplies
    matchedPOs.forEach(po => {
        let date = po.expectedDeliveryDate;
        if (!date) date = todayISO;
        else {
            const poDate = new Date(date);
            if (poDate < now) date = todayISO;
        }
        
        const poWithTime = new Date(date);
        poWithTime.setUTCHours(8, 0, 0, 0);
        events.push({ type: 'PO', date: poWithTime.toISOString(), qty: po.quantity });
    });

    // Demands
    jobsToSimulate.forEach(job => {
        (job.billOfMaterials || []).forEach(item => {
            if (item.component === matCode && item.status !== 'withdrawn') {
                const demandDate = job.dataFinePreparazione || job.dataConsegnaFinale || todayISO;
                const demandWithTime = new Date(demandDate);
                demandWithTime.setUTCHours(16, 0, 0, 0);
                
                events.push({
                    type: 'DEMAND',
                    date: demandWithTime.toISOString(),
                    qty: -(item.fabbisognoTotale || 0),
                    jobId: job.id
                });
            }
        });
    });

    // Sort
    events.sort((a, b) => {
        const dateComp = a.date.localeCompare(b.date);
        if (dateComp !== 0) return dateComp;
        return a.type === 'PO' ? -1 : 1;
    });

    console.log('Timeline Events:');
    events.forEach(e => console.log(e.date, e.type, e.qty, e.jobId || ''));

    // 4. Loop di Calcolo (VERO Running Balance)
    let runningBalance = initialStock;
    const totalSuppliesOnTimeline = events.filter(e => e.type === 'PO').reduce((sum, e) => sum + e.qty, 0);
    let cumulativeDemands = 0;

    console.log('\nCALCULATION TRACE:');
    events.forEach(event => {
        if (event.type === 'PO') {
            runningBalance += event.qty;
            console.log(`[PO] ${event.date} Qty: +${event.qty} -> Balance: ${runningBalance.toFixed(2)}`);
        } else {
            const requiredQty = Math.abs(event.qty);
            cumulativeDemands += requiredQty;
            runningBalance -= requiredQty;

            const currentBalance = runningBalance;
            const balanceAtEndOfTime = initialStock + totalSuppliesOnTimeline - cumulativeDemands;
            
            let status = 'RED';
            if (currentBalance >= -0.001) {
                status = (initialStock - cumulativeDemands >= -0.001) ? 'GREEN' : 'AMBER';
            } else if (balanceAtEndOfTime >= -0.001) {
                status = 'LATE';
            }

            console.log(`[DEMAND] ${event.date} Qty: -${requiredQty} -> Current: ${currentBalance.toFixed(2)}, Future: ${balanceAtEndOfTime.toFixed(2)} -> STATUS: ${status}`);
        }
    });
}

simulateMRP().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
