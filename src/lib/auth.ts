
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Operator } from './mock-data';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

const AUTH_KEY = 'prodtime_tracker_auth';
const AUTH_EMAIL_DOMAIN = 'prodfastxcan.app';
const ADMIN_EMAIL = `daniel.giorlando@${AUTH_EMAIL_DOMAIN}`;

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
 * Attempts to sign in a user with Firebase Auth.
 * It determines the correct email to use based on the input.
 */
export async function login(username: string, password_used: string) {
    let emailForAuth: string;

    if (username.toLowerCase() === 'daniel' || username.toLowerCase() === 'daniel.giorlando') {
        emailForAuth = ADMIN_EMAIL;
    } 
    else {
        emailForAuth = `${username.toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
    }

    return await signInWithEmailAndPassword(auth, emailForAuth, password_used);
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
