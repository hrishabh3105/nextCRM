-- AlterTable
ALTER TABLE "templates" ADD COLUMN     "buttons" JSONB,
ADD COLUMN     "footer_text" TEXT,
ADD COLUMN     "header_text" TEXT;
