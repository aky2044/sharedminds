/**
 * Outline for wiring Firebase Auth + Firestore listeners into `doAction` /
 * pacing — drop-in once `firebase` is configured (not bundled by default).
 *
 * Install: npm install firebase  OR load compat/SDK via CDN (adjust imports below).
 *
 * Expected wiring:
 * - Authenticated users read/write only docs tagged with their uid (`slots.hostUid` / `guestUid`).
 * - Actions append-only document IDs (`auto-id`) ordered by `seq` client-side.
 * - Heartbeat on session doc (`lastSeenHost`, `lastSeenGuest`) for disconnect handling.
 */

/*
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {}; // from Firebase console

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export async function ensureSignedIn() {
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser.uid;
}

export function subscribeSession(sessionId, onSession, onError) {
  const ref = doc(db, "sessions", sessionId);
  return onSnapshot(ref, onSession, onError);
}

export function subscribeIncomingActions(sessionId, sinceSeq, onRows) {
  const q = query(
    collection(db, "sessions", sessionId, "actions"),
    orderBy("seq", "asc"),
    limit(64),
  );
  return onSnapshot(q, (snap) => {
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    onRows(rows.filter((r) => r.seq > sinceSeq));
  });
}

export async function proposeRemoteAction(sessionId, remotePayload) {
  const uid = await ensureSignedIn();
  await runTransaction(db, async (tx) => {
    const sRef = doc(db, "sessions", sessionId);
    const snap = await tx.get(sRef);
    const data = snap.data();
    if (!data || ![data.slots.hostUid, data.slots.guestUid].includes(uid)) {
      throw new Error("not_in_session");
    }
    const nextSeq = (data.actionSeq ?? 0) + 1;
    tx.update(sRef, { actionSeq: nextSeq, updatedAt: serverTimestamp() });
    const aRef = doc(collection(db, "sessions", sessionId, "actions"));
    tx.set(aRef, {
      ...remotePayload,
      seq: nextSeq,
      sentAt: serverTimestamp(),
    });
  });
}
*/

export const SYNC_README = "See README.md in this folder for indexes + rules.";
