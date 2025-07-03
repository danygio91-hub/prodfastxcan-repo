
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
            // Do not store password in local storage
            const { password, ...operatorToStore } = operator;
            localStorage.setItem(AUTH_KEY, JSON.stringify(operatorToStore));
        }
    }
};

/**
 * Attempts to sign in a user with Firebase Auth, then updates their corresponding
 * profile in Firestore with their UID and active status.
 * Throws an error if any step fails.
 */
export async function login(username: string, password_used: string): Promise<void> {
    const lowerCaseUsername = username.toLowerCase();
    const emailForAuth = `${lowerCaseUsername}@${AUTH_EMAIL_DOMAIN}`;

    // 1. Sign in with Firebase Auth. This is the primary gatekeeper.
    const userCredential = await signInWithEmailAndPassword(auth, emailForAuth, password_used);
    const firebaseUser = userCredential.user;

    // 2. Find the corresponding operator profile in Firestore using their normalized name.
    const operatorsRef = collection(db, "operators");
    const q = query(operatorsRef, where("nome_normalized", "==", lowerCaseUsername));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        // This is a critical error state: user exists in Auth but not in our DB.
        // Sign out to prevent inconsistent state.
        await signOut(auth);
        throw new Error(`Profilo operatore per "${username}" non trovato.`);
    }

    const operatorDoc = querySnapshot.docs[0];

    // Note: No secondary password check is needed here because Firebase Auth already verified it.

    // 3. Update the operator document with the Firebase UID and set status to 'attivo'.
    // This links the Firebase Auth user to our Firestore operator profile.
    const operatorDocRef = doc(db, "operators", operatorDoc.id);
    await setDoc(operatorDocRef, {
        uid: firebaseUser.uid,
        stato: 'attivo'
    }, { merge: true });

    // The onAuthStateChanged listener in AuthProvider will now handle setting the app state.
}

/**
 * Signs the user out of Firebase.
 */
export async function logout(): Promise<void> {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out from Firebase:", error);
    throw error;
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
