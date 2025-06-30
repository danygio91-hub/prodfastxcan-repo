// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  // ------------------------------------------------------------------
  // INSERISCI QUI LA CONFIGURAZIONE DEL TUO PROGETTO FIREBASE
  // La trovi in: Console Firebase > Impostazioni Progetto > Generale > Le tue app > App Web
  // Esempio:
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXX",
  authDomain: "tuo-progetto.firebaseapp.com",
  projectId: "tuo-progetto",
  storageBucket: "tuo-progetto.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:XXXXXXXXXXXXXXXXXXXXXX"
  // ------------------------------------------------------------------
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

export { db };
