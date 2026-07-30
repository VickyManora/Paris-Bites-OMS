const API = 'http://localhost:4000/api/v1';
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: H,
  body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
const lb = await login.json();
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const token = lb.data?.accessToken ?? lb.data?.tokens?.accessToken;
const auth = { ...H, ...(cookie && { Cookie: cookie }), ...(token && { Authorization: `Bearer ${token}` }) };
const menu = await (await fetch(`${API}/pos/menu`, { headers: auth })).json();
const product = (menu.data.categories ?? menu.data).flatMap((c) => c.products).find((p) => p.isAvailable);
const body = JSON.stringify({ lines: [{ productId: product.id, quantity: 1 }], discountType: 'NONE', discountValue: 0, payment: { method: 'CASH' } });
const total = async () => (await (await fetch(`${API}/pos/orders?page=1&pageSize=1`, { headers: auth })).json()).meta.pagination.total;

const before = await total();
let recovered = 0, conflict = 0, other = 0;
const N = 8;
for (let i = 0; i < N; i++) {
  const key = crypto.randomUUID();
  const post = () => fetch(`${API}/pos/orders`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': key }, body }).then(async (r) => ({ s: r.status, b: await r.json() }));
  const [a, b] = await Promise.all([post(), post()]);
  const nums = [a, b].filter((r) => r.b.success).map((r) => r.b.data.orderNumber);
  const both = a.b.success && b.b.success;
  if (both && nums[0] === nums[1]) { recovered++; console.log(`  run ${i + 1}: both 201, same order ${nums[0]}  -> recovered gracefully`); }
  else if ([a, b].some((r) => r.b.error?.code === 'DUPLICATE_RESOURCE')) { conflict++; console.log(`  run ${i + 1}: winner ${nums[0]}, loser 409 -> safe, needs a retry`); }
  else { other++; console.log(`  run ${i + 1}: UNEXPECTED ${JSON.stringify([a.s, b.s])}`); }
}
const created = (await total()) - before;
console.log(`\nover ${N} simultaneous double-taps:`);
console.log(`  loser got the original order (201): ${recovered}`);
console.log(`  loser got 409, resolved by Try again: ${conflict}`);
console.log(`  unexpected: ${other}`);
console.log(`  ORDERS CREATED: ${created} (must equal ${N} — exactly one per double-tap)`);
console.log(created === N && other === 0 ? '\nNO DOUBLE CHARGE IN ANY RUN ✓' : '\nCHECK THIS ✗');
