-- CreateEnum
CREATE TYPE "GstTreatment" AS ENUM ('INTRA_STATE', 'INTER_STATE', 'UNREGISTERED');

-- AlterEnum
ALTER TYPE "InventoryHistoryAction" ADD VALUE 'PURCHASED';

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "state_code" VARCHAR(2) NOT NULL,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_gstin" TEXT,
    "supplier_state_code" VARCHAR(2) NOT NULL,
    "gst_treatment" "GstTreatment" NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "total_cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "invoice_file_name" TEXT,
    "invoice_stored_name" TEXT,
    "invoice_mime_type" TEXT,
    "invoice_size_bytes" INTEGER,
    "invoice_checksum" TEXT,
    "invoice_uploaded_at" TIMESTAMP(3),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "item_name" TEXT NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "category" "InventoryCategory" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_rate" DECIMAL(14,4) NOT NULL,
    "hsn_code" VARCHAR(8),
    "gst_rate_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(14,2) NOT NULL,
    "cgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_is_active_idx" ON "suppliers"("is_active");

-- CreateIndex
CREATE INDEX "suppliers_deleted_at_idx" ON "suppliers"("deleted_at");

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- CreateIndex
CREATE INDEX "purchases_invoice_date_idx" ON "purchases"("invoice_date");

-- CreateIndex
CREATE INDEX "purchases_supplier_id_invoice_date_idx" ON "purchases"("supplier_id", "invoice_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_supplier_id_invoice_number_key" ON "purchases"("supplier_id", "invoice_number");

-- CreateIndex
CREATE INDEX "purchase_lines_item_id_idx" ON "purchase_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_lines_purchase_id_item_id_key" ON "purchase_lines"("purchase_id", "item_id");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- GSTIN is unique among LIVE suppliers only. A plain unique index would let a
-- soft-deleted supplier hold its GSTIN hostage forever, so re-adding a vendor you
-- removed last year would be impossible. Same treatment as inventory item names.
CREATE UNIQUE INDEX "suppliers_gstin_live_key"
    ON "suppliers" ("gstin")
    WHERE "deleted_at" IS NULL AND "gstin" IS NOT NULL;

-- Supplier names collide case-insensitively among live rows, so "Metro Cash" and
-- "metro cash" cannot both exist and be picked from a dropdown by mistake.
CREATE UNIQUE INDEX "suppliers_name_live_key"
    ON "suppliers" (LOWER("name"))
    WHERE "deleted_at" IS NULL;

-- A GST state code is exactly two digits. Enforced in the domain too; this is the
-- backstop that survives a direct SQL write.
ALTER TABLE "suppliers"
    ADD CONSTRAINT "suppliers_state_code_format" CHECK ("state_code" ~ '^[0-9]{2}$');

-- Money and quantities can never be negative on a purchase. A negative line would
-- silently DECREASE stock through a document whose whole purpose is to add it.
ALTER TABLE "purchase_lines"
    ADD CONSTRAINT "purchase_lines_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "purchase_lines"
    ADD CONSTRAINT "purchase_lines_unit_rate_non_negative" CHECK ("unit_rate" >= 0);

ALTER TABLE "purchase_lines"
    ADD CONSTRAINT "purchase_lines_gst_rate_range" CHECK ("gst_rate_percent" >= 0 AND "gst_rate_percent" <= 100);

ALTER TABLE "purchase_lines"
    ADD CONSTRAINT "purchase_lines_amounts_non_negative" CHECK (
        "taxable_amount" >= 0 AND "cgst_amount" >= 0 AND "sgst_amount" >= 0
        AND "igst_amount" >= 0 AND "line_total" >= 0
    );

ALTER TABLE "purchases"
    ADD CONSTRAINT "purchases_totals_non_negative" CHECK (
        "subtotal" >= 0 AND "total_cgst" >= 0 AND "total_sgst" >= 0
        AND "total_igst" >= 0 AND "total_tax" >= 0 AND "total_amount" >= 0
    );

-- The tax split must match the treatment the invoice was filed under. Intra-state
-- cannot carry IGST, inter-state cannot carry CGST/SGST, and an unregistered
-- supplier cannot carry tax at all. Getting this wrong misfiles a return, so it is
-- checked in the database rather than trusted to the calculation.
ALTER TABLE "purchases"
    ADD CONSTRAINT "purchases_tax_matches_treatment" CHECK (
        ("gst_treatment" = 'INTRA_STATE' AND "total_igst" = 0)
        OR ("gst_treatment" = 'INTER_STATE' AND "total_cgst" = 0 AND "total_sgst" = 0)
        OR ("gst_treatment" = 'UNREGISTERED' AND "total_cgst" = 0 AND "total_sgst" = 0 AND "total_igst" = 0)
    );

-- An invoice file is all-or-nothing: metadata without a stored name would point at
-- bytes that are not there, and a stored name without metadata is unservable.
ALTER TABLE "purchases"
    ADD CONSTRAINT "purchases_invoice_file_complete" CHECK (
        ("invoice_stored_name" IS NULL AND "invoice_file_name" IS NULL
         AND "invoice_mime_type" IS NULL AND "invoice_size_bytes" IS NULL
         AND "invoice_checksum" IS NULL AND "invoice_uploaded_at" IS NULL)
        OR ("invoice_stored_name" IS NOT NULL AND "invoice_file_name" IS NOT NULL
            AND "invoice_mime_type" IS NOT NULL AND "invoice_size_bytes" IS NOT NULL
            AND "invoice_checksum" IS NOT NULL AND "invoice_uploaded_at" IS NOT NULL)
    );
