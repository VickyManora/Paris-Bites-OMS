-- ---------------------------------------------------------------------------
-- Point of sale.
--
-- A product catalogue of finished goods, orders taken at the counter, and the money
-- received against them. Deliberately touches no inventory table: linking a sold bowl
-- back to the chocolate it consumed needs recipes, which is a later phase.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'CANCELLED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD');
CREATE TYPE "DiscountType" AS ENUM ('NONE', 'FLAT', 'PERCENTAGE');

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "image_url" TEXT,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL DEFAULT 'WALK_IN',
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "customer_id" UUID,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_type" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discount_value" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_reason" TEXT,
    "grand_total" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "placed_by_id" UUID,
    "paid_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "line_total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "confirmed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_sequences" (
    "day" DATE NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_sequences_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE INDEX "product_categories_displayOrder_idx" ON "product_categories"("displayOrder");
CREATE INDEX "product_categories_deleted_at_idx" ON "product_categories"("deleted_at");
CREATE INDEX "products_category_id_display_order_idx" ON "products"("category_id", "display_order");
CREATE INDEX "products_is_available_idx" ON "products"("is_available");
CREATE INDEX "products_deleted_at_idx" ON "products"("deleted_at");
CREATE INDEX "customers_phone_idx" ON "customers"("phone");
CREATE INDEX "customers_deleted_at_idx" ON "customers"("deleted_at");
CREATE UNIQUE INDEX "sales_orders_order_number_key" ON "sales_orders"("order_number");
CREATE INDEX "sales_orders_created_at_idx" ON "sales_orders"("created_at");
CREATE INDEX "sales_orders_status_created_at_idx" ON "sales_orders"("status", "created_at");
CREATE INDEX "sales_orders_channel_created_at_idx" ON "sales_orders"("channel", "created_at");
CREATE UNIQUE INDEX "sales_order_items_order_id_product_id_key" ON "sales_order_items"("order_id", "product_id");
CREATE INDEX "sales_order_items_product_id_idx" ON "sales_order_items"("product_id");
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");
CREATE INDEX "payments_method_created_at_idx" ON "payments"("method", "created_at");

-- CreateIndex
--
-- PARTIAL unique indexes, scoped to live rows. Prisma cannot express the WHERE clause, so
-- these are hand-written — the same arrangement as the supplier and daily-sales indexes.
--
-- Product names are compared case-insensitively: "Oreo Licious" and "oreo licious" are the
-- same item on a menu, and letting both exist puts two near-identical cards in front of
-- someone taking an order in ten seconds.
CREATE UNIQUE INDEX "products_name_live_key"
    ON "products" (LOWER("name"))
    WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "product_categories_name_live_key"
    ON "product_categories" (LOWER("name"))
    WHERE "deleted_at" IS NULL;

-- Only applied when a phone was actually given: a guest order stores no customer at all,
-- and several customers legitimately have no number.
CREATE UNIQUE INDEX "customers_phone_live_key"
    ON "customers" ("phone")
    WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_placed_by_id_fkey"
    FOREIGN KEY ("placed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_cancelled_by_id_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_id_fkey"
    FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
