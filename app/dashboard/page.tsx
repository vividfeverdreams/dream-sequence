import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getPrimarySessionForUser } from "@/lib/session-service";
import { getSessionSnapshot } from "@/lib/snapshot";
import { getOpenAiConnectionStatusForUser } from "@/lib/openai-key-store";
import { DashboardShell } from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const session = await getPrimarySessionForUser(user.id);

  if (!session) {
    redirect("/sessions/new");
  }

  const snapshot = await getSessionSnapshot(session.id);

  if (!snapshot) {
    return null;
  }

  const openAiStatus = await getOpenAiConnectionStatusForUser(user.id);

  return (
    <DashboardShell
      initialSnapshot={snapshot}
      currentUserName={user.displayName}
      initialOpenAiStatus={openAiStatus}
    />
  );
}
