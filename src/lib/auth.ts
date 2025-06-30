
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Operator } from './mock-data';
import { initialOperators } from './mock-data';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

const AUTH_KEY = 'prodtime_tracker_auth';
const AUTH_EMAIL_DOMAIN = 'prodfastxcan.app';

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
  
  let operator: Operator | undefined;
  let emailForAuth: string;

  if (username.includes('@')) {
    // User entered an email address
    emailForAuth = username.toLowerCase();
    const nameFromEmail = emailForAuth.split('@')[0].split('.')[0];
    operator = allOperators.find(op => op.nome.toLowerCase() === nameFromEmail);
  } else {
    // User entered a username (first name)
    operator = allOperators.find(op => 
      op.nome.toLowerCase() === username.toLowerCase()
    );
    if (operator) {
      emailForAuth = `${operator.nome.toLowerCase()}.${operator.cognome.toLowerCase().replace(/\s+/g, '')}@${AUTH_EMAIL_DOMAIN}`;
    } else {
      console.error(`No operator profile found for username: ${username}`);
      return null;
    }
  }

  // If we couldn't find an operator profile, we can't proceed.
  if (!operator) {
    console.error(`No operator profile found for username/email: ${username}`);
    return null;
  }

  try {
    // Authenticate directly with Firebase Auth. This is the source of truth for passwords.
    await signInWithEmailAndPassword(auth, emailForAuth, password_used);
    
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
