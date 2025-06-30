
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
  
  // Find operator by username to get their full details (like cognome for email)
  const operator = allOperators.find(op => 
    op.nome.toLowerCase() === username.toLowerCase()
  );

  // If we can't find an operator profile in our DB, we can't proceed.
  if (!operator) {
    console.error(`No operator profile found for username: ${username}`);
    return null;
  }

  // Construct the email address that should exist in Firebase Auth.
  const email = `${operator.nome.toLowerCase()}.${operator.cognome.toLowerCase().replace(/\s+/g, '')}@${AUTH_EMAIL_DOMAIN}`;

  try {
    // Authenticate directly with Firebase Auth. This is the source of truth for passwords.
    await signInWithEmailAndPassword(auth, email, password_used);
    
    // If login is successful, store operator data and return it.
    if (typeof window !== 'undefined') {
      // We don't want to store the password in localStorage.
      const { password, ...operatorToStore } = operator;
      localStorage.setItem(AUTH_KEY, JSON.stringify(operatorToStore));
    }
    return operator;

  } catch (error: any) {
    console.error("Firebase Authentication failed:", error.code, error.message);
    // Let the UI know that the credentials were bad or the user doesn't exist in Auth.
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
