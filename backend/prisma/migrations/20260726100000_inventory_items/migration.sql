-- CreateEnum
CREATE TYPE "InventoryLocation" AS ENUM ('HOME_WAREHOUSE', 'CART');

-- CreateEnum
CREATE TYPE "InventoryUnit" AS ENUM ('KG', 'GRAMS', 'LITERS', 'PIECES', 'BOXES');

-- CreateEnum
CREATE TYPE "InventoryCategory" AS ENUM ('FLOUR_AND_GRAINS', 'DAIRY', 'CHOCOLATE', 'FRUIT', 'NUTS_AND_SEEDS', 'SUGAR_AND_SWEETENERS', 'FATS_AND_OILS', 'EGGS', 'FLAVOURING', 'DECORATION', 'PACKAGING', 'EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryItemStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "InventoryHistoryAction" AS ENUM ('CREATED', 'UPDATED', 'QUANTITY_ADJUSTED', 'STATUS_CHANGED', 'DELETED', 'RESTORED');

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "InventoryCategory" NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "location" "InventoryLocation" NOT NULL,
    "current_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minimum_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "status" "InventoryItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_item_history" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "action" "InventoryHistoryAction" NOT NULL,
    "quantity_before" DECIMAL(12,3),
    "quantity_after" DECIMAL(12,3),
    "changes" JSONB,
    "note" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_item_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_items_location_idx" ON "inventory_items"("location");

-- CreateIndex
CREATE INDEX "inventory_items_category_idx" ON "inventory_items"("category");

-- CreateIndex
CREATE INDEX "inventory_items_status_idx" ON "inventory_items"("status");

-- CreateIndex
CREATE INDEX "inventory_items_deleted_at_idx" ON "inventory_items"("deleted_at");

-- CreateIndex
CREATE INDEX "inventory_items_location_category_name_idx" ON "inventory_items"("location", "category", "name");

-- CreateIndex
CREATE INDEX "inventory_item_history_item_id_created_at_idx" ON "inventory_item_history"("item_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_item_history_actor_id_idx" ON "inventory_item_history"("actor_id");

-- CreateIndex
CREATE INDEX "inventory_item_history_created_at_idx" ON "inventory_item_history"("created_at");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_history" ADD CONSTRAINT "inventory_item_history_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_history" ADD CONSTRAINT "inventory_item_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express in schema.prisma, added by hand.
-- Keep these in sync manually: `prisma migrate diff` will not regenerate them,
-- and `prisma db push` would drop them.
-- ---------------------------------------------------------------------------

-- Item names are unique per location, so the same ingredient can exist in both
-- the warehouse and the cart.
--
-- PARTIAL, scoped to live rows: with a plain unique index a soft-deleted item
-- would hold its name hostage forever, so re-adding "Unsalted butter" after
-- deleting it would fail with a conflict the user cannot see or resolve.
--
-- LOWER(name) so "Butter" and "butter" collide — case-sensitive uniqueness would
-- let near-duplicate items accumulate, which is exactly what an inventory system
-- must not allow.
CREATE UNIQUE INDEX "inventory_items_name_location_live_key"
    ON "inventory_items" (LOWER("name"), "location")
    WHERE "deleted_at" IS NULL;

-- Quantities can never be negative. Enforced in the domain and by validation as
-- well; this is the backstop that holds even for a direct SQL write or a bug
-- that bypasses the use case.
ALTER TABLE "inventory_items"
    ADD CONSTRAINT "inventory_items_current_quantity_non_negative"
    CHECK ("current_quantity" >= 0);

ALTER TABLE "inventory_items"
    ADD CONSTRAINT "inventory_items_minimum_quantity_non_negative"
    CHECK ("minimum_quantity" >= 0);
