import { notFound } from "next/navigation";
import { getOpenAiConnectionStatusForSession } from "@/lib/openai-key-store";
import { getSessionSnapshot } from "@/lib/snapshot";
import { ShowScreen } from "@/components/show-screen";

export const dynamic = "force-dynamic";

type ShowPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
  searchParams: Promise<{
    output?: string | string[];
  }>;
};

export default async function ShowPage({ params, searchParams }: ShowPageProps) {
  const { sessionId } = await params;
  const { output } = await searchParams;
  const snapshot = await getSessionSnapshot(sessionId);

  if (!snapshot) {
    notFound();
  }

  const openAiStatus = await getOpenAiConnectionStatusForSession(sessionId);
  const outputMode = Array.isArray(output) ? output[0] : output;

  return <ShowScreen initialSnapshot={snapshot} openAiConfigured={openAiStatus.configured} cleanOutput={outputMode === "clean"} />;
}
