// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Your web app's Firebase configuration for the "prodfastxcanwork" project.
const firebaseConfig = {
  "projectId": "prodfastxcanwork",
  "appId": "1:793652075129:web:10e9f4b5714498875792a8",
  "storageBucket": "prodfastxcanwork.appspot.com",
  "apiKey": "AIzaSyBOVtLee0ERy-ZEcdQVaaZnM6F0TWL7zIo",
  "authDomain": "prodfastxcanwork.firebaseapp.com",
  "messagingSenderId": "793652075129"
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
