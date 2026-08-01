-- CreateEnum
CREATE TYPE "SessionScope" AS ENUM ('FULL', 'POS');

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "device_name" TEXT,
ADD COLUMN     "scope" "SessionScope" NOT NULL DEFAULT 'FULL';
