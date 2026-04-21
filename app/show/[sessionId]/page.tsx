import { notFound } from "next/navigation";
import { getOpenAiConnectionStatusForSession } from "@/lib/openai-key-store";
import { getSessionSnapshot } from "@/lib/snapshot";
import { ShowScreen } from "@/components/show-screen";

export const dynamic = "force-dynamic";

type ShowPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function ShowPage({ params }: ShowPageProps) {
  const { sessionId } = await params;
  const snapshot = await getSessionSnapshot(sessionId);

  if (!snapshot) {
    notFound();
  }

  const openAiStatus = await getOpenAiConnectionStatusForSession(sessionId);

  return <ShowScreen initialSnapshot={snapshot} openAiConfigured={openAiStatus.configured} />;
}
