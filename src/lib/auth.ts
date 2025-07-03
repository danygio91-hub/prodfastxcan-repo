
import { collection, getDocs, doc, setDoc, query, where } from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Operator } from './mock-data';
import { signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';

const AUTH_KEY = 'prodtime_tracker_auth';
const AUTH_EMAIL_DOMAIN = 'prodfastxcan.app';

// Helper to store operator data in local storage
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
 * Attempts to sign in a user with Firebase Auth, verifies their operator profile,
 * and updates their status in Firestore. Throws an error if any step fails.
 * This function only handles the login process; the onAuthStateChanged listener
 * is responsible for updating the application state.
 */
export async function login(username: string, password_used: string): Promise<void> {
    const lowerCaseUsername = username.toLowerCase();
    const emailForAuth = `${lowerCaseUsername}@${AUTH_EMAIL_DOMAIN}`;

    // 1. Sign in with Firebase Auth
    const userCredential = await signInWithEmailAndPassword(auth, emailForAuth, password_used);
    const firebaseUser = userCredential.user;

    // 2. Find the corresponding operator profile in Firestore
    const operatorsRef = collection(db, "operators");
    const q = query(operatorsRef, where("nome_normalized", "==", lowerCaseUsername));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        // If profile doesn't exist, something is wrong. Log out the user to be safe.
        await signOut(auth); 
        throw new Error(`Profilo operatore per "${username}" non trovato.`);
    }

    const operatorDoc = querySnapshot.docs[0];
    const operatorProfile = { id: operatorDoc.id, ...operatorDoc.data() } as Operator;

    // Optional: Secondary password check if needed (Firebase Auth is primary)
    if (operatorProfile.password && operatorProfile.password !== password_used) {
        await signOut(auth);
        throw new Error("Credenziali non valide.");
    }
    
    // 3. Update the operator document with the Firebase UID and set status to 'attivo'
    const operatorDocRef = doc(db, "operators", operatorProfile.id);
    await setDoc(operatorDocRef, { 
        uid: firebaseUser.uid,
        stato: 'attivo'
    }, { merge: true });

    // Login is successful. The onAuthStateChanged listener will now handle updating the app state.
}


export async function logout(): Promise<void> {
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
