import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { hashPassword, verifyPassword } from "@/lib/auth-core";
import { db } from "@/lib/db";

const minPasswordLength = 12;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Typed characters go nowhere, so the password stays out of the screen and shell history.
async function askHidden(question: string) {
  process.stdout.write(question);
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
  const prompt = createInterface({ input: process.stdin, output: muted, terminal: true });
  const answer = await prompt.question("");
  prompt.close();
  process.stdout.write("\n");
  return answer;
}

async function ask(question: string) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(question);
  prompt.close();
  return answer.trim();
}

async function main() {
  if (!process.stdin.isTTY) {
    throw new Error("Run this in a terminal, so the password can be typed privately.");
  }

  const users = await db.user.findMany({
    select: { id: true, email: true, passwordHash: true }
  });

  if (users.length !== 1) {
    throw new Error(`Expected one DJ account, found ${users.length}.`);
  }

  const [user] = users;
  const databaseHost = new URL(process.env.DATABASE_URL ?? "postgres://unknown").hostname;
  console.log(`Database: ${databaseHost}`);
  console.log(`Current login email: ${user.email}\n`);

  const email = (await ask("New login email (Enter keeps the current one): ")).toLowerCase() || user.email;
  if (!emailPattern.test(email)) {
    throw new Error("That email doesn't look valid. Nothing was changed.");
  }

  const password = await askHidden(`New password, ${minPasswordLength}+ characters (hidden as you type): `);
  if (password.length < minPasswordLength) {
    throw new Error(`Use at least ${minPasswordLength} characters. Nothing was changed.`);
  }
  if (verifyPassword(password, user.passwordHash)) {
    throw new Error("That is the current password. Nothing was changed.");
  }

  const confirmation = await askHidden("Type it again: ");
  if (confirmation !== password) {
    throw new Error("Those didn't match. Nothing was changed.");
  }

  await db.user.update({
    where: { id: user.id },
    data: { email, passwordHash: hashPassword(password) }
  });

  console.log(`\nDone. Log in as ${email}. The old password no longer works, and every device is signed out.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Could not change the password.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
