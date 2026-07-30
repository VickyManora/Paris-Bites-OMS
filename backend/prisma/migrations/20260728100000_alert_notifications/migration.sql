-- ---------------------------------------------------------------------------
-- Alert notifications.
--
-- Three new notification types. Two of them (LOW_STOCK, EXPIRY_ALERT) are raised by a
-- periodic scan rather than by a person, so their rows carry a null actor — which the
-- column already allows.
-- ---------------------------------------------------------------------------

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LOW_STOCK';
ALTER TYPE "NotificationType" ADD VALUE 'PURCHASE_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'EXPIRY_ALERT';

-- CreateIndex
--
-- Serves the alert scan's de-duplication query: "which items have already been alerted
-- about, of this type, since the cutoff". Without it that check is a sequential scan of
-- the whole notification table on every sweep, and the sweep runs on a timer forever.
--
-- Ordered (type, entity_id, created_at) because the type is always an equality match,
-- the entity is the grouping, and the timestamp is the range bound.
CREATE INDEX "notifications_type_entity_id_created_at_idx"
    ON "notifications" ("type", "entity_id", "created_at");
