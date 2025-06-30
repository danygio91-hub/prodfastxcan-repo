
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Operator } from './mock-data';
import { initialOperators } from './mock-data';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

const AUTH_KEY = 'prodtime_tracker_auth';
const AUTH_EMAIL_DOMAIN = 'prodfastxcan.app';
const ADMIN_EMAIL = `daniel.giorlando@${AUTH_EMAIL_DOMAIN}`;

export async function login(username: string, password_used: string): Promise<Operator | null> {
  let allOperators: Operator[] = [];
  try {
    const operatorsSnap = await getDocs(collection(db, "operators"));
    if (!operatorsSnap.empty) {
      allOperators = operatorsSnap.docs.map(doc => doc.data() as Operator);
    } else {
      console.warn("Firestore 'operators' collection is empty. Falling back to initial mock data for login.");
      allOperators = initialOperators;
    }
  } catch (error) {
    console.error("Error fetching operators from Firestore, falling back to mock data:", error);
    allOperators = initialOperators;
  }
  
  let emailForAuth: string;

  // Determine the email to use for authentication
  if (username.toLowerCase() === 'daniel') {
      // Specific fix for the admin user to bypass potentially stale data in DB
      emailForAuth = ADMIN_EMAIL;
  } else if (username.includes('@')) {
    emailForAuth = username.toLowerCase();
  } else {
    // For other users, find them by name and construct the email
    const operatorByName = allOperators.find(op => op.nome.toLowerCase() === username.toLowerCase());
    if (operatorByName) {
      emailForAuth = `${operatorByName.nome.toLowerCase()}.${operatorByName.cognome.toLowerCase().replace(/\s+/g, '')}@${AUTH_EMAIL_DOMAIN}`;
    } else {
      console.error(`No operator profile found for username: ${username}`);
      return null;
    }
  }

  try {
    // Authenticate with Firebase Auth. This is the source of truth for the password.
    const userCredential = await signInWithEmailAndPassword(auth, emailForAuth, password_used);
    const authenticatedUser = userCredential.user;
    
    // Now that we are authenticated, find the corresponding operator profile from our DB
    const nameFromEmail = authenticatedUser.email?.split('@')[0].split('.')[0];
    let operator = allOperators.find(op => op.nome.toLowerCase() === nameFromEmail);

    if (!operator) {
        console.error(`Authentication successful for ${authenticatedUser.email}, but no matching operator profile found in the database.`);
        await logout();
        return null;
    }

    // --- Safeguard and Data Correction ---
    // If the logged-in user is the admin, ensure their role is 'admin'
    // and correct their data in Firestore if it's inconsistent.
    if (authenticatedUser.email === ADMIN_EMAIL) {
      const needsUpdate = operator.role !== 'admin' || operator.cognome !== 'Giorlando';
      
      operator.role = 'admin';
      operator.cognome = 'Giorlando';
      
      if (needsUpdate) {
        try {
          const operatorRef = doc(db, "operators", operator.id);
          await updateDoc(operatorRef, {
            role: 'admin',
            cognome: 'Giorlando'
          });
          console.log(`Admin operator record for ${operator.id} was corrected in Firestore.`);
        } catch (updateError) {
          console.error("Failed to correct admin operator record in Firestore:", updateError);
          // Don't fail the login, just log the error. The role is already corrected in memory.
        }
      }
    }
    
    // If login is successful, store operator data and return it.
    if (typeof window !== 'undefined') {
      const { password, ...operatorToStore } = operator;
      localStorage.setItem(AUTH_KEY, JSON.stringify(operatorToStore));
    }
    return operator;

  } catch (error: any) {
    console.error("Firebase Authentication failed:", error.code, error.message);
    await logout(); // Ensure any partial state is cleared
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
