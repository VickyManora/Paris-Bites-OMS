-- ---------------------------------------------------------------------------
-- Inventory master-data update.
--
-- Widens the category and unit vocabularies to the Paris Bites master list, adds
-- the per-item purchasing and shelf-life fields, and lands the recipe tables that
-- future stock deduction will read.
--
-- Purely additive. No column is dropped and no enum value is removed: transfer and
-- purchase lines snapshot the unit and category of what they moved, so a value that
-- looks unused is still held by historical rows.
-- ---------------------------------------------------------------------------

-- AlterEnum
--
-- Countable retail units the master list buys in. Forcing packets and bottles into
-- PIECES would lose the difference between "10 packets" and "10 biscuits".
ALTER TYPE "InventoryUnit" ADD VALUE 'PACKETS';
ALTER TYPE "InventoryUnit" ADD VALUE 'SHEETS';
ALTER TYPE "InventoryUnit" ADD VALUE 'BOTTLES';

-- AlterEnum
ALTER TYPE "InventoryCategory" ADD VALUE 'WAFFLE_PREMIX';
ALTER TYPE "InventoryCategory" ADD VALUE 'BOWL_PREMIX';
ALTER TYPE "InventoryCategory" ADD VALUE 'CHOCOLATE_FILLINGS';
ALTER TYPE "InventoryCategory" ADD VALUE 'SPREADS_AND_SAUCES';
ALTER TYPE "InventoryCategory" ADD VALUE 'TOPPINGS_AND_FLAVOURS';
ALTER TYPE "InventoryCategory" ADD VALUE 'KITCHEN_ESSENTIALS';
ALTER TYPE "InventoryCategory" ADD VALUE 'CLEANING_AND_HYGIENE';

-- AlterEnum
ALTER TYPE "InventoryHistoryAction" ADD VALUE 'RECIPE_CONSUMED';

-- AlterTable
ALTER TABLE "inventory_items"
    ADD COLUMN "opening_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    ADD COLUMN "purchase_price" DECIMAL(14,4),
    ADD COLUMN "supplier_id" UUID,
    ADD COLUMN "low_stock_alert_enabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "batch_number" TEXT,
    ADD COLUMN "expiry_date" DATE;

-- Backfill the opening figure for rows that predate the column.
--
-- `current_quantity` is the closest true statement available: nothing recorded what
-- these items opened at, and leaving the default 0 would assert they started empty,
-- which is a claim the data does not support.
UPDATE "inventory_items" SET "opening_quantity" = "current_quantity";

-- CreateIndex
CREATE INDEX "inventory_items_supplier_id_idx" ON "inventory_items"("supplier_id");

-- CreateIndex
CREATE INDEX "inventory_items_expiry_date_idx" ON "inventory_items"("expiry_date");

-- AddForeignKey
--
-- SET NULL: removing a supplier drops the preference, never the item. The item is
-- still real stock whether or not anyone knows where to buy it again.
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "yield_quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipes_is_active_idx" ON "recipes"("is_active");

-- CreateIndex
CREATE INDEX "recipes_deleted_at_idx" ON "recipes"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_ingredients_recipe_id_item_id_key"
    ON "recipe_ingredients"("recipe_id", "item_id");

-- CreateIndex
CREATE INDEX "recipe_ingredients_item_id_idx" ON "recipe_ingredients"("item_id");

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey"
    FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- RESTRICT, matching transfer and purchase lines: deleting an item must not silently
-- empty the recipes that depend on it, which would deduct too little with no trace.
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express in schema.prisma, added by hand.
-- Keep these in sync manually: `prisma migrate diff` will not regenerate them,
-- and `prisma db push` would drop them.
-- ---------------------------------------------------------------------------

-- The same partial, case-insensitive uniqueness inventory item names get: a
-- soft-deleted recipe must not hold its name hostage against a replacement.
CREATE UNIQUE INDEX "recipes_name_live_key"
    ON "recipes" (LOWER("name"))
    WHERE "deleted_at" IS NULL;

-- Backstops matching the existing quantity checks. These hold even for a direct SQL
-- write or a bug that bypasses the use case.
ALTER TABLE "inventory_items"
    ADD CONSTRAINT "inventory_items_opening_quantity_non_negative"
    CHECK ("opening_quantity" >= 0);

-- A price of exactly 0 is allowed (a free sample is a real thing); a negative one is
-- not a discount, it is a data-entry error.
ALTER TABLE "inventory_items"
    ADD CONSTRAINT "inventory_items_purchase_price_non_negative"
    CHECK ("purchase_price" IS NULL OR "purchase_price" >= 0);

-- Strictly positive, unlike the stock checks above: a recipe yielding nothing, or a
-- line consuming nothing, is a recipe that would silently deduct zero for every order.
ALTER TABLE "recipes"
    ADD CONSTRAINT "recipes_yield_quantity_positive"
    CHECK ("yield_quantity" > 0);

ALTER TABLE "recipe_ingredients"
    ADD CONSTRAINT "recipe_ingredients_quantity_positive"
    CHECK ("quantity" > 0);
