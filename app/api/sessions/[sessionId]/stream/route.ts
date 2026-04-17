import { getSessionSnapshot } from "@/lib/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StreamRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: Request, { params }: StreamRouteProps) {
  const { sessionId } = await params;
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const pushSnapshot = async () => {
        if (closed) {
          return;
        }

        const snapshot = await getSessionSnapshot(sessionId);

        if (!snapshot) {
          if (interval) {
            clearInterval(interval);
          }
          controller.enqueue(encoder.encode("event: close\ndata: {}\n\n"));
          controller.close();
          closed = true;
          return;
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
      };

      await pushSnapshot();

      interval = setInterval(() => {
        void pushSnapshot();
      }, 3000);
    },
    cancel() {
      if (interval) {
        clearInterval(interval);
      }
      return undefined;
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
