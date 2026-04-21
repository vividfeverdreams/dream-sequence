import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getEffectiveOpenAiApiKeyForUser } from "@/lib/openai-key-store";
import { persistVideoAsset, getDemoLoopUrl, getStoredVideoPath } from "@/lib/storage";

type StartRenderInput = {
  mode: "seed" | "remix";
  prompt: string;
  sourceVideoId?: string | null;
  imageReferenceUrl?: string | null;
  openAiApiKey?: string | null;
};

type StartedRender =
  | {
      kind: "demo";
      videoId: string;
      publicUrl: string;
      storagePath: null;
    }
  | {
      kind: "live";
      videoId: string;
    };

export async function startVideoRender(input: StartRenderInput): Promise<StartedRender> {
  if (!input.openAiApiKey) {
    return {
      kind: "demo",
      videoId: `demo_${Date.now()}`,
      publicUrl: getDemoLoopUrl(),
      storagePath: null
    };
  }

  if (input.mode === "seed" || !input.sourceVideoId || !input.sourceVideoId.startsWith("video_")) {
    const created = await callOpenAiVideoApi<{ id: string }>("https://api.openai.com/v1/videos", input.openAiApiKey, {
      method: "POST",
      body: JSON.stringify({
        model: env.openAiVideoModel,
        prompt: input.prompt,
        size: "1280x720",
        seconds: "8"
      })
    });

    return {
      kind: "live",
      videoId: created.id
    };
  }

  const payload = await callOpenAiVideoApi<{ id: string }>(
    "https://api.openai.com/v1/videos/edits",
    input.openAiApiKey,
    {
      method: "POST",
      body: JSON.stringify({
        video: {
          id: input.sourceVideoId
        },
        prompt: input.prompt
      })
    }
  );

  return {
    kind: "live",
    videoId: payload.id
  };
}

export async function reconcileRenderJob(renderJobId: string) {
  const renderJob = await db.renderJob.findUnique({
    where: {
      id: renderJobId
    },
    include: {
      outputAsset: true,
      session: {
        include: {
          playbackState: true
        }
      }
    }
  });

  if (!renderJob || !renderJob.outputAsset) {
    return null;
  }

  const apiKey = renderJob.session?.userId
    ? await getEffectiveOpenAiApiKeyForUser(String(renderJob.session.userId))
    : null;

  if (!apiKey) {
    await markRenderJobReady(renderJob.id, renderJob.outputAsset.id, {
      publicUrl: getDemoLoopUrl(),
      storagePath: null,
      sourceVideoId: renderJob.openaiVideoId ?? `demo_${renderJob.id}`
    });
    return "completed";
  }

  if (!renderJob.openaiVideoId) {
    await db.renderJob.update({
      where: {
        id: renderJob.id
      },
      data: {
        status: "failed",
        failureReason: "Render job never received an OpenAI video id.",
        lastPolledAt: new Date()
      }
    });

    await db.visualAsset.update({
      where: {
        id: renderJob.outputAsset.id
      },
      data: {
        status: "failed"
      }
    });

    if (renderJob.submissionId) {
      await db.promptSubmission.update({
        where: {
          id: renderJob.submissionId
        },
        data: {
          status: "approved",
          selectedAt: null
        }
      });
    }

    return "failed";
  }

  const status = await callOpenAiVideoApi<{ status: "queued" | "in_progress" | "completed" | "failed" }>(
    `https://api.openai.com/v1/videos/${renderJob.openaiVideoId}`,
    apiKey
  );

  if (status.status === "completed") {
    const response = await fetch(`https://api.openai.com/v1/videos/${renderJob.openaiVideoId}/content`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download video content for ${renderJob.openaiVideoId}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const saved = await persistVideoAsset(renderJob.outputAsset.id, buffer);

    await markRenderJobReady(renderJob.id, renderJob.outputAsset.id, {
      publicUrl: saved.publicUrl,
      storagePath: saved.storagePath,
      sourceVideoId: renderJob.openaiVideoId
    });

    return "completed";
  }

  if (status.status === "failed") {
    await db.renderJob.update({
      where: {
        id: renderJob.id
      },
      data: {
        status: "failed",
        failureReason: "Sora reported a failed render.",
        lastPolledAt: new Date()
      }
    });

    return "failed";
  }

  await db.renderJob.update({
    where: {
      id: renderJob.id
    },
    data: {
      status: status.status,
      lastPolledAt: new Date()
    }
  });

  return status.status;
}

async function markRenderJobReady(
  renderJobId: string,
  assetId: string,
  input: {
    publicUrl: string;
    storagePath: string | null;
    sourceVideoId: string;
  }
) {
  const renderJob = await db.renderJob.findUnique({
    where: {
      id: renderJobId
    },
    include: {
      session: {
        include: {
          playbackState: true
        }
      },
      submission: true
    }
  });

  const playbackState = renderJob?.session.playbackState;

  if (!renderJob || !playbackState) {
    return;
  }

  await db.$transaction(async (tx: any) => {
    await tx.visualAsset.update({
      where: {
        id: assetId
      },
      data: {
        status: "ready",
        publicUrl: input.publicUrl,
        storagePath: input.storagePath,
        sourceVideoId: input.sourceVideoId
      }
    });

    await tx.renderJob.update({
      where: {
        id: renderJobId
      },
      data: {
        status: "completed",
        completedAt: new Date(),
        lastPolledAt: new Date()
      }
    });

    if (!playbackState.currentAssetId) {
      await tx.playbackState.update({
        where: {
          id: playbackState.id
        },
        data: {
          currentAssetId: assetId,
          status: "live",
          lastTransitionAt: new Date()
        }
      });

      await tx.visualAsset.update({
        where: {
          id: assetId
        },
        data: {
          status: "live"
        }
      });
    } else if (!playbackState.nextAssetId) {
      await tx.playbackState.update({
        where: {
          id: playbackState.id
        },
        data: {
          nextAssetId: assetId,
          status: "live"
        }
      });
    }

    if (renderJob.submissionId) {
      await tx.promptSubmission.update({
        where: {
          id: renderJob.submissionId
        },
        data: {
          status: playbackState.currentAssetId ? "ready" : "live"
        }
      });
    }
  });
}

export async function readStoredAsset(assetId: string) {
  const filePath = getStoredVideoPath(assetId);
  return readFile(filePath);
}

async function callOpenAiVideoApi<T>(url: string, apiKey: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    let parsedMessage: string | null = null;

    try {
      const parsed = JSON.parse(errorText) as {
        error?: {
          message?: string;
          code?: string | null;
        };
      };

      const message = parsed.error?.message?.trim();
      const code = parsed.error?.code?.trim();

      if (message) {
        parsedMessage = code
          ? `OpenAI video request failed: ${message} (${code})`
          : `OpenAI video request failed: ${message}`;
      }
    } catch {
      // Fall through to a plain-text fallback if the body is not JSON.
    }

    if (parsedMessage) {
      throw new Error(parsedMessage);
    }

    const fallbackMessage = errorText.trim();

    throw new Error(
      fallbackMessage
        ? `OpenAI video request failed with ${response.status}: ${fallbackMessage}`
        : `OpenAI video request failed with ${response.status}`
    );
  }

  return (await response.json()) as T;
}
