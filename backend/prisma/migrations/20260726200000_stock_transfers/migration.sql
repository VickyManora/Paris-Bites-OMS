-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InventoryHistoryAction" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "InventoryHistoryAction" ADD VALUE 'TRANSFER_IN';

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "from_location" "InventoryLocation" NOT NULL,
    "to_location" "InventoryLocation" NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "completed_by_id" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "item_name" TEXT NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "category" "InventoryCategory" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_reference_key" ON "stock_transfers"("reference");

-- CreateIndex
CREATE INDEX "stock_transfers_status_idx" ON "stock_transfers"("status");

-- CreateIndex
CREATE INDEX "stock_transfers_requested_at_idx" ON "stock_transfers"("requested_at");

-- CreateIndex
CREATE INDEX "stock_transfers_status_requested_at_idx" ON "stock_transfers"("status", "requested_at");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_item_id_idx" ON "stock_transfer_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_lines_transfer_id_item_id_key" ON "stock_transfer_lines"("transfer_id", "item_id");

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Objects Prisma cannot express in schema.prisma, added by hand.
-- Keep in sync manually: `prisma migrate diff` will not regenerate them.
-- ---------------------------------------------------------------------------

-- Sequence backing the human-readable transfer reference (TR-000001, TR-000002, …).
--
-- A sequence rather than `count(*) + 1`: two concurrent creates would read the same
-- count and produce the same reference, which the unique constraint would then reject —
-- turning a routine race into a failed request. `nextval` is atomic and never reuses a
-- number, so references are unique and monotonic even under load.
--
-- Gaps are expected and harmless: a rolled-back transaction consumes its number. A
-- reference is an identifier, not a count of transfers.
CREATE SEQUENCE IF NOT EXISTS "stock_transfer_reference_seq" AS bigint START WITH 1;

-- Line quantities must be positive. A zero or negative line is not a transfer.
ALTER TABLE "stock_transfer_lines"
    ADD CONSTRAINT "stock_transfer_lines_quantity_positive"
    CHECK ("quantity" > 0);

-- Only HOME_WAREHOUSE -> CART is supported today, and a transfer to the location it came
-- from is meaningless. Enforced in the database as well as the domain, so a direct SQL
-- write cannot create a nonsensical document.
ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_distinct_locations"
    CHECK ("from_location" <> "to_location");

-- A rejected transfer must carry a reason, and a review decision must be attributable.
-- Partial: only constrains rows that have actually been reviewed.
ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_rejection_requires_note"
    CHECK ("status" <> 'REJECTED' OR ("review_note" IS NOT NULL AND "reviewed_by_id" IS NOT NULL));
