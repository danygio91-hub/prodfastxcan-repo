// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Your web app's Firebase configuration for the "prodfastxcan" project.
const firebaseConfig = {
  apiKey: "AIzaSyClGHZv_Q5MuagJfF-xzkdO3dAr6qCEuTQ",
  authDomain: "prodfastxcan.firebaseapp.com",
  projectId: "prodfastxcan",
  storageBucket: "prodfastxcan.appspot.com",
  messagingSenderId: "724257897568",
  appId: "1:724257897568:web:2054074f18364ed0e91705",
  measurementId: "G-8XZHSKPWPP"
};


// Initialize Firebase
let app;
// Prevent Firebase from initializing multiple times, which can happen in a dev environment
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

const db = getFirestore(app);
const auth = getAuth(app);

// We export the db and auth instances to be used in other parts of the application
export { db, auth };
