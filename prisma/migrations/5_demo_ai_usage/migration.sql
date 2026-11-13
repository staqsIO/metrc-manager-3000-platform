-- CreateTable
CREATE TABLE "demo_ai_usage" (
    "bucket" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "demo_ai_usage_pkey" PRIMARY KEY ("bucket","day")
);
