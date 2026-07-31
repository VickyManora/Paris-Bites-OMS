-- ---------------------------------------------------------------------------
-- Automatic "any 2" combo pricing.
--
-- The counter used to sell a combo by adding a separate "Any 2 Signature Bowls" product. That
-- charged the right money and lost the thing worth knowing: the order recorded *a combo* rather
-- than *which two bowls went out*, so neither stock nor the top-sellers report ever saw the
-- flavours. Pairing the real bowl lines keeps both.
--
-- These columns are separate from `discount_amount` on purpose. That one is the discretionary
-- reduction a staff member gives — it requires a reason and counts against the Store Manager's 20%
-- ceiling. A combo is the shop's own price for a pair: no reason, and it must not consume a
-- manager's headroom, since a 2x Blueberry pair is already 16.5% of its own subtotal.
--
-- Additive and safe on a live table. Both default, so every existing order reads as "no combo",
-- which is exactly what those orders were.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "sales_orders"
  ADD COLUMN "combo_discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "combo_count" INTEGER NOT NULL DEFAULT 0;
