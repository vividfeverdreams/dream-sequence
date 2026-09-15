-- AlterTable
ALTER TABLE "dream_sequence"."DJSession" ADD COLUMN IF NOT EXISTS     "audienceMode" TEXT NOT NULL DEFAULT 'web',
ADD COLUMN IF NOT EXISTS     "twitchChannel" TEXT,
ADD COLUMN IF NOT EXISTS     "videoResolution" TEXT NOT NULL DEFAULT '768P',
ALTER COLUMN "videoModel" SET DEFAULT 'h3_max',
ALTER COLUMN "videoDurationSeconds" SET DEFAULT 5;

-- CreateTable
CREATE TABLE IF NOT EXISTS "dream_sequence"."TwitchConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "twitchUserId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "tokenValidatedAt" TIMESTAMP(3),
    "scopes" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dream_sequence"."TwitchEventDelivery" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "TwitchEventDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TwitchConnection_userId_key" ON "dream_sequence"."TwitchConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TwitchConnection_twitchUserId_key" ON "dream_sequence"."TwitchConnection"("twitchUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TwitchEventDelivery_status_receivedAt_idx" ON "dream_sequence"."TwitchEventDelivery"("status", "receivedAt");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TwitchConnection_userId_fkey' AND conrelid = 'dream_sequence."TwitchConnection"'::regclass) THEN
    ALTER TABLE "dream_sequence"."TwitchConnection" ADD CONSTRAINT "TwitchConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "dream_sequence"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;


-- All existing spaces use H3 Max after the overhaul; preserve supported lengths.
UPDATE "dream_sequence"."DJSession"
SET "videoModel" = 'h3_max', "videoDurationSeconds" = LEAST(15, GREATEST(5, "videoDurationSeconds"))
WHERE "videoModel" <> 'h3_max' OR "videoDurationSeconds" NOT BETWEEN 5 AND 15;
