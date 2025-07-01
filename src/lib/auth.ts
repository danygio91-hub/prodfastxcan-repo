import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Operator } from './mock-data';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

const AUTH_KEY = 'prodtime_tracker_auth';
const AUTH_EMAIL_DOMAIN = 'prodfastxcan.app';
const ADMIN_EMAIL = `daniel.giorlando@${AUTH_EMAIL_DOMAIN}`;

// Helper to store operator data in local storage
const storeOperator = (operator: Operator) => {
    if (typeof window !== 'undefined') {
        const { password, ...operatorToStore } = operator;
        localStorage.setItem(AUTH_KEY, JSON.stringify(operatorToStore));
    }
};

export async function login(username: string, password_used: string): Promise<Operator | null> {
    const isAttemptingAdminLogin = username.toLowerCase() === 'daniel' || username.toLowerCase() === ADMIN_EMAIL;

    // --- ADMIN LOGIN PATH ---
    if (isAttemptingAdminLogin) {
        try {
            await signInWithEmailAndPassword(auth, ADMIN_EMAIL, password_used);
            
            // If authentication is successful, we know it's the admin.
            // We build the admin operator object from scratch to ensure it's always correct.
            const adminOperator: Operator = {
                id: 'op-1', // This must match the ID in mock-data for consistency
                nome: 'Daniel',
                cognome: 'Giorlando',
                reparto: 'N/D',
                stato: 'attivo', // Set to active on login
                role: 'admin',
                privacySigned: true, // Assume admin has signed
            };

            // Force update Firestore with the correct admin profile
            try {
                const adminRef = doc(db, "operators", adminOperator.id);
                await setDoc(adminRef, adminOperator, { merge: true });
            } catch (dbError) {
                console.error("Failed to update admin profile in Firestore:", dbError);
                // We don't fail the login for this, but it's important to log.
            }
            
            storeOperator(adminOperator);
            return adminOperator;

        } catch (error: any) {
            console.error("Admin authentication failed:", error.code, error.message);
            return null;
        }
    }

    // --- REGULAR OPERATOR LOGIN PATH ---
    try {
        let emailForAuth: string;
        // Find operator in DB to get their full details and construct email
        const operatorsSnap = await getDocs(collection(db, "operators"));
        const allOperators = operatorsSnap.docs.map(doc => doc.data() as Operator);
        
        const operatorProfile = allOperators.find(op => 
            op.nome.toLowerCase() === username.toLowerCase() || 
            `${op.nome.toLowerCase()}.${op.cognome.toLowerCase().replace(/\s+/g, '')}@${AUTH_EMAIL_DOMAIN}` === username.toLowerCase()
        );

        if (!operatorProfile) {
            console.error(`No operator profile found for username/email: ${username}`);
            return null;
        }
        
        emailForAuth = `${operatorProfile.nome.toLowerCase()}.${operatorProfile.cognome.toLowerCase().replace(/\s+/g, '')}@${AUTH_EMAIL_DOMAIN}`;

        // Authenticate with Firebase
        await signInWithEmailAndPassword(auth, emailForAuth, password_used);
        
        // On success, update status and store
        const loggedInOperator = { ...operatorProfile, stato: 'attivo' as const };
        storeOperator(loggedInOperator);
        
        // Also update status in Firestore async
        const operatorRef = doc(db, "operators", loggedInOperator.id);
        setDoc(operatorRef, { stato: 'attivo' }, { merge: true }).catch(err => console.error("Failed to update operator status in DB", err));
        
        return loggedInOperator;

    } catch (error: any) {
        console.error(`Operator login failed for ${username}:`, error.code, error.message);
        return null;
    }
}

export async function logout(): Promise<void> {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(AUTH_KEY);
  }
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out from Firebase:", error);
  }
}

export function getOperator(): Operator | null {
  if (typeof window !== 'undefined') {
    const authDataString = localStorage.getItem(AUTH_KEY);
    if (authDataString) {
      try {
        return JSON.parse(authDataString) as Operator;
      } catch (e) {
        console.error("Failed to parse auth data from localStorage", e);
        localStorage.removeItem(AUTH_KEY);
        return null;
      }
    }
  }
  return null;
}
