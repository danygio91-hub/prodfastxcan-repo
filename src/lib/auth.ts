import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Operator } from './mock-data';
import { initialOperators } from './mock-data';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

const AUTH_KEY = 'prodtime_tracker_auth';
const AUTH_EMAIL_DOMAIN = 'prodfastxcan.app';
const ADMIN_EMAIL = `daniel.giorlando@${AUTH_EMAIL_DOMAIN}`;

export async function login(username: string, password_used: string): Promise<Operator | null> {
  let emailForAuth: string;

  // Handle both username and email input
  if (username.toLowerCase() === 'daniel') {
      emailForAuth = ADMIN_EMAIL;
  } else if (username.includes('@')) {
    emailForAuth = username.toLowerCase();
  } else {
    // This is for other users logging in with just their name
    // We need to fetch operators to construct the email from the name
    const operatorsSnap = await getDocs(collection(db, "operators"));
    const allOperators = operatorsSnap.docs.map(doc => doc.data() as Operator);
    const operatorByName = allOperators.find(op => op.nome.toLowerCase() === username.toLowerCase());
    if (operatorByName) {
      emailForAuth = `${operatorByName.nome.toLowerCase()}.${operatorByName.cognome.toLowerCase().replace(/\s+/g, '')}@${AUTH_EMAIL_DOMAIN}`;
    } else {
      console.error(`No operator profile found for username: ${username}`);
      return null;
    }
  }

  try {
    const userCredential = await signInWithEmailAndPassword(auth, emailForAuth, password_used);
    const authenticatedUser = userCredential.user;

    // --- Admin Safeguard ---
    if (authenticatedUser.email === ADMIN_EMAIL) {
      const adminProfile = initialOperators.find(op => op.role === 'admin');
      if (!adminProfile) {
        console.error("Critical error: Admin profile not found in mock data.");
        await logout();
        return null;
      }
      
      const operator = { ...adminProfile }; // Use a copy
      
      // Ensure the data in Firestore is also correct for the future.
      try {
        const operatorRef = doc(db, "operators", operator.id);
        await setDoc(operatorRef, operator, { merge: true }); // Overwrite/correct the DB record
      } catch (updateError) {
        console.error("Failed to correct admin operator record in Firestore:", updateError);
      }
      
      // Store and return the guaranteed admin profile
      if (typeof window !== 'undefined') {
        const { password, ...operatorToStore } = operator;
        localStorage.setItem(AUTH_KEY, JSON.stringify(operatorToStore));
      }
      return operator;
    } else {
      // --- Logic for non-admin users ---
      const operatorsSnap = await getDocs(collection(db, "operators"));
      const allOperators = operatorsSnap.docs.map(doc => doc.data() as Operator);
      // Derive name from email, e.g., "john.doe@domain.com" -> "john"
      const nameFromEmail = authenticatedUser.email?.split('@')[0].split('.')[0];
      const operator = allOperators.find(op => op.nome.toLowerCase() === nameFromEmail?.toLowerCase());

      if (!operator) {
          console.error(`Authentication successful for ${authenticatedUser.email}, but no matching operator profile found in the database.`);
          await logout();
          return null;
      }
      
      if (typeof window !== 'undefined') {
        const { password, ...operatorToStore } = operator;
        localStorage.setItem(AUTH_KEY, JSON.stringify(operatorToStore));
      }
      return operator;
    }

  } catch (error: any) {
    console.error("Firebase Authentication failed:", error.code, error.message);
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
