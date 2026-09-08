# Teach Fees Tracker

A responsive web application for managing tuition teachers, monthly fees, payment status, and synced viewer-only access.

## Features

- Create an owner account using Name + Date of Birth
- Sign in from another device and access the same synced tracker
- Add, edit, and delete tuition teachers
- Store teacher name, subject, monthly fee, and joining date
- Track monthly Paid / Unpaid status
- Save payment dates
- View yearly payment overview
- Generate a 4 or 6 digit Viewer Code
- Viewer Mode can see all synced details but cannot edit them
- Responsive design for mobile and desktop
- Installable as a Progressive Web App (PWA)
- Real-time cloud sync with Firebase Firestore

## Technologies Used

- React
- JavaScript (JSX)
- CSS
- Vite
- Firebase Authentication
- Cloud Firestore
- Firebase Hosting
- Firestore Security Rules
- Lucide React
- Vite PWA Plugin
- Responsive Web Design

## Technical Details

- Firebase Email/Password Authentication is used internally for owner accounts.
- Firebase Anonymous Authentication is used for Viewer Mode.
- Firestore `onSnapshot` is used for real-time synced updates.
- Firestore Security Rules keep owner editing access separate from viewer read-only access.
- The browser Web Crypto API is used for SHA-256 hashing when generating internal identifiers.
- Local Storage is used for migration compatibility with the older version of the app.
- PWA support allows the app to be installed on supported phones and computers.

## Owner Mode

The owner can:

- Add teachers
- Edit teacher details
- Delete teachers
- Change Paid / Unpaid status
- Set payment dates
- View monthly and yearly records

## Viewer Mode

A viewer enters the owner's 4 or 6 digit Viewer Code.

Viewer Mode can:

- View teachers
- View monthly fees
- View payment status
- View payment dates
- View yearly records

Viewer Mode cannot add, edit, delete, or change payment data.

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Firebase Setup

Create a `.env` file using the values shown in `.env.example`:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Enable these Firebase Authentication methods:

- Email/Password
- Anonymous

Create a Firestore database and publish the included `firestore.rules`.

## Deployment

The project is configured for Firebase Hosting.

```bash
npm run build
firebase deploy --only hosting
```

## Developer

**Debaditya Dutta**

Class XI student and aspiring web developer from Berhampore, West Bengal.

Interested in web development, coding, responsive design, and building useful web applications.
