-- CreateTable
CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DJSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "artistName" TEXT NOT NULL,
  "trackName" TEXT NOT NULL,
  "creativeBible" TEXT NOT NULL,
  "allowedMotifs" TEXT NOT NULL,
  "bannedTerms" TEXT NOT NULL,
  "colorPalette" TEXT NOT NULL,
  "motionRules" TEXT NOT NULL,
  "basePrompt" TEXT NOT NULL,
  "imageReferenceUrl" TEXT,
  "smsNumber" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "venueSafeMode" BOOLEAN NOT NULL DEFAULT true,
  "autoSelectEnabled" BOOLEAN NOT NULL DEFAULT true,
  "startedAt" DATETIME,
  "stoppedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DJSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PromptSubmission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sender" TEXT,
  "senderFingerprint" TEXT NOT NULL,
  "messageSid" TEXT,
  "rawText" TEXT NOT NULL,
  "normalizedText" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "approvalReason" TEXT,
  "selectedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PromptSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DJSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModerationResult" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "submissionId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "flags" TEXT NOT NULL,
  "explanation" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ModerationResult_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "PromptSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RankingResult" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "submissionId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "noveltyScore" INTEGER NOT NULL,
  "cohesionScore" INTEGER NOT NULL,
  "remixDeltaScore" INTEGER NOT NULL,
  "winningPrompt" TEXT NOT NULL,
  "explanation" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RankingResult_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "PromptSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VisualAsset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "sourceSubmissionId" TEXT,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "promptText" TEXT NOT NULL,
  "storagePath" TEXT,
  "publicUrl" TEXT,
  "thumbnailUrl" TEXT,
  "sourceVideoId" TEXT,
  "durationSeconds" INTEGER NOT NULL DEFAULT 8,
  "width" INTEGER NOT NULL DEFAULT 1280,
  "height" INTEGER NOT NULL DEFAULT 720,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "VisualAsset_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DJSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VisualAsset_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "PromptSubmission" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RenderJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "submissionId" TEXT,
  "sourceAssetId" TEXT,
  "outputAssetId" TEXT,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "openaiVideoId" TEXT,
  "promptText" TEXT NOT NULL,
  "failureReason" TEXT,
  "lastPolledAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RenderJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DJSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RenderJob_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "PromptSubmission" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RenderJob_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "VisualAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RenderJob_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "VisualAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaybackState" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "currentAssetId" TEXT,
  "nextAssetId" TEXT,
  "fallbackAssetId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'idle',
  "emergencyPaused" BOOLEAN NOT NULL DEFAULT false,
  "crossfadeSeconds" REAL NOT NULL DEFAULT 2.0,
  "lastTransitionAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PlaybackState_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DJSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlaybackState_currentAssetId_fkey" FOREIGN KEY ("currentAssetId") REFERENCES "VisualAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PlaybackState_nextAssetId_fkey" FOREIGN KEY ("nextAssetId") REFERENCES "VisualAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PlaybackState_fallbackAssetId_fkey" FOREIGN KEY ("fallbackAssetId") REFERENCES "VisualAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT,
  "userId" TEXT,
  "type" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "details" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DJSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DJSession_code_key" ON "DJSession"("code");

-- CreateIndex
CREATE INDEX "DJSession_userId_createdAt_idx" ON "DJSession"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromptSubmission_messageSid_key" ON "PromptSubmission"("messageSid");

-- CreateIndex
CREATE INDEX "PromptSubmission_sessionId_createdAt_idx" ON "PromptSubmission"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "PromptSubmission_sessionId_status_idx" ON "PromptSubmission"("sessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationResult_submissionId_key" ON "ModerationResult"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RankingResult_submissionId_key" ON "RankingResult"("submissionId");

-- CreateIndex
CREATE INDEX "VisualAsset_sessionId_createdAt_idx" ON "VisualAsset"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RenderJob_outputAssetId_key" ON "RenderJob"("outputAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "RenderJob_openaiVideoId_key" ON "RenderJob"("openaiVideoId");

-- CreateIndex
CREATE INDEX "RenderJob_sessionId_status_idx" ON "RenderJob"("sessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackState_sessionId_key" ON "PlaybackState"("sessionId");

-- CreateIndex
CREATE INDEX "AuditEvent_sessionId_createdAt_idx" ON "AuditEvent"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_type_createdAt_idx" ON "AuditEvent"("type", "createdAt");
