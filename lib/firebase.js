import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function getFirebaseAdmin() {
  if (getApps().length > 0) return getApps()[0];

  const projectId  = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Strip surrounding quotes and trailing comma (dotenv artifact when value ends with ,)
  const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
  const privateKey = rawKey
    .replace(/^"/, '')        // strip leading quote (dotenv artifact from trailing comma in .env)
    .replace(/",?$/, '')      // strip trailing quote + optional comma
    .replace(/\\n/g, '\n') || undefined;

  if (!projectId || !clientEmail || !privateKey) return null;

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

export function getDb() {
  const app = getFirebaseAdmin();
  if (!app) return null;
  return getFirestore(app);
}
