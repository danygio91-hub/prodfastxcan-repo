
'use server';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import type { Operator } from './mock-data';

/**
 * Fetches an operator profile from Firestore by their Firebase Auth UID.
 * This is a secure way to identify a user on the server.
 * @param uid The Firebase Auth User ID.
 * @returns The operator profile or null if not found.
 */
async function getOperatorByUid(uid: string): Promise<Operator | null> {
    if (!uid) return null;
    
    const q = query(collection(db, "operators"), where("uid", "==", uid));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        return null;
    }
    
    const operatorDoc = querySnapshot.docs[0];
    return operatorDoc.data() as Operator;
}


/**
 * Ensures the user associated with the UID is an admin.
 * Throws an error if the user is not an admin or doesn't exist.
 * This should be called at the beginning of any admin-only server action.
 * @param uid The Firebase Auth User ID of the user performing the action.
 */
export async function ensureAdmin(uid: string | undefined | null) {
  if (!uid) {
    throw new Error('Autenticazione richiesta. Accesso negato.');
  }
  
  const operator = await getOperatorByUid(uid);

  if (!operator || operator.role !== 'admin') {
    throw new Error('Permessi non sufficienti. Azione riservata agli amministratori.');
  }
  
  return operator;
}

/**
 * Extracts a user UID from FormData and validates it.
 * @param formData The FormData from the client.
 * @returns The UID string.
 * @throws An error if the UID is missing.
 */
export async function extractUidFromFormData(formData: FormData): Promise<string> {
    const uid = formData.get('uid') as string;
    if (!uid) {
        throw new Error('UID utente mancante. Impossibile procedere.');
    }
    return uid;
}
