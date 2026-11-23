import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    return true;
  }
}

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIREBASE_AUTH_SETTINGS_URL = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/settings`;

const isStandaloneFirebaseHost = () =>
  typeof window !== 'undefined' &&
  (window.location.hostname === `${firebaseConfig.projectId}.web.app` ||
    window.location.hostname === `${firebaseConfig.projectId}.firebaseapp.com`);

export async function checkRedirectAuthResult() {
  if (!isStandaloneFirebaseHost()) return null;
  try {
    return await getRedirectResult(auth);
  } catch {
    return null;
  }
}

export async function signInWithGoogle() {
  if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1') {
    const nextUrl = new URL(window.location.href);
    nextUrl.hostname = 'localhost';
    window.location.replace(nextUrl.toString());
    throw new Error('Redirigiendo a localhost para habilitar Google OAuth...');
  }
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Inside the standalone Android APK (.web.app), fall back to in-WebView redirect if popup is blocked/unsupported
    if (
      isStandaloneFirebaseHost() &&
      (msg.includes('popup-blocked') ||
        msg.includes('popup-closed-by-user') ||
        msg.includes('cancelled-popup-request') ||
        msg.includes('operation-not-supported'))
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw err;
  }
}

export async function signOutUser() {
  return signOut(auth);
}
