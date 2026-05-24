// Backfill script: iterate all bookings and sync into /clients
const admin = require('firebase-admin');
const { syncBooking } = require('../functions/lib/syncClient');

async function main() {
  // Assumes GOOGLE_APPLICATION_CREDENTIALS is set when running locally
  admin.initializeApp();
  const db = admin.firestore();

  const snapshot = await db.collection('bookings').get();
  console.log('Bookings to process:', snapshot.size);
  let count = 0;
  for (const doc of snapshot.docs) {
    const bookingId = doc.id;
    const data = doc.data();
    try {
      await syncBooking(bookingId, data, db, admin);
      count += 1;
      if (count % 50 === 0) console.log('Processed', count);
    } catch (err) {
      console.error('Error processing', bookingId, err);
    }
  }
  console.log('Backfill complete. Processed:', count);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
