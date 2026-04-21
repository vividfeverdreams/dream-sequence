import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { createSessionCode, normalizePromptText } from "@/lib/utils";
import { queueAutomatedRender } from "@/lib/submission-pipeline";

type SessionInput = {
  name: string;
  artistName: string;
  trackName: string;
  creativeBible: string;
  allowedMotifs: string;
  bannedTerms: string;
  colorPalette: string;
  motionRules: string;
  basePrompt: string;
  imageReferenceUrl?: string;
  smsNumber?: string;
  venueSafeMode: boolean;
  autoSelectEnabled: boolean;
};

export async function createDjSession(userId: string, input: SessionInput) {
  const code = createSessionCode(`${input.artistName}-${input.trackName}`);

  const session = await db.dJSession.create({
    data: {
      userId,
      code,
      name: input.name,
      artistName: input.artistName,
      trackName: input.trackName,
      creativeBible: normalizePromptText(input.creativeBible),
      allowedMotifs: input.allowedMotifs,
      bannedTerms: input.bannedTerms,
      colorPalette: input.colorPalette,
      motionRules: input.motionRules,
      basePrompt: normalizePromptText(input.basePrompt),
      imageReferenceUrl: input.imageReferenceUrl || null,
      smsNumber: input.smsNumber || null,
      venueSafeMode: input.venueSafeMode,
      autoSelectEnabled: input.autoSelectEnabled,
      playbackState: {
        create: {
          status: "idle"
        }
      }
    },
    include: {
      playbackState: true
    }
  });

  await recordAuditEvent({
    type: "session.created",
    summary: `Created session ${session.name}`,
    sessionId: session.id,
    userId
  });

  return session;
}

export async function getPrimarySessionForUser(userId: string) {
  return db.dJSession.findFirst({
    where: {
      userId
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      playbackState: true
    }
  });
}

export async function startDjSession(sessionId: string, userId: string) {
  const ownedSession = await requireOwnedSession(sessionId, userId);

  const session = await db.dJSession.update({
    where: {
      id: ownedSession.id
    },
    data: {
      status: "live",
      startedAt: new Date(),
      stoppedAt: null,
      playbackState: {
        update: {
          status: "holding"
        }
      }
    },
    include: {
      playbackState: true,
      renderJobs: {
        where: {
          status: {
            in: ["queued", "in_progress"]
          }
        }
      }
    }
  });

  if (!session.playbackState?.currentAssetId && session.renderJobs.length === 0) {
    await queueAutomatedRender(session.id, null, "seed", session.basePrompt);
  }

  await recordAuditEvent({
    type: "session.started",
    summary: `Started session ${session.name}`,
    sessionId: session.id,
    userId
  });

  return session;
}

export async function stopDjSession(sessionId: string, userId: string) {
  const ownedSession = await requireOwnedSession(sessionId, userId);

  const session = await db.dJSession.update({
    where: {
      id: ownedSession.id
    },
    data: {
      status: "stopped",
      stoppedAt: new Date(),
      playbackState: {
        update: {
          emergencyPaused: true,
          status: "idle"
        }
      }
    }
  });

  await recordAuditEvent({
    type: "session.stopped",
    summary: `Stopped session ${session.name}`,
    sessionId: session.id,
    userId
  });

  return session;
}

export async function setSelectionPause(sessionId: string, userId: string, paused: boolean) {
  const ownedSession = await requireOwnedSession(sessionId, userId);

  const session = await db.dJSession.update({
    where: {
      id: ownedSession.id
    },
    data: {
      autoSelectEnabled: !paused,
      playbackState: {
        update: {
          emergencyPaused: paused
        }
      }
    }
  });

  await recordAuditEvent({
    type: paused ? "session.paused" : "session.resumed",
    summary: paused ? "Paused automated prompt selection" : "Resumed automated prompt selection",
    sessionId,
    userId
  });

  return session;
}

export async function forceTransitionToNext(sessionId: string, userId: string) {
  const session = await db.dJSession.findFirst({
    where: {
      id: sessionId,
      userId
    },
    include: {
      playbackState: true
    }
  });

  if (!session?.playbackState?.nextAssetId) {
    return null;
  }

  return completePlaybackTransition(sessionId);
}

export async function completePlaybackTransition(sessionId: string) {
  const playback = await db.playbackState.findUnique({
    where: {
      sessionId
    }
  });

  if (!playback?.nextAssetId) {
    return null;
  }

  await db.$transaction(async (tx: any) => {
    if (playback.currentAssetId) {
      await tx.visualAsset.update({
        where: {
          id: playback.currentAssetId
        },
        data: {
          status: "archived"
        }
      });
    }

    await tx.visualAsset.update({
      where: {
        id: playback.nextAssetId as string
      },
      data: {
        status: "live"
      }
    });

    await tx.playbackState.update({
      where: {
        id: playback.id
      },
      data: {
        currentAssetId: playback.nextAssetId,
        nextAssetId: null,
        status: "live",
        lastTransitionAt: new Date()
      }
    });
  });

  await recordAuditEvent({
    type: "playback.transitioned",
    summary: "Crossfaded to the queued visual asset",
    sessionId
  });

  return true;
}

export async function queueFallbackRemix(sessionId: string, userId: string) {
  const session = await db.dJSession.findFirst({
    where: {
      id: sessionId,
      userId
    }
  });

  if (!session) {
    return null;
  }

  const prompt = [
    session.basePrompt,
    "Shift the loop toward a calmer geometric pulse with resilient club-safe motion and a subtle palette reset.",
    "Keep the existing composition coherent and venue-safe."
  ].join(" ");

  await queueAutomatedRender(session.id, null, session.status === "live" ? "remix" : "seed", prompt);

  await recordAuditEvent({
    type: "session.fallback_remix",
    summary: "Queued a manual fallback remix",
    sessionId,
    userId
  });

  return true;
}

async function requireOwnedSession(sessionId: string, userId: string) {
  const session = await db.dJSession.findFirst({
    where: {
      id: sessionId,
      userId
    }
  });

  if (!session) {
    throw new Error("Session not found.");
  }

  return session;
}
