
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Operator } from './mock-data';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

const AUTH_KEY = 'prodtime_tracker_auth';
const AUTH_EMAIL_DOMAIN = 'prodfastxcan.app';

// Helper to store operator data in local storage
// This will be called by the AuthProvider
export const storeOperator = (operator: Operator | null) => {
    if (typeof window !== 'undefined') {
        if (operator === null) {
            localStorage.removeItem(AUTH_KEY);
        } else {
            const { password, ...operatorToStore } = operator;
            localStorage.setItem(AUTH_KEY, JSON.stringify(operatorToStore));
        }
    }
};

/**
 * Attempts to sign in a user with Firebase Auth.
 * It determines the correct email to use based on the input.
 * It does NOT return an operator profile; that is handled by the AuthProvider.
 */
export async function login(username: string, password_used: string) {
    let emailForAuth: string;

    if (username.toLowerCase() === 'daniel') {
        // Special case for admin login with username
        emailForAuth = `daniel.giorlando@${AUTH_EMAIL_DOMAIN}`;
    } else if (username.includes('@')) {
        // Standard email login
        emailForAuth = username;
    } else {
        // Attempt to construct email from username for regular operators
        // This requires a DB lookup.
        const operatorsSnap = await getDocs(collection(db, "operators"));
        const allOperators = operatorsSnap.docs.map(doc => doc.data() as Operator);
        const operatorProfile = allOperators.find(op => op.nome.toLowerCase() === username.toLowerCase());

        if (!operatorProfile) {
            throw new Error(`Nessun utente trovato con il nome: ${username}`);
        }
        
        emailForAuth = `${operatorProfile.nome.toLowerCase()}.${operatorProfile.cognome.toLowerCase().replace(/\s+/g, '')}@${AUTH_EMAIL_DOMAIN}`;
    }

    // Perform the sign-in with Firebase
    return await signInWithEmailAndPassword(auth, emailForAuth, password_used);
}

export async function logout(): Promise<void> {
  try {
    await signOut(auth);
    // Clearing local storage is now handled by the AuthProvider's onAuthStateChanged listener
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
