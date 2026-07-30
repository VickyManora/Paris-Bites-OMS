-- ---------------------------------------------------------------------------
-- Daily consumption.
--
-- What the kitchen actually used, entered by hand. Recording deducts stock in the
-- same transaction; editing re-applies the difference; voiding returns it.
-- ---------------------------------------------------------------------------

-- AlterEnum
--
-- One action for record, edit and void. The signed before/after already says which way
-- the stock moved, and a single action keeps "what did we consume this month" a plain
-- sum in which a correction nets off against the figure it corrects.
ALTER TYPE "InventoryHistoryAction" ADD VALUE 'CONSUMED';

-- CreateEnum
CREATE TYPE "ConsumptionRevisionAction" AS ENUM ('CREATED', 'UPDATED', 'VOIDED');

-- CreateTable
CREATE TABLE "consumption_entries" (
    "id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "location" "InventoryLocation" NOT NULL,
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "voided_by_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "consumption_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumption_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "item_name" TEXT NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumption_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumption_entry_revisions" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" "ConsumptionRevisionAction" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumption_entry_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consumption_entries_entry_date_idx" ON "consumption_entries"("entry_date");

-- CreateIndex
CREATE INDEX "consumption_entries_location_entry_date_idx" ON "consumption_entries"("location", "entry_date");

-- CreateIndex
CREATE INDEX "consumption_entries_deleted_at_idx" ON "consumption_entries"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "consumption_lines_entry_id_item_id_key" ON "consumption_lines"("entry_id", "item_id");

-- CreateIndex
CREATE INDEX "consumption_lines_item_id_idx" ON "consumption_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "consumption_entry_revisions_entry_id_revision_key" ON "consumption_entry_revisions"("entry_id", "revision");

-- CreateIndex
CREATE INDEX "consumption_entry_revisions_entry_id_created_at_idx" ON "consumption_entry_revisions"("entry_id", "created_at");

-- AddForeignKey
ALTER TABLE "consumption_entries" ADD CONSTRAINT "consumption_entries_recorded_by_id_fkey"
    FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumption_entries" ADD CONSTRAINT "consumption_entries_voided_by_id_fkey"
    FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumption_lines" ADD CONSTRAINT "consumption_lines_entry_id_fkey"
    FOREIGN KEY ("entry_id") REFERENCES "consumption_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- RESTRICT, matching transfer, purchase and recipe lines: deleting an item must not
-- erase the record of having consumed it.
ALTER TABLE "consumption_lines" ADD CONSTRAINT "consumption_lines_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumption_entry_revisions" ADD CONSTRAINT "consumption_entry_revisions_entry_id_fkey"
    FOREIGN KEY ("entry_id") REFERENCES "consumption_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumption_entry_revisions" ADD CONSTRAINT "consumption_entry_revisions_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- A consumed quantity is strictly positive. Zero is not a consumption, and a negative
-- one would be a stock increase wearing a consumption record's clothes.
ALTER TABLE "consumption_lines"
    ADD CONSTRAINT "consumption_lines_quantity_positive"
    CHECK ("quantity" > 0);

-- Revisions are numbered from 1, matching `consumption_entries.revision`.
ALTER TABLE "consumption_entry_revisions"
    ADD CONSTRAINT "consumption_entry_revisions_revision_positive"
    CHECK ("revision" >= 1);

-- A voided entry must say who voided it and why, and a live one must claim neither.
-- Enforced in the use case too; this is the backstop that survives a direct SQL write.
ALTER TABLE "consumption_entries"
    ADD CONSTRAINT "consumption_entries_void_fields_consistent"
    CHECK (
        ("deleted_at" IS NULL AND "voided_by_id" IS NULL AND "void_reason" IS NULL)
        OR ("deleted_at" IS NOT NULL AND "void_reason" IS NOT NULL)
    );
