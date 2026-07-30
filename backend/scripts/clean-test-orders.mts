import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Repo-relative, so this works from any checkout rather than one machine.
const B = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { PrismaPg } = await import(`${B}/node_modules/@prisma/adapter-pg/dist/index.js`);
const { PrismaClient } = await import(`${B}/src/generated/prisma/client.js`);
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }) });
const mine = await p.salesOrder.findMany({ where: { idempotencyKey: { not: null } }, select: { id: true, orderNumber: true } });
const ids = mine.map((o) => o.id);
if (ids.length) {
  await p.payment.deleteMany({ where: { orderId: { in: ids } } });
  await p.salesOrderItem.deleteMany({ where: { orderId: { in: ids } } });
  await p.salesOrder.deleteMany({ where: { id: { in: ids } } });
  console.log(`removed ${ids.length} test order(s): ${mine.map((o) => o.orderNumber).join(', ')}`);
} else console.log('no test orders present');
await p.orderSequence.updateMany({ data: { lastNumber: 1 } });
const left = await p.salesOrder.findMany({ select: { orderNumber: true, grandTotal: true } });
console.log(`remaining: ${left.map((o) => `${o.orderNumber} ₹${o.grandTotal}`).join(', ') || 'none'}`);
await p.$disconnect();
