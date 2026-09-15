import { db } from "@/lib/db";
import {
  getNextPlaybackRotationAsset,
  playbackRotationSize
} from "@/lib/remix-transition";

export { playbackRotationSize };

type PromoteOldestReadyAssetOptions = {
  allowArchivedRotation?: boolean;
};

type PlaybackQueueClient = {
  playbackState: {
    findUnique: (args: any) => Promise<{
      id: string;
      currentAssetId: string | null;
      nextAssetId: string | null;
    } | null>;
    updateMany: (args: any) => Promise<{
      count: number;
    }>;
  };
  visualAsset: {
    findFirst: (args: any) => Promise<{
      id: string;
      kind?: string;
      status?: string;
      createdAt?: Date;
    } | null>;
    findMany: (args: any) => Promise<Array<{
      id: string;
      kind: string;
      status: string;
      createdAt: Date;
    }>>;
  };
};

export async function promoteOldestReadyAsset(
  sessionId: string,
  client: PlaybackQueueClient = db,
  options: PromoteOldestReadyAssetOptions = {}
) {
  const playback = await client.playbackState.findUnique({
    where: {
      sessionId
    },
    select: {
      id: true,
      currentAssetId: true,
      nextAssetId: true
    }
  });

  if (!playback || playback.nextAssetId) {
    return null;
  }

  const freshCandidate = await client.visualAsset.findFirst({
    where: {
      sessionId,
      status: "ready",
      publicUrl: {
        not: null
      }
    },
    orderBy: [
      {
        createdAt: "asc"
      },
      {
        id: "asc"
      }
    ],
    select: {
      id: true
    }
  });
  let candidate = freshCandidate;

  if (
    !candidate &&
    options.allowArchivedRotation !== false &&
    playback.currentAssetId
  ) {
    const currentAsset = await client.visualAsset.findFirst({
      where: {
        id: playback.currentAssetId,
        sessionId,
        publicUrl: {
          not: null
        }
      },
      select: {
        id: true,
        kind: true,
        status: true,
        createdAt: true
      }
    });

    if (!currentAsset?.createdAt) {
      return null;
    }

    const rotationPeers = await client.visualAsset.findMany({
      where: {
        sessionId,
        id: {
          not: playback.currentAssetId
        },
        status: {
          in: ["live", "archived"]
        },
        publicUrl: {
          not: null
        }
      },
      orderBy: [
        {
          createdAt: "desc"
        },
        {
          id: "desc"
        }
      ],
      take: playbackRotationSize,
      select: {
        id: true,
        kind: true,
        status: true,
        createdAt: true
      }
    });

    candidate = getNextPlaybackRotationAsset(
      [
        {
          id: currentAsset.id,
          kind: currentAsset.kind ?? undefined,
          createdAt: currentAsset.createdAt
        },
        ...rotationPeers
      ],
      playback.currentAssetId,
      playbackRotationSize
    );
  }

  if (!candidate) {
    return null;
  }

  const claim = await client.playbackState.updateMany({
    where: {
      id: playback.id,
      currentAssetId: playback.currentAssetId,
      nextAssetId: null
    },
    data: {
      nextAssetId: candidate.id,
      status: "live"
    }
  });

  return claim.count === 1 ? candidate.id : null;
}
