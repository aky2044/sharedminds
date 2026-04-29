/**
 * Firebase app singleton (Firestore-ready). Add feature imports as needed.
 * @see https://firebase.google.com/docs/web/setup
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

const firebaseConfig = {
  apiKey: "AIzaSyCA80l6BO-v_7Ch8qeZmWzrX68eLjtnYvs",
  authDomain: "smfinalproject-af233.firebaseapp.com",
  projectId: "smfinalproject-af233",
  storageBucket: "smfinalproject-af233.firebasestorage.app",
  messagingSenderId: "375004967486",
  appId: "1:375004967486:web:02958c13a2a8e33537976f",
};

export const firebaseApp = initializeApp(firebaseConfig);
