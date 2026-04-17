import { db } from "@/lib/db";

type AuditInput = {
  type: string;
  summary: string;
  details?: string;
  sessionId?: string;
  userId?: string;
};

export async function recordAuditEvent(input: AuditInput) {
  await db.auditEvent.create({
    data: input
  });
}
