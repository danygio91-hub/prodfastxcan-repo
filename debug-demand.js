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

async function checkTotalDemand() {
    console.log('Checking total demand for 50X005X33FR...');
    const snapshot = await db.collection('jobOrders').get();
    let totalDemand = 0;
    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const bom = data.billOfMaterials || [];
        bom.forEach(item => {
            if (item.component === '50X005X33FR' && item.status !== 'withdrawn') {
                totalDemand += (item.fabbisognoTotale || 0);
                console.log(`Job ${data.jobOrderNumber} (${data.status}): ${item.fabbisognoTotale}`);
            }
        });
    });
    console.log('Total Demand:', totalDemand);
}

checkTotalDemand().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
