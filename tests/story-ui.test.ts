import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findSession: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => { throw new Error("NOT_FOUND"); }
}));
vi.mock("@/lib/db", () => ({ db: { dJSession: { findUnique: mocks.findSession } } }));

import { SessionSetupForm } from "@/components/session-setup-form";
import PublicSubmissionPage from "@/app/r/[sessionCode]/page";
import { ShowScreen } from "@/components/show-screen";
import type { SessionSnapshot } from "@/lib/snapshot";

vi.stubGlobal("React", React);

describe("story audience flow", () => {
  beforeEach(() => {
    mocks.findSession.mockResolvedValue({
      code: "STORY1", name: "A door among the stars", status: "live", audienceMode: "web", twitchChannel: null
    });
  });

  it("requires only the opening story text and offers supported clip presets", () => {
    const markup = renderToStaticMarkup(React.createElement(SessionSetupForm));
    expect(markup).toContain("How does your story begin?");
    expect(markup.match(/required=""/g)).toHaveLength(1);
    expect(markup).toContain('name="basePrompt"');
    expect(markup).toMatch(/name="videoDurationSeconds"[^>]*value="5"/);
    expect(markup).toContain('name="videoDurationSeconds" value="10"');
    expect(markup).toContain('name="videoDurationSeconds" value="15"');
    for (const resolution of ["480P", "768P", "1080P"]) {
      expect(markup).toMatch(new RegExp(`name="videoResolution"[^>]*value="${resolution}"`));
    }
    expect(markup).toContain('name="audienceMode" value="twitch"');
    expect(markup).not.toContain('name="videoModel"');
    expect(markup).not.toContain('type="file"');
  });

  it("lets a QR visitor write an original continuation without a required nickname", async () => {
    const page = await PublicSubmissionPage({ params: Promise.resolve({ sessionCode: "STORY1" }) });
    const markup = renderToStaticMarkup(page);
    expect(markup).toContain("What happens next?");
    expect(markup).toContain('name="prompt"');
    expect(markup).toContain('name="senderLabel"');
    expect(markup.match(/required=""/g)).toHaveLength(1);
    expect(markup).not.toContain('type="file"');
    expect(markup).not.toContain("remix statement");
  });

  it("routes Twitch viewers to chat without exposing a competing web submission form", async () => {
    mocks.findSession.mockResolvedValue({ code: "STORY1", name: "Star door", status: "live", audienceMode: "twitch", twitchChannel: "storyhost" });
    const markup = renderToStaticMarkup(await PublicSubmissionPage({ params: Promise.resolve({ sessionCode: "STORY1" }) }));
    expect(markup).toContain("!next");
    expect(markup).toContain('href="https://www.twitch.tv/storyhost"');
    expect(markup).not.toContain("<form");
  });

  it("keeps a paused story form closed to new ideas", async () => {
    mocks.findSession.mockResolvedValue({ code: "STORY1", name: "Star door", status: "stopped", audienceMode: "web" });
    const markup = renderToStaticMarkup(await PublicSubmissionPage({ params: Promise.resolve({ sessionCode: "STORY1" }) }));
    expect(markup).toContain("This story is paused");
    expect(markup.match(/<textarea[^>]*>/)?.[0]).toContain('disabled=""');
  });

  it("shows the Twitch command on the show output when Twitch mode is selected", () => {
    const snapshot = {
      session: {
        id: "session-1", userId: "user-1", audienceMode: "twitch", twitchChannel: "storyhost",
        playbackState: null, visualAssets: [], renderJobs: [], wordmarkOverlayVisible: false,
        wordmarkAudioReactiveOnly: false, wordmarkOpacity: 1, wordmarkSize: 1,
        progressOverlayVisible: false, qrOverlayVisible: true
      },
      queueHealth: { approvedCount: 0, queuedRenderCount: 0, renderingCount: 0, readyAssetCount: 0, waitingOnRender: false }
    } as unknown as NonNullable<SessionSnapshot>;
    const markup = renderToStaticMarkup(React.createElement(ShowScreen, { initialSnapshot: snapshot }));
    expect(markup).toContain("type !next in chat to continue the story");
    expect(markup).not.toContain("twitch.tv/storyhost");
    expect(markup).not.toContain("QR code");
  });
});
