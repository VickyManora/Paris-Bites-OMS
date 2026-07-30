const API = 'http://localhost:4000/api/v1';
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }),
});
const lb = await login.json();
if (!lb.success) { console.error('login failed', lb.error); process.exit(1); }
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const token = lb.data?.accessToken ?? lb.data?.tokens?.accessToken;
const auth = { ...H, ...(cookie && { Cookie: cookie }), ...(token && { Authorization: `Bearer ${token}` }) };

const menu = await (await fetch(`${API}/pos/menu`, { headers: auth })).json();
const product = (menu.data.categories ?? menu.data).flatMap((c) => c.products).find((p) => p.isAvailable);
console.log(`using product: ${product.name} @ ₹${product.price}\n`);

const body = (method = 'CASH') => JSON.stringify({
  lines: [{ productId: product.id, quantity: 2 }],
  discountType: 'NONE', discountValue: 0,
  payment: { method },
});

const before = await (await fetch(`${API}/pos/orders?page=1&pageSize=1`, { headers: auth })).json();
const countBefore = before.meta.pagination.total;

// --- 1. same Idempotency-Key twice, as a lost-reply retry would ---
const key = crypto.randomUUID();
const first = await (await fetch(`${API}/pos/orders`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': key }, body: body() })).json();
const second = await (await fetch(`${API}/pos/orders`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': key }, body: body() })).json();

console.log('1. REPLAY WITH SAME KEY');
console.log(`   first  -> ${first.data?.orderNumber} ₹${first.data?.grandTotal}`);
console.log(`   second -> ${second.data?.orderNumber} ₹${second.data?.grandTotal}`);
console.log(`   same order: ${first.data?.id === second.data?.id ? 'YES ✓' : 'NO ✗ DUPLICATE'}`);

// --- 2. two concurrent requests racing on one key ---
const raceKey = crypto.randomUUID();
const [a, b] = await Promise.all([
  fetch(`${API}/pos/orders`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': raceKey }, body: body() }).then((r) => r.json()),
  fetch(`${API}/pos/orders`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': raceKey }, body: body() }).then((r) => r.json()),
]);
console.log('\n2. CONCURRENT RACE ON ONE KEY');
console.log(`   a -> ${a.data?.orderNumber ?? JSON.stringify(a.error)}`);
console.log(`   b -> ${b.data?.orderNumber ?? JSON.stringify(b.error)}`);
console.log(`   same order: ${a.data?.id && a.data?.id === b.data?.id ? 'YES ✓' : 'NO ✗'}`);

// --- 3. a different key is a different order ---
const third = await (await fetch(`${API}/pos/orders`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() }, body: body() })).json();
console.log('\n3. FRESH KEY');
console.log(`   -> ${third.data?.orderNumber} | distinct from first: ${third.data?.id !== first.data?.id ? 'YES ✓' : 'NO ✗'}`);

// --- 4. CARD must be refused now ---
const card = await fetch(`${API}/pos/orders`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() }, body: body('CARD') });
const cb = await card.json();
console.log('\n4. CARD PAYMENT');
console.log(`   HTTP ${card.status} -> ${cb.success ? 'ACCEPTED ✗' : 'rejected ✓ ' + JSON.stringify(cb.error.details ?? cb.error.message)}`);

// --- 5. malformed key is rejected, not ignored ---
const badKey = await fetch(`${API}/pos/orders`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': 'no spaces allowed!' }, body: body() });
const bk = await badKey.json();
console.log('\n5. MALFORMED KEY');
console.log(`   HTTP ${badKey.status} -> ${bk.success ? 'ACCEPTED ✗' : 'rejected ✓'}`);

const after = await (await fetch(`${API}/pos/orders?page=1&pageSize=1`, { headers: auth })).json();
console.log(`\nORDERS CREATED: ${after.meta.pagination.total - countBefore} (expected 3: replay + race + fresh)`);
