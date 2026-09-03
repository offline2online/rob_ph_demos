// Web app config for backlog-tracker's OWN Firebase project — get these
// values from Firebase Console → Project settings → General → Your apps
// (Web app), for the project you created for backlog-tracker specifically.
// This is a different project than the one menu-board-demo's Firebase
// config points at, so filling this in can't touch menu-board-demo.
//
// These values are not secret (they identify the project, not authorize
// access — Firestore security is enforced by firestore.rules), so it's
// normal for them to live in a committed file like this one.
export const firebaseConfig = {
  apiKey: "REPLACE-ME",
  authDomain: "REPLACE-ME.firebaseapp.com",
  projectId: "REPLACE-WITH-YOUR-NEW-FIREBASE-PROJECT-ID",
  storageBucket: "REPLACE-ME.appspot.com",
  messagingSenderId: "REPLACE-ME",
  appId: "REPLACE-ME",
};
