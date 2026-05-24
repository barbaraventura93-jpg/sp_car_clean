const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { syncBooking } = require('./lib/syncClient');

admin.initializeApp();
const db = admin.firestore();

exports.syncClientFromBooking = functions.firestore.document('bookings/{bookingId}').onWrite(async (change, context) => {
  const after = change.after.exists ? change.after.data() : null;
  if (!after) return null; // ignore deletes
  const bookingId = context.params.bookingId;
  try {
    await syncBooking(bookingId, after, db, admin);
  } catch (err) {
    console.error('syncClientFromBooking error', err);
    throw err;
  }
  return null;
});
