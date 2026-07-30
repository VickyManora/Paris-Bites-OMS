// Removes the demo purchases, consumption and write-downs seeded to make the dashboard
// legible, and returns inventory to zero stock.
//
//   node purge-demo-data.mjs
//
// Leaves your suppliers, users and the 40-item master list untouched.
import 'dotenv/config';
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = async (s) => (await c.query(s)).rows;

console.log('before:', (await q(`select
  (select count(*) from purchases) purchases,
  (select count(*) from consumption_entries) consumption,
  (select count(*) from inventory_items where deleted_at is null and current_quantity <> 0) stocked`))[0]);

await c.query('BEGIN');
await c.query(`DELETE FROM purchase_lines WHERE purchase_id IN
  (SELECT id FROM purchases WHERE invoice_number LIKE 'DEMO-%')`);
await c.query(`DELETE FROM purchases WHERE invoice_number LIKE 'DEMO-%'`);
await c.query('DELETE FROM consumption_entry_revisions');
await c.query('DELETE FROM consumption_lines');
await c.query('DELETE FROM consumption_entries');
await c.query(`DELETE FROM inventory_item_history
  WHERE action IN ('PURCHASED', 'CONSUMED')
     OR note IN ('Spoiled — left out overnight', 'Packets crushed in transit')`);
await c.query(`UPDATE inventory_items
  SET current_quantity = 0, purchase_price = NULL
  WHERE deleted_at IS NULL`);
await c.query('COMMIT');

console.log('after: ', (await q(`select
  (select count(*) from purchases) purchases,
  (select count(*) from consumption_entries) consumption,
  (select count(*) from inventory_items where deleted_at is null and current_quantity <> 0) stocked,
  (select count(*) from inventory_items where deleted_at is null) items,
  (select count(*) from suppliers) suppliers`))[0]);
await c.end();
