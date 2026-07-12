const dbUrl = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
const dbSecret = process.env.FIREBASE_DATABASE_SECRET;

// dbPath is the single choke-point for future multi-tenant migration.
// To prefix /tenants/{tenantId}, change only this function.
function dbPath(node) {
  return node.startsWith('/') ? node : '/' + node;
}

async function dbGet(node) {
  const resp = await fetch(`${dbUrl}${dbPath(node)}.json?auth=${dbSecret}`);
  if (!resp.ok) throw new Error(`Firebase GET ${node}: ${resp.status}`);
  return resp.json();
}

async function dbSet(node, value) {
  const resp = await fetch(`${dbUrl}${dbPath(node)}.json?auth=${dbSecret}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!resp.ok) throw new Error(`Firebase PUT ${node}: ${resp.status}`);
  return resp.json();
}

async function dbPatch(node, value) {
  const resp = await fetch(`${dbUrl}${dbPath(node)}.json?auth=${dbSecret}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!resp.ok) throw new Error(`Firebase PATCH ${node}: ${resp.status}`);
  return resp.json();
}

async function dbPush(node, value) {
  const resp = await fetch(`${dbUrl}${dbPath(node)}.json?auth=${dbSecret}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!resp.ok) throw new Error(`Firebase POST ${node}: ${resp.status}`);
  return resp.json();
}

async function dbDelete(node) {
  await fetch(`${dbUrl}${dbPath(node)}.json?auth=${dbSecret}`, { method: 'DELETE' });
}

module.exports = { dbPath, dbGet, dbSet, dbPatch, dbPush, dbDelete };
