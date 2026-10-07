-- CreateEnum
CREATE TYPE "LlmProviderType" AS ENUM ('OPENROUTER', 'OLLAMA');

-- CreateTable
CREATE TABLE "llm_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LlmProviderType" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT,
    "keyServiceUrl" TEXT,
    "keyServiceTokenEncrypted" TEXT,
    "models" TEXT[],
    "defaultModel" TEXT NOT NULL,
    "fallbackModel" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "llm_providers_name_key" ON "llm_providers"("name");

CREATE UNIQUE INDEX "llm_providers_single_default" ON "llm_providers" ("isDefault") WHERE "isDefault" = true;
