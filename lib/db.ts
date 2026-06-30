import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var dreamSequencePrisma: PrismaClient | undefined;
}

export const db = global.dreamSequencePrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.dreamSequencePrisma = db;
}
