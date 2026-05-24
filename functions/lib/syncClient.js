const ensureTimestamp = (admin, value) => {
  if (!value) return null;
  if (value instanceof admin.firestore.Timestamp) return value;
  const d = new Date(value);
  if (isNaN(d)) return null;
  return admin.firestore.Timestamp.fromDate(d);
};

async function syncBooking(bookingId, bookingData, db, admin) {
  if (!bookingData || !bookingData.email) return null;
  const { name, phone, email, cpf, vehicle = {}, service, date, price = 0, status } = bookingData;

  const clientsRef = db.collection('clients');
  const q = await clientsRef.where('email', '==', email).limit(1).get();
  let clientRef;
  const now = admin.firestore.FieldValue.serverTimestamp();
  if (q.empty) {
    clientRef = await clientsRef.add({ name, phone, email, cpf, createdAt: now, updatedAt: now });
  } else {
    clientRef = q.docs[0].ref;
    await clientRef.set({ name, phone, email, cpf, updatedAt: now }, { merge: true });
  }

  // Upsert vehicle (prefer plate when available)
  const vehiclesRef = clientRef.collection('vehicles');
  const plate = (vehicle.plate || '').trim().toUpperCase();
  let vehicleRef;
  if (plate) {
    const vq = await vehiclesRef.where('plate', '==', plate).limit(1).get();
    if (vq.empty) {
      vehicleRef = await vehiclesRef.add({ ...vehicle, plate, createdAt: now, updatedAt: now });
    } else {
      vehicleRef = vq.docs[0].ref;
      await vehicleRef.set({ ...vehicle, plate, updatedAt: now }, { merge: true });
    }
  } else {
    // try to match by brand+model+year as fallback
    const fallbackQ = await vehiclesRef.where('brand', '==', vehicle.brand || '').where('model', '==', vehicle.model || '').limit(1).get();
    if (fallbackQ.empty) {
      vehicleRef = vehiclesRef.doc();
      await vehicleRef.set({ ...vehicle, createdAt: now, updatedAt: now }, { merge: true });
    } else {
      vehicleRef = fallbackQ.docs[0].ref;
      await vehicleRef.set({ ...vehicle, updatedAt: now }, { merge: true });
    }
  }

  // appointment under client using bookingId as doc id
  const apptRef = clientRef.collection('appointments').doc(bookingId);
  const apptData = {
    bookingId,
    date: ensureTimestamp(admin, date) || now,
    service,
    vehicleId: vehicleRef.id,
    vehicleSnapshot: vehicle,
    price: Number(price) || 0,
    status: status || 'booked',
    updatedAt: now,
    createdAt: now
  };
  await apptRef.set(apptData, { merge: true });

  // Recalculate aggregated financials (totalSpent, lastVisit, completedCount)
  const completed = await clientRef.collection('appointments').where('status', '==', 'completed').get();
  let total = 0;
  let lastVisit = null;
  let completedCount = 0;
  completed.forEach(doc => {
    const a = doc.data();
    total += (a.price || 0);
    const adate = a.date && a.date.toDate ? a.date.toDate() : null;
    if (adate && (!lastVisit || adate > lastVisit)) lastVisit = adate;
    completedCount += 1;
  });

  // compute average frequency in days if we have at least 2 completed visits
  let avgFrequencyDays = null;
  const completedDates = [];
  completed.forEach(doc => {
    const a = doc.data();
    const adate = a.date && a.date.toDate ? a.date.toDate() : null;
    if (adate) completedDates.push(adate);
  });
  if (completedDates.length >= 2) {
    completedDates.sort((a, b) => a - b);
    const diffs = [];
    for (let i = 1; i < completedDates.length; i++) {
      const diffMs = completedDates[i] - completedDates[i - 1];
      diffs.push(diffMs / (1000 * 60 * 60 * 24));
    }
    const sum = diffs.reduce((s, v) => s + v, 0);
    avgFrequencyDays = sum / diffs.length;
  }

  // VIP heuristics (configurable via env vars)
  const VIP_TOTAL = Number(process.env.VIP_TOTAL_SPENT || process.env.VIP_TOTAL || 1000);
  const VIP_MIN_VISITS = Number(process.env.VIP_MIN_VISITS || 3);
  const VIP_RECENT_DAYS = Number(process.env.VIP_RECENT_DAYS || 365);
  // count recent completed visits
  const recentCutoff = new Date(Date.now() - VIP_RECENT_DAYS * 24 * 60 * 60 * 1000);
  let recentVisits = 0;
  completedDates.forEach(d => { if (d >= recentCutoff) recentVisits += 1; });
  const vip = (total >= VIP_TOTAL) || (recentVisits >= VIP_MIN_VISITS);

  await clientRef.set({
    totalSpent: total,
    lastVisit: lastVisit ? admin.firestore.Timestamp.fromDate(lastVisit) : null,
    completedCount,
    avgFrequencyDays,
    vip,
    updatedAt: now
  }, { merge: true });

  return { clientId: clientRef.id, vehicleId: vehicleRef.id };
}

module.exports = { syncBooking };
