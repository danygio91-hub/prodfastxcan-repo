'use server';
import { cookies } from 'next/headers';
import { adminAuth, adminDb } from './firebase-admin';

export interface AdminOperator {
  id: string;
  uid?: string;
  email?: string;
  role?: string;
  [key: string]: any;
}

/**
 * Legge il Session Cookie in modo sicuro e invalicabile.
 */
export async function getVerifiedUid(): Promise<string | null> {
  const cookieStore = cookies();
  const sessionCookie = cookieStore.get('session')?.value;
  if (!sessionCookie) return null;

  try {
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true);
    return decodedClaims.uid;
  } catch (error) {
    return null;
  }
}

async function getOperatorByUid(uid: string): Promise<AdminOperator | null> {
    if (!uid) return null;
    
    const operatorsRef = adminDb.collection("operators");
    const snapshot = await operatorsRef.where("uid", "==", uid).limit(1).get();

    if (snapshot.empty) {
        return null;
    }
    
    const doc = snapshot.docs[0];
    return { ...doc.data(), id: doc.id } as AdminOperator;
}

/**
 * Assicurati che l'utente sia un admin igniorando argomenti fasulli dal client.
 */
export async function ensureAdmin(clientUID_UNUSED?: string | undefined | null) {
  const trueUid = await getVerifiedUid();
  if (!trueUid) {
    throw new Error('Accesso Negato: Token di sessione assente o scaduto.');
  }
  
  const operator = await getOperatorByUid(trueUid);

  if (!operator || (operator.role !== 'admin' && operator.role !== 'supervisor')) {
    throw new Error('Permessi non sufficienti. Azione riservata ad amministratori o supervisori.');
  }
  
  return operator;
}

export async function extractUidFromFormData(formData: FormData): Promise<string> {
    const trueUid = await getVerifiedUid();
    if (!trueUid) {
        throw new Error('Accesso Negato: Autenticazione richiesta.');
    }
    return trueUid;
}
