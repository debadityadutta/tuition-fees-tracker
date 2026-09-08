import { initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseReady = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId &&
  !firebaseConfig.apiKey.includes('YOUR_'),
)

let auth = null
let db = null

if (firebaseReady) {
  const app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = getFirestore(app)
}

export { auth, db }

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function ownerCredentials(name, dob) {
  const normalized = normalizeName(name)
  const hash = await sha256(`teach-fees-owner:${normalized}:${dob}`)

  // Firebase Auth needs an email-style identifier. The app never asks the user
  // for a real email address; this deterministic internal address is generated
  // from the entered name + DOB.
  const email = `tft-${hash.slice(0, 32)}@teachfees.app`
  const password = `DOB-${dob}-TFT`
  return { email, password }
}

export async function createOwnerAccount(name, dob) {
  if (!firebaseReady || !auth) throw new Error('Firebase is not configured.')
  const { email, password } = await ownerCredentials(name, dob)
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  return credential.user
}

export async function upgradeAnonymousOwner(name, dob) {
  if (!firebaseReady || !auth) throw new Error('Firebase is not configured.')
  if (!auth.currentUser?.isAnonymous) return createOwnerAccount(name, dob)

  const { email, password } = await ownerCredentials(name, dob)
  const credential = EmailAuthProvider.credential(email, password)
  const result = await linkWithCredential(auth.currentUser, credential)
  return result.user
}

export async function signInOwner(name, dob) {
  if (!firebaseReady || !auth) throw new Error('Firebase is not configured.')
  const { email, password } = await ownerCredentials(name, dob)
  const credential = await signInWithEmailAndPassword(auth, email, password)
  return credential.user
}

export async function signOutUser() {
  if (!auth) return
  await signOut(auth)
}

export async function getCurrentAuthUser() {
  if (!firebaseReady || !auth) return null

  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(
      auth,
      (user) => {
        stop()
        resolve(user)
      },
      (error) => {
        stop()
        reject(error)
      },
    )
  })
}

export async function ensureAnonymousUser() {
  if (!firebaseReady || !auth) return null
  if (auth.currentUser) return auth.currentUser

  await signInAnonymously(auth)

  if (auth.currentUser) return auth.currentUser

  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          stop()
          resolve(user)
        }
      },
      (error) => {
        stop()
        reject(error)
      },
    )
  })
}
