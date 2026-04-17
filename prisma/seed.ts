import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/auth-core";
import { createSessionCode } from "@/lib/utils";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_DJ_EMAIL ?? "dj@example.com";
  const password = process.env.SEED_DJ_PASSWORD ?? "crowdremix-demo";

  const user = await prisma.user.upsert({
    where: {
      email
    },
    update: {
      displayName: "Demo DJ"
    },
    create: {
      email,
      passwordHash: hashPassword(password),
      displayName: "Demo DJ"
    }
  });

  const existingSession = await prisma.dJSession.findFirst({
    where: {
      userId: user.id
    }
  });

  if (!existingSession) {
    await prisma.dJSession.create({
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

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
