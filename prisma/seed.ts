import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth-core";
import { createSessionCode } from "@/lib/utils";

async function main() {
  const email = process.env.SEED_DJ_EMAIL ?? "dj@example.com";
  const password = process.env.SEED_DJ_PASSWORD ?? "dreamsequence-demo";

  const existing = await db.user.findUnique({ where: { email } });

  const user = existing
    ? await db.user.update({
        where: { email },
        data: { displayName: "Demo DJ" }
      })
    : await db.user.create({
        data: {
          email,
          passwordHash: hashPassword(password),
          displayName: "Demo DJ"
        }
      });

  const existingSession = await db.dJSession.findFirst({
    where: {
      userId: user.id
    }
  });

  if (!existingSession) {
    await db.dJSession.create({
      data: {
        userId: user.id,
        code: createSessionCode("neon-echo"),
        name: "Neon Echo Launch Set",
        artistName: "Neon Echo",
        trackName: "Skyline Pressure",
        creativeBible:
          "Kinetic abstract architecture, mirrored tunnel depth, humid atmosphere, elegant strobe restraint, no literal characters.",
        allowedMotifs: "laser lattice, liquid chrome, skyline fragments, pulse halos",
        bannedTerms: "violence, gore, nudity, celebrity, cartoon mascot",
        colorPalette: "teal, ember, dusk blue, warm sand",
        motionRules: "slow camera drift, pulse on phrase changes, never become chaotic or shaky",
        basePrompt:
          "A looping wide cinematic abstract concert visual with mirrored architecture, chrome fog, pulse halos, and elegant nightclub motion.",
        status: "draft",
        venueSafeMode: true,
        autoSelectEnabled: true,
        playbackState: {
          create: {
            status: "idle"
          }
        }
      }
    });
  }

  console.log(`Seeded demo DJ: ${email}`);
  console.log(`Seeded password: ${password}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
