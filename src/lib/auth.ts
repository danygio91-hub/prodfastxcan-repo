
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Operator } from './mock-data';
import { initialOperators } from './mock-data';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

const AUTH_KEY = 'prodtime_tracker_auth';
const AUTH_EMAIL_DOMAIN = 'prodfastxcan.app';

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
  
  const operator = allOperators.find(op => 
    op.nome.toLowerCase() === username.toLowerCase()
  );

  if (!operator || operator.password !== password_used) {
    console.error("Operator not found in Firestore or password incorrect.");
    return null;
  }

  const email = `${operator.nome.toLowerCase()}.${operator.cognome.toLowerCase().replace(/\s+/g, '')}@${AUTH_EMAIL_DOMAIN}`;

  try {
    await signInWithEmailAndPassword(auth, email, password_used);
    
    if (typeof window !== 'undefined') {
      localStorage.setItem(AUTH_KEY, JSON.stringify(operator));
    }
    return operator;

  } catch (error: any) {
    console.error("Firebase Authentication failed:", error);
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        console.error(`L'utente con email ${email} non esiste in Firebase Authentication o le credenziali sono errate. Crealo dalla console di Firebase.`);
    }
    await logout();
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
