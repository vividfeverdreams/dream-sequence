import { hashPassword, verifyPassword } from "@/lib/auth-core";
import { db } from "@/lib/db";

const minPasswordLength = 12;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeSequence = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

// Reads a line key by key. Password keys show as dots, so typing is visibly
// working while the password stays off the screen and out of shell history.
// An Enter with nothing typed is ignored unless allowEmpty is set, so a stray
// Enter can't submit a prompt before anything was typed.
function readLine(question: string, options: { hidden?: boolean; allowEmpty?: boolean } = {}) {
  const { stdin, stdout } = process;

  return new Promise<string>((resolve) => {
    let characters: string[] = [];

    const stop = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8").replace(escapeSequence, "")) {
        if (character === "\u0003") {
          stop();
          stdout.write("\nCancelled. Nothing was changed.\n");
          process.exit(130);
        }

        if (character === "\r" || character === "\n") {
          if (characters.length > 0 || options.allowEmpty) {
            stop();
            stdout.write("\n");
            resolve(characters.join(""));
            return;
          }
          continue;
        }

        if (character === "\u007f" || character === "\b") {
          if (characters.length > 0) {
            characters = characters.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }

        if (character >= " ") {
          characters.push(character);
          stdout.write(options.hidden ? "•" : character);
        }
      }
    };

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function askForEmail(currentEmail: string) {
  const fromCommand = process.argv[2]?.trim().toLowerCase();
  if (fromCommand) {
    if (!emailPattern.test(fromCommand)) {
      throw new Error("That email doesn't look valid. Nothing was changed.");
    }
    return fromCommand;
  }

  while (true) {
    const answer = (await readLine("New login email (Enter keeps the current one): ", { allowEmpty: true }))
      .trim()
      .toLowerCase();
    if (!answer) {
      return currentEmail;
    }
    if (emailPattern.test(answer)) {
      return answer;
    }
    console.log("That email doesn't look valid. Try again.\n");
  }
}

async function askForPassword(currentHash: string) {
  while (true) {
    const password = await readLine(`New password (${minPasswordLength}+ characters): `, { hidden: true });

    if (password.length < minPasswordLength) {
      console.log(`That was ${password.length} characters. Use at least ${minPasswordLength}. Try again.\n`);
      continue;
    }
    if (verifyPassword(password, currentHash)) {
      console.log("That is the current password. Pick a different one.\n");
      continue;
    }

    const confirmation = await readLine("Type it again: ", { hidden: true });
    if (confirmation === password) {
      return password;
    }
    console.log("Those didn't match. Try again.\n");
  }
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
  console.log(`Current login email: ${user.email}`);
  console.log("Dots appear as you type the password. Ctrl-C cancels.\n");

  const email = await askForEmail(user.email);
  console.log(`New login email: ${email}\n`);

  const password = await askForPassword(user.passwordHash);

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
