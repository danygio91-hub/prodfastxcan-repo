
import { collection, getDocs, doc, setDoc, query, where } from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Operator } from './mock-data';
import { signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';

const AUTH_KEY = 'prodtime_tracker_auth';
const AUTH_EMAIL_DOMAIN = 'prodfastxcan.app';

// Helper to store operator data in local storage
export const storeOperator = (operator: Operator | null) => {
    if (typeof window !== 'undefined') {
        if (operator === null) {
            localStorage.removeItem(AUTH_KEY);
        } else {
            // Do not store password in local storage
            const { password, ...operatorToStore } = operator;
            localStorage.setItem(AUTH_KEY, JSON.stringify(operatorToStore));
        }
    }
};

/**
 * Attempts to sign in a user with Firebase Auth. The onAuthStateChanged listener
 * in AuthProvider is responsible for handling the result of this action.
 */
export async function login(username: string, password_used: string): Promise<void> {
    const lowerCaseUsername = username.trim().toLowerCase();
    const emailForAuth = `${lowerCaseUsername}@${AUTH_EMAIL_DOMAIN}`;

    // The onAuthStateChanged listener will handle finding the profile and linking the UID.
    // This function's only job is to perform the authentication.
    await signInWithEmailAndPassword(auth, emailForAuth, password_used);
}

/**
 * Signs the user out of Firebase.
 */
export async function logout(): Promise<void> {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out from Firebase:", error);
    throw error;
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
