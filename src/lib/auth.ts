import { collection, getDocs, doc, setDoc, getDoc, query, where } from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Operator } from './mock-data';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

const AUTH_KEY = 'prodtime_tracker_auth';
const AUTH_EMAIL_DOMAIN = 'prodfastxcan.app';
const ADMIN_EMAIL = `daniel@${AUTH_EMAIL_DOMAIN}`;

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
    let emailForAuth: string;
    const lowerCaseUsername = username.toLowerCase();

    if (lowerCaseUsername === 'daniel') {
        emailForAuth = ADMIN_EMAIL;
    } else {
        emailForAuth = `${lowerCaseUsername}@${AUTH_EMAIL_DOMAIN}`;
    }

    const userCredential = await signInWithEmailAndPassword(auth, emailForAuth, password_used);
    const firebaseUser = userCredential.user;

    let operatorProfile: Operator | null = null;
    let operatorDocRef;

    if (lowerCaseUsername === 'daniel') {
        operatorDocRef = doc(db, "operators", "op-1");
        const adminSnap = await getDoc(operatorDocRef);
        if (adminSnap.exists()) {
             operatorProfile = adminSnap.data() as Operator;
             operatorProfile.id = adminSnap.id;
        } else {
            await signOut(auth);
            throw new Error("Profilo amministratore non trovato nel database. Contattare il supporto.");
        }
    } else {
        const operatorsRef = collection(db, 'operators');
        const q = query(operatorsRef, where("nome_normalized", "==", lowerCaseUsername));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            const operatorDoc = querySnapshot.docs[0];
            operatorDocRef = operatorDoc.ref;
            operatorProfile = operatorDoc.data() as Operator;
            operatorProfile.id = operatorDoc.id;
        }
    }
    
    if (!operatorProfile || !operatorDocRef) {
        await signOut(auth);
        throw new Error(`Profilo operatore per "${username}" non trovato nel database.`);
    }

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
