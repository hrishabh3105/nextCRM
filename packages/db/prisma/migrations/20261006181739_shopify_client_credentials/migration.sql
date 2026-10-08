-- AlterTable
ALTER TABLE "store_connections" ADD COLUMN     "auth_mode" TEXT NOT NULL DEFAULT 'client_credentials',
ADD COLUMN     "granted_scopes" TEXT,
ALTER COLUMN "access_token_enc" DROP NOT NULL;
