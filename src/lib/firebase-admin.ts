// @ts-ignore
import admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    const isServiceAccountConfigured = 
      process.env.FIREBASE_PROJECT_ID && 
      process.env.FIREBASE_CLIENT_EMAIL && 
      process.env.FIREBASE_PRIVATE_KEY;

    if (isServiceAccountConfigured) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // The private key may have literal \n string representations depending on how it's parsed
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    } else {
      // During build time or in environments where ADC is available (like Firebase App Hosting),
      // we can initialize without explicit credentials.
      admin.initializeApp();
    }
  } catch (error: any) {
    if (process.env.NODE_ENV === 'production') {
      console.error('Firebase admin initialization error', error.stack);
    } else {
      // On local dev, this might happen if no keys are set, we log a warning but don't crash
      console.warn('Firebase admin could not be fully initialized (ignore during build):', error.message);
    }
  }
}

export const adminDb = admin.firestore();
export const adminAuth = admin.auth();
