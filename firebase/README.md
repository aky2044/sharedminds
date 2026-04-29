# Firestore multiplayer scaffold

This folder documents **Firestore-only** persistence for temporary session state and paired players in real time. It intentionally avoids the Realtime Database.

## Collections

| Path | Purpose |
|------|---------|
| `sessions/{sessionId}` | Lobby + heartbeat + shared counters (`actionSeq`). Host creates; guest joins by writing `slots.guestUid`. |
| `sessions/{sessionId}/actions/{actionId}` | Append-only envelopes `{ fromRole, verb, payload, seq, sentAt }` mirroring what today flows through `doAction()` locally. |

Use composite indexes only if you filter/order beyond `seq` (Firebase CLI / console will prompt when needed).

## Security

Start from `firestore.rules` here (currently deny-all). Typical progression:

1. Require `request.auth != null`.
2. Allow read/write on `sessions/{sessionId}` only when `request.auth.uid` equals `resource.data.slots.hostUid` or `slots.guestUid`.
3. Allow creates on `actions/*` only for members of that session; validate `seq` increases via Cloud Function or trusted writer pattern.

## App bootstrap

`init.js` loads the Firebase JS SDK from `gstatic` and calls `initializeApp` with your web config. `main.js` imports it and sets `window.__firebaseApp` for debugging.

## Client wiring

See `sync-outline.js` for modular SDK imports (commented). Hook incoming snapshots into your router:

- Remote row `{ fromRole: "B", verb: "water", ... }` → apply the same delayed handlers `A_TO_B_MAP` / `B_TO_A_MAP` already use, or call shared helpers after validating `seq`.

## Env

Configure via Firebase Console → Project settings → Your apps → Web config object (`apiKey`, `projectId`, etc.). Do not commit secrets beyond the public web API key (restrict key by HTTP referrer in Google Cloud Console).
