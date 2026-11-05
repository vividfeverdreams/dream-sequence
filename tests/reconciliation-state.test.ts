import { describe, expect, it } from "vitest";
import { shouldReconcileSession } from "@/components/dashboard-shell";

describe("dashboard reconciliation scheduling", () => {
  it("keeps reconciling a live session with an approved prompt or stranded ready asset", () => {
    expect(
      shouldReconcileSession({
        sessionStatus: "live",
        waitingOnRender: false,
        approvedCount: 1,
        hasReadyAsset: false
      })
    ).toBe(true);
    expect(
      shouldReconcileSession({
        sessionStatus: "live",
        waitingOnRender: false,
        approvedCount: 0,
        hasReadyAsset: true
      })
    ).toBe(true);
  });

  it("keeps checking idle live stories and stops polling inactive sessions", () => {
    expect(
      shouldReconcileSession({
        sessionStatus: "live",
        waitingOnRender: false,
        approvedCount: 0,
        hasReadyAsset: false
      })
    ).toBe(true);
    expect(
      shouldReconcileSession({
        sessionStatus: "stopped",
        waitingOnRender: true,
        approvedCount: 1,
        hasReadyAsset: true
      })
    ).toBe(false);
  });
});
