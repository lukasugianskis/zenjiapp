// Migration: add `Username` field to user documents when missing
// Usage:
// 1. Install dependencies: `npm install firebase-admin`
// 2. Set service account JSON path: `export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json`
// 3. Run: `node scripts/add_username_migration.js`

const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (err) {
    console.error('Failed to initialize firebase-admin. Ensure GOOGLE_APPLICATION_CREDENTIALS is set.', err);
    process.exit(1);
  }
}

const db = admin.firestore();

async function run() {
  console.log('Starting Username migration...');
  const usersRef = db.collection('users');
  const snapshot = await usersRef.get();
  console.log(`Found ${snapshot.size} users.`);

  const batchSize = 500;
  let batch = db.batch();
  let ops = 0;
  let updated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    if (data.Username) continue;

    // find an email from common fields
    const email = data.email || data.contactEmail || (data.profile && data.profile.email) || (data.owner && data.owner.email) || null;
    if (!email) continue;

    const username = String(email).split('@')[0];
    batch.set(usersRef.doc(doc.id), { Username: username }, { merge: true });
    ops += 1;
    updated += 1;

    if (ops >= batchSize) {
      await batch.commit();
      console.log(`Committed batch of ${ops} updates...`);
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) {
    await batch.commit();
    console.log(`Committed final batch of ${ops} updates.`);
  }

  console.log(`Migration complete. Documents updated: ${updated}`);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
