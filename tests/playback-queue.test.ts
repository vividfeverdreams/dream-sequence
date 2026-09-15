import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  playbackRotationSize,
  promoteOldestReadyAsset
} from "@/lib/playback-queue";

describe("three-video playback rotation", () => {
  const client = {
    playbackState: {
      findUnique: vi.fn(),
      updateMany: vi.fn()
    },
    visualAsset: {
      findFirst: vi.fn(),
      findMany: vi.fn()
    }
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps only the newest three story videos cycling when no fresh video is ready", async () => {
    const assets = Array.from({ length: 5 }, (_, index) => ({
      id: `chapter-${index + 1}`,
      kind: "remix",
      status: "archived",
      createdAt: new Date(Date.UTC(2026, 8, 13, 12, index + 1))
    }));
    let currentAssetId = "chapter-5";

    client.playbackState.findUnique.mockImplementation(async () => ({
      id: "playback-1",
      currentAssetId,
      nextAssetId: null
    }));
    client.visualAsset.findFirst.mockImplementation(async ({ where }) =>
      where.status === "ready"
        ? null
        : assets.find((asset) => asset.id === where.id) ?? null
    );
    client.visualAsset.findMany.mockImplementation(async ({ take }) =>
      assets.filter((asset) => asset.id !== currentAssetId).reverse().slice(0, take)
    );
    client.playbackState.updateMany.mockResolvedValue({ count: 1 });

    for (const expectedNextId of [
      "chapter-3",
      "chapter-4",
      "chapter-5",
      "chapter-3"
    ]) {
      await expect(
        promoteOldestReadyAsset("session-1", client)
      ).resolves.toBe(expectedNextId);
      expect(client.playbackState.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: "playback-1",
          currentAssetId,
          nextAssetId: null
        },
        data: {
          nextAssetId: expectedNextId,
          status: "live"
        }
      });
      currentAssetId = expectedNextId;
    }
  });

  it("prioritizes the oldest fresh ready asset over archived rotation peers", async () => {
    client.playbackState.findUnique.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-current",
      nextAssetId: null
    });
    client.visualAsset.findFirst.mockResolvedValue({
      id: "asset-fresh"
    });
    client.playbackState.updateMany.mockResolvedValue({
      count: 1
    });

    await expect(
      promoteOldestReadyAsset("session-1", client)
    ).resolves.toBe("asset-fresh");

    expect(client.visualAsset.findFirst).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
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
    expect(client.visualAsset.findMany).not.toHaveBeenCalled();
    expect(client.playbackState.updateMany).toHaveBeenCalledWith({
      where: {
        id: "playback-1",
        currentAssetId: "asset-current",
        nextAssetId: null
      },
      data: {
        nextAssetId: "asset-fresh",
        status: "live"
      }
    });
  });

  it("introduces fresh remix five immediately after the original, before rotating remix three through five", async () => {
    client.playbackState.findUnique
      .mockResolvedValueOnce({
        id: "playback-1",
        currentAssetId: "original",
        nextAssetId: null
      })
      .mockResolvedValueOnce({
        id: "playback-1",
        currentAssetId: "remix-5",
        nextAssetId: null
      });
    client.visualAsset.findFirst
      .mockResolvedValueOnce({
        id: "remix-5"
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "remix-5",
        kind: "remix",
        status: "live",
        createdAt: new Date("2026-07-28T12:05:00.000Z")
      });
    client.visualAsset.findMany.mockResolvedValue([
      {
        id: "remix-4",
        kind: "remix",
        status: "archived",
        createdAt: new Date("2026-07-28T12:04:00.000Z")
      },
      {
        id: "remix-3",
        kind: "remix",
        status: "archived",
        createdAt: new Date("2026-07-28T12:03:00.000Z")
      },
      {
        id: "remix-2",
        kind: "remix",
        status: "archived",
        createdAt: new Date("2026-07-28T12:02:00.000Z")
      },
      {
        id: "remix-1",
        kind: "remix",
        status: "archived",
        createdAt: new Date("2026-07-28T12:01:00.000Z")
      },
      {
        id: "original",
        kind: "seed",
        status: "archived",
        createdAt: new Date("2026-07-28T12:00:00.000Z")
      }
    ]);
    client.playbackState.updateMany.mockResolvedValue({
      count: 1
    });

    await expect(
      promoteOldestReadyAsset("session-1", client)
    ).resolves.toBe("remix-5");

    expect(client.visualAsset.findMany).not.toHaveBeenCalled();
    expect(client.playbackState.updateMany).toHaveBeenCalledWith({
      where: {
        id: "playback-1",
        currentAssetId: "original",
        nextAssetId: null
      },
      data: {
        nextAssetId: "remix-5",
        status: "live"
      }
    });

    await expect(
      promoteOldestReadyAsset("session-1", client)
    ).resolves.toBe("remix-3");
  });

  it("cycles deterministically to the chronological successor within the latest three playable assets", async () => {
    client.playbackState.findUnique.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-3",
      nextAssetId: null
    });
    client.visualAsset.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "asset-3",
        createdAt: new Date("2026-07-28T12:03:00.000Z")
      });
    client.visualAsset.findMany.mockResolvedValue([
      {
        id: "asset-5",
        createdAt: new Date("2026-07-28T12:05:00.000Z")
      },
      {
        id: "asset-4",
        createdAt: new Date("2026-07-28T12:04:00.000Z")
      },
      {
        id: "asset-2",
        createdAt: new Date("2026-07-28T12:02:00.000Z")
      },
      {
        id: "asset-1",
        createdAt: new Date("2026-07-28T12:01:00.000Z")
      }
    ]);
    client.playbackState.updateMany.mockResolvedValue({
      count: 1
    });

    await expect(
      promoteOldestReadyAsset("session-1", client)
    ).resolves.toBe("asset-4");

    expect(client.visualAsset.findMany).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
        id: {
          not: "asset-3"
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
    expect(client.playbackState.updateMany).toHaveBeenCalledWith({
      where: {
        id: "playback-1",
        currentAssetId: "asset-3",
        nextAssetId: null
      },
      data: {
        nextAssetId: "asset-4",
        status: "live"
      }
    });
  });

  it.each([1, 6])("queries three bounded peers and selects the newest window from current asset %s", async (currentIndex) => {
    const currentAssetId = `asset-${currentIndex}`;
    const assets = Array.from({ length: 6 }, (_, index) => ({
      id: `asset-${index + 1}`,
      createdAt: new Date(Date.UTC(2026, 6, 28, 12, index + 1))
    }));
    client.playbackState.findUnique.mockResolvedValue({
      id: "playback-1",
      currentAssetId,
      nextAssetId: null
    });
    client.visualAsset.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(assets[currentIndex - 1]);
    client.visualAsset.findMany.mockImplementation(async ({ take }) =>
      assets.filter((asset) => asset.id !== currentAssetId).reverse().slice(0, take)
    );
    client.playbackState.updateMany.mockResolvedValue({
      count: 1
    });

    await expect(
      promoteOldestReadyAsset("session-1", client)
    ).resolves.toBe("asset-4");

    const rotationQuery = client.visualAsset.findMany.mock.calls[0]?.[0];
    expect(rotationQuery.take).toBe(3);
    expect(rotationQuery.orderBy).toEqual([
      {
        createdAt: "desc"
      },
      {
        id: "desc"
      }
    ]);
    expect(rotationQuery.where.id).toEqual({
      not: currentAssetId
    });
  });

  it("introduces remix six, then wraps to remix four after remix three is evicted", async () => {
    client.playbackState.findUnique
      .mockResolvedValueOnce({
        id: "playback-1",
        currentAssetId: "remix-5",
        nextAssetId: null
      })
      .mockResolvedValueOnce({
        id: "playback-1",
        currentAssetId: "remix-6",
        nextAssetId: null
      });
    client.visualAsset.findFirst
      .mockResolvedValueOnce({
        id: "remix-6"
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "remix-6",
        kind: "remix",
        status: "live",
        createdAt: new Date("2026-07-28T12:06:00.000Z")
      });
    client.visualAsset.findMany.mockResolvedValue([
      {
        id: "remix-5",
        kind: "remix",
        status: "archived",
        createdAt: new Date("2026-07-28T12:05:00.000Z")
      },
      {
        id: "remix-4",
        kind: "remix",
        status: "archived",
        createdAt: new Date("2026-07-28T12:04:00.000Z")
      },
      {
        id: "remix-3",
        kind: "remix",
        status: "archived",
        createdAt: new Date("2026-07-28T12:03:00.000Z")
      },
      {
        id: "remix-2",
        kind: "remix",
        status: "archived",
        createdAt: new Date("2026-07-28T12:02:00.000Z")
      },
      {
        id: "remix-1",
        kind: "remix",
        status: "archived",
        createdAt: new Date("2026-07-28T12:01:00.000Z")
      }
    ]);
    client.playbackState.updateMany.mockResolvedValue({
      count: 1
    });

    await expect(
      promoteOldestReadyAsset("session-1", client)
    ).resolves.toBe("remix-6");
    await expect(
      promoteOldestReadyAsset("session-1", client)
    ).resolves.toBe("remix-4");
  });

  it("wraps from the newest current asset to the oldest peer in a two-video ring", async () => {
    client.playbackState.findUnique.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-newer",
      nextAssetId: null
    });
    client.visualAsset.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "asset-newer",
        createdAt: new Date("2026-07-28T12:02:00.000Z")
      });
    client.visualAsset.findMany.mockResolvedValue([
      {
        id: "asset-older",
        createdAt: new Date("2026-07-28T12:01:00.000Z")
      }
    ]);
    client.playbackState.updateMany.mockResolvedValue({
      count: 1
    });

    await expect(
      promoteOldestReadyAsset("session-1", client)
    ).resolves.toBe("asset-older");
  });

  it("leaves the next slot empty for a one-video self-loop", async () => {
    client.playbackState.findUnique.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-only",
      nextAssetId: null
    });
    client.visualAsset.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "asset-only",
        createdAt: new Date("2026-07-28T12:00:00.000Z")
      });
    client.visualAsset.findMany.mockResolvedValue([]);

    await expect(
      promoteOldestReadyAsset("session-1", client)
    ).resolves.toBeNull();

    expect(client.playbackState.updateMany).not.toHaveBeenCalled();
  });

  it("does not replace an occupied next slot", async () => {
    client.playbackState.findUnique.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-current",
      nextAssetId: "asset-already-queued"
    });

    await expect(
      promoteOldestReadyAsset("session-1", client)
    ).resolves.toBeNull();

    expect(client.visualAsset.findFirst).not.toHaveBeenCalled();
    expect(client.visualAsset.findMany).not.toHaveBeenCalled();
    expect(client.playbackState.updateMany).not.toHaveBeenCalled();
  });

  it("returns no candidate when the current asset changes before the CAS claim", async () => {
    client.playbackState.findUnique.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-current",
      nextAssetId: null
    });
    client.visualAsset.findFirst.mockResolvedValue({
      id: "asset-ready"
    });
    client.playbackState.updateMany.mockResolvedValue({
      count: 0
    });

    await expect(
      promoteOldestReadyAsset("session-1", client)
    ).resolves.toBeNull();

    expect(client.playbackState.updateMany).toHaveBeenCalledWith({
      where: {
        id: "playback-1",
        currentAssetId: "asset-current",
        nextAssetId: null
      },
      data: {
        nextAssetId: "asset-ready",
        status: "live"
      }
    });
  });

  it("leaves the current asset looping after a transition when archived rotation is disabled", async () => {
    client.playbackState.findUnique.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-new-remix",
      nextAssetId: null
    });
    client.visualAsset.findFirst.mockResolvedValue(null);

    await expect(
      promoteOldestReadyAsset("session-1", client, {
        allowArchivedRotation: false
      })
    ).resolves.toBeNull();

    expect(client.visualAsset.findMany).not.toHaveBeenCalled();
    expect(client.playbackState.updateMany).not.toHaveBeenCalled();
  });
});
