
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import type { Operator } from './mock-data';
import { initialOperators } from './mock-data';

const AUTH_KEY = 'prodtime_tracker_auth';

interface AuthData {
  loggedIn: boolean;
  operator: Operator;
}

function getAuthData(): AuthData | null {
  if (typeof window !== 'undefined') {
    const authDataString = localStorage.getItem(AUTH_KEY);
    if (authDataString) {
      try {
        return JSON.parse(authDataString) as AuthData;
      } catch (e) {
        console.error("Failed to parse auth data from localStorage", e);
        localStorage.removeItem(AUTH_KEY);
        return null;
      }
    }
  }
  return null;
}

export async function login(username: string, password_used: string): Promise<boolean> {
  const operatorsRef = collection(db, "operators");

  try {
    const allOperatorsSnap = await getDocs(operatorsRef);

    let operator: Operator | undefined;

    if (!allOperatorsSnap.empty) {
      // The database has users, so we authenticate against Firestore.
      const allOperators = allOperatorsSnap.docs.map(doc => doc.data() as Operator);
      operator = allOperators.find(op => 
        op.nome.toLowerCase() === username.toLowerCase() && op.password === password_used
      );
    } else {
      // The database is empty. This is likely the first run, so we
      // authenticate against the hardcoded initial operators as a fallback.
      console.log("Firestore 'operators' collection is empty. Falling back to initial mock data for login.");
      operator = initialOperators.find(op =>
        op.nome.toLowerCase() === username.toLowerCase() && op.password === password_used
      );
    }

    if (operator && typeof window !== 'undefined') {
      const authDataToStore: AuthData = { loggedIn: true, operator };
      localStorage.setItem(AUTH_KEY, JSON.stringify(authDataToStore));
      return true;
    }

    // If we reach here, no user was found.
    return false;

  } catch (error) {
    console.error("Error logging in from Firestore:", error);
    // If there's a network error connecting to Firestore, we can also fallback to the mock data.
    // This allows login even if Firebase is temporarily unreachable.
    console.log("Attempting login against local mock data due to Firestore error.");
    const operator = initialOperators.find(op =>
        op.nome.toLowerCase() === username.toLowerCase() && op.password === password_used
    );
    if (operator && typeof window !== 'undefined') {
        const authDataToStore: AuthData = { loggedIn: true, operator };
        localStorage.setItem(AUTH_KEY, JSON.stringify(authDataToStore));
        return true;
    }
    return false;
  }
}

export function logout(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(AUTH_KEY);
  }
}

export function isAuthenticated(): boolean {
  const authData = getAuthData();
  return authData?.loggedIn === true;
}

export function getOperator(): Operator | null {
  if (typeof window !== 'undefined') {
    const authData = getAuth-data();
    return authData?.operator || null;
  }
  return null;
}

export function getOperatorName(): string | null {
  const operator = getOperator();
  return operator ? `${operator.nome} ${operator.cognome}` : null;
}

export function isAdmin(): boolean {
  const operator = getOperator();
  return operator?.role === 'admin';
}

export function isSuperadvisor(): boolean {
  const operator = getOperator();
  return operator?.role === 'superadvisor';
}
