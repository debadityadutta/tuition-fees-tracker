# Teach Fees Tracker — Firebase Login + Sync

This version adds a Firebase-backed owner account that signs in with **Name + Date of Birth**, while keeping the 4/6-digit read-only Viewer Mode.

## Firebase setup

### 1. Authentication
In Firebase Console → Authentication → Sign-in method, enable:

- **Email/Password** — used internally for the owner account. The app creates an internal Firebase identifier from the entered Name + DOB; the user is not asked for an email address.
- **Anonymous** — used by Viewer Mode.

### 2. Firestore
Create a Firestore database, then open Firestore → Rules and replace the rules with the contents of `firestore.rules`. Publish them.

The database uses:

- `users/{uid}` — private owner account mapping, including workspace ID and DOB. Only that signed-in owner can read this document.
- `workspaces/{workspaceId}` — teachers, monthly fees, and payment data. Only the owner UID can write. Authenticated viewers can read a workspace when they know its viewer code-derived document ID.

The owner's DOB is **not stored in the viewer-readable workspace document**.

### 3. Firebase Web App config
Copy `.env.example` to `.env`:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Restart Vite after editing `.env`.

## Run locally

```bash
npm install
npm run dev
```

## Owner flow

First device:

1. Create account
2. Enter Name
3. Enter Date of Birth
4. Choose a 4 or 6 digit Viewer Code (6 digits recommended)
5. Add teachers and payments

Another device:

1. Open the same hosted app
2. Choose Sign in
3. Enter the same Name + Date of Birth
4. The same Firestore tracker opens with owner edit access

## Viewer flow

Choose Viewer Mode and enter the viewer code. Viewer Mode can see synced records but cannot change Firestore data because its Firebase UID does not match `ownerUid`.

## Deploy to Firebase Hosting

Make sure `firebase.json` uses `dist` as the Hosting public directory. Then:

```bash
npm run build
firebase deploy --only hosting
```

## Security note

DOB-only login is intentionally simple, but a date of birth is easier to guess than a normal password. This app uses Firebase Authentication and Firestore rules for access control, but for stronger security add a PIN/password in addition to DOB later. Use a 6-digit viewer code rather than a 4-digit one.

### Upgrading the older anonymous-owner version

If this browser still has the old owner session and `teachFees.ownerWorkspace` data in local storage, choosing **Create account** with the same viewer code upgrades that anonymous Firebase user to the new Name + DOB account while keeping the existing Firestore workspace and owner UID.
