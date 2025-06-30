
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import type { Operator } from './mock-data';

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
  const q = query(
    operatorsRef, 
    where("nome", "==", username), 
    where("password", "==", password_used) // In production, use hashed passwords
  );

  try {
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      // For case-insensitive fallback, fetch all and filter in code
      const allOperatorsSnap = await getDocs(collection(db, "operators"));
      const allOperators = allOperatorsSnap.docs.map(doc => doc.data() as Operator);
      const operator = allOperators.find(op => 
        op.nome.toLowerCase() === username.toLowerCase() && op.password === password_used
      );

      if (operator && typeof window !== 'undefined') {
        const authDataToStore: AuthData = { loggedIn: true, operator };
        localStorage.setItem(AUTH_KEY, JSON.stringify(authDataToStore));
        return true;
      }
      return false;
    }

    const operator = querySnapshot.docs[0].data() as Operator;
    if (operator && typeof window !== 'undefined') {
      const authDataToStore: AuthData = { loggedIn: true, operator };
      localStorage.setItem(AUTH_KEY, JSON.stringify(authDataToStore));
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error logging in:", error);
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
    const authData = getAuthData();
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
