# AD JOY PANEL — COD Collection Firebase setup

## Current implementation
- GitHub Pages UI: `pages/cod-collection/`
- Firebase project: `adjoy-rider-tracker` (same project/authentication session as the existing Rider KM Tracker)
- Firestore collection path: `users/{signedInUid}/codDailyRecords/{YYYY-MM-DD}`
- One document per Bangladesh work date, with `riders`, `agent`, `revision`, `updatedAt`, and `expiresAt` fields.
- `expiresAt` is a Firestore Timestamp set to the **start of the day 30 days after the work date, Asia/Dhaka**.
- When COD Collection opens, the app deletes expired documents that it can access, loads cloud days, and migrates nonexpired local-only records **without overwriting existing cloud days**.
- Day records do **not** update live while the panel is already open on another device. Use **Refresh Cloud** or reopen COD Collection. Concurrent changes to the same date are rejected instead of silently overwriting.
- Cloud writes are queued and use Firestore transactions. On a save conflict/failure, export a JSON backup before reloading.
- Backup JSON / CSV remain available. Backup restore adds missing, nonexpired days without replacing existing cloud days.
- The Rider KM integration still stores confirmed COD Due as a separate ledger **deduction**, never a new KM earning.

## ONE-TIME SETUP REQUIRED — Firestore access rules

The existing Rider KM Tracker uses `users/{uid}` and the COD panel uses a **subcollection**, so rules for the parent document alone may not grant access to `codDailyRecords`.

Open https://console.firebase.google.com/project/adjoy-rider-tracker/firestore/rules

Add the following nested match within your existing `match /databases/{database}/documents { ... }` rules, then **Publish**. Keep existing Rider KM Tracker rules intact.

```firestore-rules
match /users/{userId}/codDailyRecords/{workDate} {
  allow read, write: if request.auth != null
                     && request.auth.uid == userId;
}
```

Do **not** replace all the existing rules with this snippet. It is only for the new collection. A permission-denied error when COD loads usually means this nested permission is missing.

## ONE-TIME SETUP REQUIRED — server-side deletion after 30 days

To delete old data **even if no one opens the website**, enable a Firestore TTL policy in Google Cloud:

1. Open https://console.cloud.google.com/firestore/databases?project=adjoy-rider-tracker
2. Select the Firestore database used by the existing Rider KM Tracker (typically `(default)`).
3. In the Firestore database menu open **Time-to-live** → **Create Policy**.
4. **Collection group**: `codDailyRecords`
5. **Timestamp field**: `expiresAt`
6. **Expiration offset**: `0` (the date is already 30 days in the future).
7. Create the policy and verify it becomes active.

Firestore TTL is **asynchronous**: eligible documents are normally deleted within around 24 hours after expiry, not at the exact second. TTL deletes can incur Firestore delete-operation charges. If the policy has not been enabled, the app still tries to clean up expired documents **when you open COD Collection**, but cannot guarantee cleanup while nobody is using it.

Official documentation: https://firebase.google.com/docs/firestore/ttl

## Test checklist

1. Sign into the existing Operations Panel; open COD Collection.
2. Check the blue status message changes to `Firebase connected · All changes saved`.
3. Set a new work date, add Panel COD and a small sample Cash payment, and wait until the status returns to **All changes saved**.
4. Refresh COD Collection or open it on another signed-in device: data should reappear.
5. Confirm a document exists at `users/{uid}/codDailyRecords/{YYYY-MM-DD}` in Firestore Console; it should contain a native Timestamp field `expiresAt`.
6. Try the **Refresh Cloud** button.
7. Verify **Backup JSON** exports before allowing the first month of data to expire.
8. Check the existing KM Tracker still opens, and test COD → KM only with a test rider/due you are willing to record.

### Limitations

- The app can verify a successful Firestore write, but cannot itself enable TTL policies or publish Firestore rules.
- Existing local-only data that is already over 30 days old is **not migrated**, by design.
- No email or financial transaction is sent automatically.
