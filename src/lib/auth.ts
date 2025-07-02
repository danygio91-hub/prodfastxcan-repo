
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Operator } from './mock-data';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

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
 */
export async function login(username: string, password_used: string): Promise<Operator> {
    const lowerCaseUsername = username.toLowerCase();
    const emailForAuth = `${lowerCaseUsername}@${AUTH_EMAIL_DOMAIN}`;

    const userCredential = await signInWithEmailAndPassword(auth, emailForAuth, password_used);
    const firebaseUser = userCredential.user;

    const operatorsSnapshot = await getDocs(collection(db, "operators"));
    const operatorList = operatorsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Operator);

    const operatorProfile = operatorList.find(op => op.nome_normalized === lowerCaseUsername);

    if (!operatorProfile) {
        await signOut(auth);
        throw new Error(`Profilo operatore per "${username}" non trovato nel database.`);
    }
    
    // Simple password check against mock data - in a real app, this would be more secure
    // but here it's just a fallback. Firebase Auth is the primary check.
    if (operatorProfile.password && operatorProfile.password !== password_used) {
        await signOut(auth);
        throw new Error("Credenziali non valide.");
    }

    const operatorDocRef = doc(db, "operators", operatorProfile.id);

    await setDoc(operatorDocRef, { 
        uid: firebaseUser.uid,
        stato: 'attivo'
    }, { merge: true });

    const finalProfile: Operator = { ...operatorProfile, uid: firebaseUser.uid, stato: 'attivo' };
    storeOperator(finalProfile);
    return finalProfile;
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
