-- ---------------------------------------------------------------------------
-- Idempotent order placement.
--
-- The counter runs on mobile data, where a request can be answered by the server and then
-- lost on the way back. The order exists, the till shows a network error, and the natural
-- reaction is to tap Charge again — billing the customer twice and inflating the day's
-- figures.
--
-- The client now sends an `Idempotency-Key` per order attempt, held across retries. This
-- column plus its unique index is what lets the second attempt return the first order
-- rather than create a second one.
--
-- Additive and safe on a live table: the column is nullable, so existing rows need no
-- backfill, and Postgres lets `NULL` repeat under a unique index — which is precisely what
-- non-POS writes (seeds, future imports) need.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_idempotency_key_key" ON "sales_orders" ("idempotency_key");
