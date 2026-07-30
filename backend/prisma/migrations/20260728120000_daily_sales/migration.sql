-- ---------------------------------------------------------------------------
-- Daily sales.
--
-- One hand-entered total per trading day, split by channel and payment mode.
-- Deliberately not a record of individual sales: see the model comment on
-- DailySalesEntry for why, and for the consequence (ingredient usage cannot be
-- derived from a rupee total, so consumption stays a separate entry).
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('WALK_IN', 'ZOMATO', 'SWIGGY');

-- CreateEnum
CREATE TYPE "SalesPaymentMode" AS ENUM ('CASH', 'ONLINE');

-- CreateEnum
CREATE TYPE "DailySalesRevisionAction" AS ENUM ('CREATED', 'UPDATED');

-- CreateTable
CREATE TABLE "daily_sales_entries" (
    "id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "daily_sales_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_sales_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "payment_mode" "SalesPaymentMode" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_sales_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_sales_entry_revisions" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" "DailySalesRevisionAction" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_sales_entry_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_sales_entries_entry_date_idx" ON "daily_sales_entries"("entry_date");
CREATE INDEX "daily_sales_entries_deleted_at_idx" ON "daily_sales_entries"("deleted_at");

-- CreateIndex
--
-- One entry per trading day — the rule the whole module hangs on, enforced here
-- rather than by a read-then-write in the use case, which two concurrent submissions
-- would slip straight past and double-count the day's revenue.
--
-- PARTIAL, scoped to live rows, which Prisma cannot express and so is hand-written:
-- a day soft-deleted in error must be re-enterable, and a plain unique index would
-- keep the deleted row's date reserved forever.
CREATE UNIQUE INDEX "daily_sales_entries_entry_date_live_key"
    ON "daily_sales_entries" ("entry_date")
    WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "daily_sales_lines_entry_id_channel_payment_mode_key"
    ON "daily_sales_lines"("entry_id", "channel", "payment_mode");
CREATE INDEX "daily_sales_lines_channel_idx" ON "daily_sales_lines"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "daily_sales_entry_revisions_entry_id_revision_key"
    ON "daily_sales_entry_revisions"("entry_id", "revision");
CREATE INDEX "daily_sales_entry_revisions_entry_id_created_at_idx"
    ON "daily_sales_entry_revisions"("entry_id", "created_at");

-- AddForeignKey
ALTER TABLE "daily_sales_entries" ADD CONSTRAINT "daily_sales_entries_recorded_by_id_fkey"
    FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "daily_sales_lines" ADD CONSTRAINT "daily_sales_lines_entry_id_fkey"
    FOREIGN KEY ("entry_id") REFERENCES "daily_sales_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_sales_entry_revisions" ADD CONSTRAINT "daily_sales_entry_revisions_entry_id_fkey"
    FOREIGN KEY ("entry_id") REFERENCES "daily_sales_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_sales_entry_revisions" ADD CONSTRAINT "daily_sales_entry_revisions_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
