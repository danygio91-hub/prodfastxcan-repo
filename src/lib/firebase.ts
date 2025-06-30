// Import the functions you need from the SDKs you need
import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// This is taken from your project settings and connects the app to your database.
const firebaseConfig = {
  apiKey: "AIzaSyCa40ioQz_fkKUWIXEKaLdNB4qct785uoU",
  authDomain: "prodfastxcan.firebaseapp.com",
  projectId: "prodfastxcan",
  storageBucket: "prodfastxcan.appspot.com",
  messagingSenderId: "724257897568",
  appId: "1:724257897568:web:2054074f18364ed0e91705",
  measurementId: "G-8XZHSKPWPP"
};

// Initialize Firebase
let app;
// Prevent Firebase from initializing multiple times, which can happen in development environments
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

const db = getFirestore(app);

// We export the db instance to be used in other parts of the application
export { db };
