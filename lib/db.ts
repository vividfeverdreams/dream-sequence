import { randomUUID } from "crypto";
import fs from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { get as getBlob, put as putBlob } from "@vercel/blob";
import { hashPassword } from "@/lib/auth-core";
import { env } from "@/lib/env";
import {
  defaultAudiencePromptGuide,
  defaultAutomoderationPrompt,
  defaultNegativePrompt,
  defaultRemixPromptTemplate,
  defaultSystemPrompt
} from "@/lib/session-defaults";

type WhereValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | {
      in?: Array<string | number>;
      gte?: Date | string;
    };

type WhereInput = Record<string, WhereValue>;
type OrderByInput = Record<string, "asc" | "desc"> | undefined;

type IncludeInput = Record<string, unknown> | undefined;
type SqlInputValue = string | number | bigint | Uint8Array | null;

declare global {
  // eslint-disable-next-line no-var
  var crowdRemixSqlite: DatabaseSync | undefined;
}

const blobPersistenceEnabled =
  process.env.NODE_ENV === "production" && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const databasePath = resolveDatabasePath(env.databaseUrl);
const databaseBlobPath = process.env.CROWD_REMIX_DATABASE_BLOB_PATH ?? "state/crowd-remix.sqlite";

let sqlite = global.crowdRemixSqlite ?? new DatabaseSync(databasePath);
let persistenceQueue = Promise.resolve();
let transactionDepth = 0;

prepareDatabase();

if (process.env.NODE_ENV !== "production") {
  global.crowdRemixSqlite = sqlite;
}

const booleanColumns = {
  DJSession: new Set(["venueSafeMode", "autoSelectEnabled"]),
  PlaybackState: new Set(["emergencyPaused"])
} as const;

function resolveDatabasePath(databaseUrl: string) {
  if (blobPersistenceEnabled) {
    return path.join(process.env.TMPDIR ?? "/tmp", "crowd-remix.sqlite");
  }

  if (!databaseUrl.startsWith("file:")) {
    throw new Error(`Unsupported DATABASE_URL: ${databaseUrl}`);
  }

  const rawPath = databaseUrl.slice("file:".length);
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

function prepareDatabase() {
  sqlite.exec("PRAGMA foreign_keys = ON");
  ensureSchema();
  ensureColumn("User", "avatarUrl", "TEXT");
  ensureColumn("User", "openAiApiKeyEncrypted", "TEXT");
  ensureColumn("User", "openAiApiKeyLast4", "TEXT");
  const addedEmailVerifiedColumn = ensureColumn("User", "emailVerifiedAt", "DATETIME");
  ensureColumn("DJSession", "systemPrompt", "TEXT");
  ensureColumn("DJSession", "automoderationPrompt", "TEXT");
  ensureColumn("DJSession", "audiencePromptGuide", "TEXT");
  ensureColumn("DJSession", "remixPromptTemplate", "TEXT");
  ensureColumn("DJSession", "negativePrompt", "TEXT");
  ensureEmailVerificationTokenTable();

  if (addedEmailVerifiedColumn) {
    backfillExistingUsersAsVerified();
  }

  ensureDemoData();
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

async function syncDatabaseFromBlob() {
  const remote = await getBlob(databaseBlobPath, {
    access: "private",
    useCache: false
  });

  if (!remote || remote.statusCode !== 200 || !remote.stream) {
    return;
  }

  const buffer = await streamToBuffer(remote.stream);
  sqlite.close();
  await mkdir(path.dirname(databasePath), {
    recursive: true
  });
  await writeFile(databasePath, buffer);
  sqlite = new DatabaseSync(databasePath);
  prepareDatabase();
}

async function syncDatabaseToBlob() {
  const buffer = await readFile(databasePath);

  await putBlob(databaseBlobPath, buffer, {
    access: "private",
    allowOverwrite: true,
    contentType: "application/vnd.sqlite3"
  });
}

async function withPersistentDatabase<T>(mode: "read" | "write", operation: () => Promise<T> | T) {
  if (!blobPersistenceEnabled || transactionDepth > 0) {
    return operation();
  }

  const run = async () => {
    await syncDatabaseFromBlob();
    const result = await operation();

    if (mode === "write") {
      await syncDatabaseToBlob();
    }

    return result;
  };

  const next = persistenceQueue.then(run, run);
  persistenceQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function ensureSchema() {
  const userTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("User");

  if (userTable) {
    return;
  }

  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260417162000_init",
    "migration.sql"
  );

  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Missing SQLite schema migration: ${migrationPath}`);
  }

  sqlite.exec(fs.readFileSync(migrationPath, "utf8"));
}

function ensureColumn(table: string, column: string, typeDefinition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
    name: string;
  }>;

  if (columns.some((entry) => entry.name === column)) {
    return false;
  }

  sqlite.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${typeDefinition}`);
  return true;
}

function ensureEmailVerificationTokenTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "EmailVerificationToken" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL,
      "expiresAt" DATETIME NOT NULL,
      "usedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  sqlite.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash")`
  );
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS "EmailVerificationToken_userId_createdAt_idx" ON "EmailVerificationToken"("userId", "createdAt")`
  );
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt")`
  );
}

function backfillExistingUsersAsVerified() {
  sqlite.exec(`
    UPDATE "User"
    SET "emailVerifiedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP)
    WHERE "emailVerifiedAt" IS NULL
  `);
}

function ensureDemoData() {
  const email = process.env.SEED_DJ_EMAIL ?? "dj@example.com";
  const password = process.env.SEED_DJ_PASSWORD ?? "crowdremix-demo";
  const userId = "demo-dj-user";
  const sessionId = "demo-neon-echo-session";
  const playbackId = "demo-neon-echo-playback";
  const existingUserById = getUser({
    id: userId
  });
  const existingUserByEmail = getUser({
    email
  });

  if (existingUserById) {
    if (existingUserById.email !== email) {
      updateRow("User", { id: userId }, { email }, { touchUpdatedAt: true });
    }
    if (!existingUserById.emailVerifiedAt) {
      updateRow("User", { id: userId }, { emailVerifiedAt: new Date() }, { touchUpdatedAt: true });
    }
    ensureDemoSession(userId, sessionId, playbackId);
    return;
  }

  if (existingUserByEmail) {
    sqlite.exec("PRAGMA foreign_keys = OFF");
    updateRow(
      "User",
      { email },
      { id: userId, passwordHash: hashPassword(password), displayName: "Demo DJ", emailVerifiedAt: new Date() },
      { touchUpdatedAt: true }
    );
    updateRow("DJSession", { userId: String(existingUserByEmail.id) }, { userId }, { touchUpdatedAt: true });
    sqlite.exec("PRAGMA foreign_keys = ON");
    ensureDemoSession(userId, sessionId, playbackId);
    return;
  }

  insertRow("User", {
    id: userId,
    email,
    passwordHash: hashPassword(password),
    displayName: "Demo DJ",
    emailVerifiedAt: new Date()
  });

  ensureDemoSession(userId, sessionId, playbackId);
}

function ensureDemoSession(userId: string, sessionId: string, playbackId: string) {
  const existingSession =
    getOne<Record<string, unknown>>("DJSession", {
      id: sessionId
    }) ??
    getOne<Record<string, unknown>>(
      "DJSession",
      {
        userId
      },
      {
        createdAt: "desc"
      }
    );

  if (existingSession) {
    if (existingSession.id === sessionId && existingSession.userId !== userId) {
      updateRow("DJSession", { id: sessionId }, { userId }, { touchUpdatedAt: true });
    }

    backfillSessionCustomizationDefaults(existingSession);

    ensureDemoPlayback(String(existingSession.id), existingSession.id === sessionId ? playbackId : randomUUID());
    return;
  }

  insertRow("DJSession", {
    id: sessionId,
    userId,
    code: "neon-echo-demo",
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
    systemPrompt: defaultSystemPrompt,
    automoderationPrompt: defaultAutomoderationPrompt,
    audiencePromptGuide: defaultAudiencePromptGuide,
    remixPromptTemplate: defaultRemixPromptTemplate,
    negativePrompt: defaultNegativePrompt,
    status: "draft",
    venueSafeMode: true,
    autoSelectEnabled: true
  });

  ensureDemoPlayback(sessionId, playbackId);
}

function backfillSessionCustomizationDefaults(session: Record<string, unknown>) {
  const missingDefaults = {
    ...(session.systemPrompt ? {} : { systemPrompt: defaultSystemPrompt }),
    ...(session.automoderationPrompt ? {} : { automoderationPrompt: defaultAutomoderationPrompt }),
    ...(session.audiencePromptGuide ? {} : { audiencePromptGuide: defaultAudiencePromptGuide }),
    ...(session.remixPromptTemplate ? {} : { remixPromptTemplate: defaultRemixPromptTemplate }),
    ...(session.negativePrompt ? {} : { negativePrompt: defaultNegativePrompt })
  };

  if (Object.keys(missingDefaults).length > 0) {
    updateRow("DJSession", { id: String(session.id) }, missingDefaults, { touchUpdatedAt: false });
  }
}

function ensureDemoPlayback(sessionId: string, playbackId: string) {
  const existingPlayback = getOne<Record<string, unknown>>("PlaybackState", {
    sessionId
  });

  if (existingPlayback) {
    return;
  }

  insertRow("PlaybackState", {
    id: playbackId,
    sessionId,
    status: "idle",
    emergencyPaused: false,
    crossfadeSeconds: 2,
    currentAssetId: null,
    nextAssetId: null,
    fallbackAssetId: null,
    lastTransitionAt: null
  });
}

function toSqlDate(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return value.toISOString().replace("T", " ").slice(0, 19);
}

function serializeValue(value: unknown): SqlInputValue {
  if (value instanceof Date) {
    return toSqlDate(value);
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  return null;
}

function mapRow<T extends Record<string, unknown> | null>(
  table: keyof typeof booleanColumns | null,
  row: T
) {
  if (!row || !table) {
    return row;
  }

  const booleanSet = booleanColumns[table];
  const output = { ...row } as Record<string, unknown>;

  for (const column of booleanSet) {
    if (column in output && output[column] !== null && output[column] !== undefined) {
      output[column] = Boolean(output[column]);
    }
  }

  return output as T;
}

function mapRows<T extends Record<string, unknown>>(table: keyof typeof booleanColumns | null, rows: T[]) {
  return rows.map((row) => mapRow(table, row));
}

function applySelect<T extends Record<string, unknown> | null>(
  row: T,
  select?: Record<string, boolean>
) {
  if (!row || !select) {
    return row;
  }

  const picked = Object.entries(select).filter(([, enabled]) => enabled);

  if (picked.length === 0) {
    return row;
  }

  return Object.fromEntries(picked.map(([key]) => [key, row[key]]));
}

function buildWhere(where?: WhereInput) {
  if (!where || Object.keys(where).length === 0) {
    return {
      sql: "",
      values: [] as SqlInputValue[]
    };
  }

  const clauses: string[] = [];
  const values: SqlInputValue[] = [];

  for (const [column, rawValue] of Object.entries(where)) {
    if (rawValue === undefined) {
      continue;
    }

    if (rawValue === null) {
      clauses.push(`"${column}" IS NULL`);
      continue;
    }

    if (typeof rawValue === "object" && !Array.isArray(rawValue)) {
      if ("in" in rawValue && rawValue.in) {
        const placeholders = rawValue.in.map(() => "?").join(", ");
        clauses.push(`"${column}" IN (${placeholders})`);
        values.push(...rawValue.in.map((entry) => serializeValue(entry)));
        continue;
      }

      if ("gte" in rawValue && rawValue.gte) {
        clauses.push(`"${column}" >= ?`);
        values.push(serializeValue(rawValue.gte));
        continue;
      }
    }

    clauses.push(`"${column}" = ?`);
    values.push(serializeValue(rawValue));
  }

  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    values
  };
}

function buildOrderBy(orderBy?: OrderByInput) {
  if (!orderBy) {
    return "";
  }

  const [column, direction] = Object.entries(orderBy)[0] ?? [];

  if (!column || !direction) {
    return "";
  }

  return ` ORDER BY "${column}" ${direction.toUpperCase()}`;
}

function buildLimit(take?: number) {
  if (!take) {
    return "";
  }

  return ` LIMIT ${take}`;
}

function getOne<T extends Record<string, unknown>>(table: string, where?: WhereInput, orderBy?: OrderByInput) {
  const whereClause = buildWhere(where);
  const sql = `SELECT * FROM "${table}"${whereClause.sql}${buildOrderBy(orderBy)} LIMIT 1`;
  const row = sqlite.prepare(sql).get(...whereClause.values) as T | undefined;
  return row ? ({ ...row } as T) : undefined;
}

function getMany<T extends Record<string, unknown>>(
  table: string,
  options?: {
    where?: WhereInput;
    orderBy?: OrderByInput;
    take?: number;
  }
) {
  const whereClause = buildWhere(options?.where);
  const sql = `SELECT * FROM "${table}"${whereClause.sql}${buildOrderBy(options?.orderBy)}${buildLimit(
    options?.take
  )}`;
  const rows = sqlite.prepare(sql).all(...whereClause.values) as T[];
  return rows.map((row) => ({ ...row })) as T[];
}

function insertRow(table: string, data: Record<string, unknown>, options?: { withUpdatedAt?: boolean }) {
  const payload = { ...data };

  if ("createdAt" in payload === false) {
    payload.createdAt = toSqlDate(new Date());
  }

  if (options?.withUpdatedAt !== false && "updatedAt" in payload === false) {
    payload.updatedAt = toSqlDate(new Date());
  }

  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
  const columns = entries.map(([column]) => `"${column}"`).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  const values = entries.map(([, value]) => serializeValue(value));

  sqlite.prepare(`INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`).run(...values);
}

function updateRow(
  table: string,
  where: WhereInput,
  data: Record<string, unknown>,
  options?: { touchUpdatedAt?: boolean }
) {
  const payload = { ...data };

  if (options?.touchUpdatedAt !== false) {
    payload.updatedAt = toSqlDate(new Date());
  }

  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    return;
  }

  const setClause = entries.map(([column]) => `"${column}" = ?`).join(", ");
  const whereClause = buildWhere(where);
  const values = entries.map(([, value]) => serializeValue(value));

  sqlite.prepare(`UPDATE "${table}" SET ${setClause}${whereClause.sql}`).run(
    ...values,
    ...whereClause.values
  );
}

function getUser(where: WhereInput) {
  const row = getOne<Record<string, unknown>>("User", where);
  return mapRow(null, row ?? null);
}

function getModerationResultBySubmission(submissionId: string) {
  return getOne<Record<string, unknown>>("ModerationResult", {
    submissionId
  });
}

function getRankingResultBySubmission(submissionId: string) {
  return getOne<Record<string, unknown>>("RankingResult", {
    submissionId
  });
}

function getVisualAssetById(assetId?: string | null) {
  if (!assetId) {
    return null;
  }

  return getOne<Record<string, unknown>>("VisualAsset", {
    id: assetId
  }) ?? null;
}

function hydratePlaybackState(playback: Record<string, unknown> | null, include?: IncludeInput) {
  if (!playback) {
    return null;
  }

  const hydrated = mapRow("PlaybackState", playback);
  const includeConfig = unwrapInclude(include);

  if (includeConfig?.currentAsset) {
    hydrated.currentAsset = getVisualAssetById(String(hydrated.currentAssetId ?? ""));
  }

  if (includeConfig?.nextAsset) {
    hydrated.nextAsset = getVisualAssetById(String(hydrated.nextAssetId ?? ""));
  }

  if (includeConfig?.fallbackAsset) {
    hydrated.fallbackAsset = getVisualAssetById(String(hydrated.fallbackAssetId ?? ""));
  }

  return hydrated;
}

function loadSubmissions(sessionId: string, config?: Record<string, unknown>) {
  const rows = getMany<Record<string, unknown>>("PromptSubmission", {
    where: {
      sessionId,
      ...((config?.where as WhereInput | undefined) ?? {})
    },
    orderBy: (config?.orderBy as OrderByInput | undefined) ?? {
      createdAt: "desc"
    },
    take: (config?.take as number | undefined) ?? undefined
  });

  return rows.map((row) => {
    const hydrated = { ...row };
    const include = config?.include as IncludeInput;

    if (include?.moderationResult) {
      hydrated.moderationResult = getModerationResultBySubmission(String(row.id));
    }

    if (include?.rankingResult) {
      hydrated.rankingResult = getRankingResultBySubmission(String(row.id));
    }

    return hydrated;
  });
}

function loadRenderJobs(sessionId: string, config?: Record<string, unknown>) {
  const rows = getMany<Record<string, unknown>>("RenderJob", {
    where: {
      sessionId,
      ...((config?.where as WhereInput | undefined) ?? {})
    },
    orderBy: (config?.orderBy as OrderByInput | undefined) ?? {
      createdAt: "desc"
    },
    take: (config?.take as number | undefined) ?? undefined
  });

  return rows.map((row) => hydrateRenderJob(row, config?.include as IncludeInput));
}

function loadVisualAssets(sessionId: string, config?: Record<string, unknown>) {
  return getMany<Record<string, unknown>>("VisualAsset", {
    where: {
      sessionId,
      ...((config?.where as WhereInput | undefined) ?? {})
    },
    orderBy: (config?.orderBy as OrderByInput | undefined) ?? {
      createdAt: "desc"
    },
    take: (config?.take as number | undefined) ?? undefined
  });
}

function unwrapInclude(value: unknown): IncludeInput {
  if (value && typeof value === "object" && "include" in value) {
    return ((value as { include?: IncludeInput }).include ?? undefined) as IncludeInput;
  }

  return undefined;
}

function hydrateSession(session: Record<string, unknown> | null, include?: IncludeInput) {
  if (!session) {
    return null;
  }

  const hydrated = mapRow("DJSession", session);

  if (!include) {
    return hydrated;
  }

  if (include.playbackState) {
    const playback = getOne<Record<string, unknown>>("PlaybackState", {
      sessionId: String(hydrated.id)
    });
    hydrated.playbackState = hydratePlaybackState(playback ?? null, include.playbackState as IncludeInput);
  }

  if (include.submissions) {
    hydrated.submissions = loadSubmissions(String(hydrated.id), include.submissions as Record<string, unknown>);
  }

  if (include.renderJobs) {
    hydrated.renderJobs = loadRenderJobs(String(hydrated.id), include.renderJobs as Record<string, unknown>);
  }

  if (include.visualAssets) {
    hydrated.visualAssets = loadVisualAssets(String(hydrated.id), include.visualAssets as Record<string, unknown>);
  }

  return hydrated;
}

function getPromptSubmission(where: WhereInput, include?: IncludeInput) {
  const row = getOne<Record<string, unknown>>("PromptSubmission", where);

  if (!row) {
    return null;
  }

  const hydrated = { ...row };

  if (include?.moderationResult) {
    hydrated.moderationResult = getModerationResultBySubmission(String(row.id));
  }

  if (include?.rankingResult) {
    hydrated.rankingResult = getRankingResultBySubmission(String(row.id));
  }

  return hydrated;
}

function hydrateRenderJob(renderJob: Record<string, unknown> | null, include?: IncludeInput) {
  if (!renderJob) {
    return null;
  }

  const hydrated = { ...renderJob };

  if (include?.outputAsset) {
    hydrated.outputAsset = getVisualAssetById(String(renderJob.outputAssetId ?? ""));
  }

  if (include?.submission) {
    hydrated.submission = getPromptSubmission(
      {
        id: String(renderJob.submissionId ?? "")
      },
      undefined
    );
  }

  if (include?.session) {
    const sessionInclude = unwrapInclude(include.session);

    hydrated.session = hydrateSession(
      getOne<Record<string, unknown>>("DJSession", {
        id: String(renderJob.sessionId)
      }) ?? null,
      sessionInclude
    );
  }

  return hydrated;
}

function createDbApi(): any {
  return {
    user: {
      async findUnique(args: { where: WhereInput; select?: Record<string, boolean> }) {
        return applySelect(getUser(args.where), args.select);
      },
      async create(args: { data: Record<string, unknown>; select?: Record<string, boolean> }) {
        const id = randomUUID();

        insertRow("User", {
          id,
          email: args.data.email,
          passwordHash: args.data.passwordHash,
          displayName: args.data.displayName,
          emailVerifiedAt: args.data.emailVerifiedAt ?? null,
          avatarUrl: args.data.avatarUrl ?? null,
          openAiApiKeyEncrypted: args.data.openAiApiKeyEncrypted ?? null,
          openAiApiKeyLast4: args.data.openAiApiKeyLast4 ?? null
        });

        return applySelect(getUser({ id }), args.select);
      },
      async update(args: { where: WhereInput; data: Record<string, unknown>; select?: Record<string, boolean> }) {
        updateRow("User", args.where, args.data, {
          touchUpdatedAt: true
        });

        return applySelect(getUser(args.where), args.select);
      }
    },
    emailVerificationToken: {
      async create(args: { data: Record<string, unknown> }) {
        const id = randomUUID();

        insertRow("EmailVerificationToken", {
          id,
          userId: args.data.userId,
          tokenHash: args.data.tokenHash,
          expiresAt: args.data.expiresAt,
          usedAt: args.data.usedAt ?? null
        });

        return getOne<Record<string, unknown>>("EmailVerificationToken", {
          id
        });
      },
      async findUnique(args: { where: WhereInput }) {
        return getOne<Record<string, unknown>>("EmailVerificationToken", args.where) ?? null;
      },
      async findFirst(args: { where: WhereInput; orderBy?: OrderByInput }) {
        return getOne<Record<string, unknown>>("EmailVerificationToken", args.where, args.orderBy) ?? null;
      },
      async update(args: { where: WhereInput; data: Record<string, unknown> }) {
        updateRow("EmailVerificationToken", args.where, args.data, {
          touchUpdatedAt: true
        });

        return getOne<Record<string, unknown>>("EmailVerificationToken", args.where) ?? null;
      },
      async updateMany(args: { where: WhereInput; data: Record<string, unknown> }) {
        updateRow("EmailVerificationToken", args.where, args.data, {
          touchUpdatedAt: true
        });
      }
    },
    dJSession: {
      async create(args: { data: Record<string, unknown>; include?: IncludeInput }) {
        const id = randomUUID();
        const playbackInput = args.data.playbackState as { create?: Record<string, unknown> } | undefined;

        insertRow("DJSession", {
          id,
          userId: args.data.userId,
          code: args.data.code,
          name: args.data.name,
          artistName: args.data.artistName,
          trackName: args.data.trackName,
          creativeBible: args.data.creativeBible,
          allowedMotifs: args.data.allowedMotifs,
          bannedTerms: args.data.bannedTerms,
          colorPalette: args.data.colorPalette,
          motionRules: args.data.motionRules,
          basePrompt: args.data.basePrompt,
          systemPrompt: args.data.systemPrompt ?? null,
          automoderationPrompt: args.data.automoderationPrompt ?? null,
          audiencePromptGuide: args.data.audiencePromptGuide ?? null,
          remixPromptTemplate: args.data.remixPromptTemplate ?? null,
          negativePrompt: args.data.negativePrompt ?? null,
          imageReferenceUrl: args.data.imageReferenceUrl ?? null,
          smsNumber: args.data.smsNumber ?? null,
          status: args.data.status ?? "draft",
          venueSafeMode: args.data.venueSafeMode ?? true,
          autoSelectEnabled: args.data.autoSelectEnabled ?? true,
          startedAt: args.data.startedAt ?? null,
          stoppedAt: args.data.stoppedAt ?? null
        });

        if (playbackInput?.create) {
          insertRow("PlaybackState", {
            id: randomUUID(),
            sessionId: id,
            status: playbackInput.create.status ?? "idle",
            emergencyPaused: playbackInput.create.emergencyPaused ?? false,
            crossfadeSeconds: playbackInput.create.crossfadeSeconds ?? 2,
            currentAssetId: playbackInput.create.currentAssetId ?? null,
            nextAssetId: playbackInput.create.nextAssetId ?? null,
            fallbackAssetId: playbackInput.create.fallbackAssetId ?? null,
            lastTransitionAt: playbackInput.create.lastTransitionAt ?? null
          });
        }

        return hydrateSession(
          getOne<Record<string, unknown>>("DJSession", {
            id
          }) ?? null,
          args.include
        );
      },
      async findFirst(args: { where: WhereInput; orderBy?: OrderByInput; include?: IncludeInput }) {
        return hydrateSession(
          getOne<Record<string, unknown>>("DJSession", args.where, args.orderBy) ?? null,
          args.include
        );
      },
      async findUnique(args: { where: WhereInput; include?: IncludeInput }) {
        return hydrateSession(
          getOne<Record<string, unknown>>("DJSession", args.where) ?? null,
          args.include
        );
      },
      async update(args: { where: WhereInput; data: Record<string, unknown>; include?: IncludeInput }) {
        const playbackInput = args.data.playbackState as { update?: Record<string, unknown> } | undefined;

        updateRow(
          "DJSession",
          args.where,
          {
            status: args.data.status,
            startedAt: args.data.startedAt,
            stoppedAt: args.data.stoppedAt,
            autoSelectEnabled: args.data.autoSelectEnabled
          },
          {
            touchUpdatedAt: true
          }
        );

        if (playbackInput?.update) {
          const session = getOne<Record<string, unknown>>("DJSession", args.where);

          if (session) {
            updateRow(
              "PlaybackState",
              {
                sessionId: String(session.id)
              },
              playbackInput.update,
              {
                touchUpdatedAt: true
              }
            );
          }
        }

        return hydrateSession(
          getOne<Record<string, unknown>>("DJSession", args.where) ?? null,
          args.include
        );
      }
    },
    promptSubmission: {
      async findUnique(args: { where: WhereInput; include?: IncludeInput }) {
        return getPromptSubmission(args.where, args.include);
      },
      async create(args: { data: Record<string, unknown> }) {
        const id = randomUUID();

        insertRow("PromptSubmission", {
          id,
          sessionId: args.data.sessionId,
          source: args.data.source,
          sender: args.data.sender ?? null,
          senderFingerprint: args.data.senderFingerprint,
          messageSid: args.data.messageSid ?? null,
          rawText: args.data.rawText,
          normalizedText: args.data.normalizedText,
          status: args.data.status ?? "submitted",
          approvalReason: args.data.approvalReason ?? null,
          selectedAt: args.data.selectedAt ?? null
        });

        return getPromptSubmission(
          {
            id
          },
          undefined
        );
      },
      async update(args: { where: WhereInput; data: Record<string, unknown> }) {
        updateRow("PromptSubmission", args.where, args.data, {
          touchUpdatedAt: true
        });

        return getPromptSubmission(args.where, undefined);
      },
      async count(args: { where: WhereInput }) {
        const whereClause = buildWhere(args.where);
        const row = sqlite
          .prepare(`SELECT COUNT(*) as count FROM "PromptSubmission"${whereClause.sql}`)
          .get(...whereClause.values) as { count: number };

        return row.count;
      }
    },
    moderationResult: {
      async create(args: { data: Record<string, unknown> }) {
        insertRow("ModerationResult", {
          id: randomUUID(),
          ...args.data
        });
      }
    },
    rankingResult: {
      async create(args: { data: Record<string, unknown> }) {
        insertRow("RankingResult", {
          id: randomUUID(),
          ...args.data
        });
      }
    },
    visualAsset: {
      async create(args: { data: Record<string, unknown> }) {
        const id = randomUUID();

        insertRow("VisualAsset", {
          id,
          sessionId: args.data.sessionId,
          sourceSubmissionId: args.data.sourceSubmissionId ?? null,
          kind: args.data.kind,
          title: args.data.title,
          promptText: args.data.promptText,
          storagePath: args.data.storagePath ?? null,
          publicUrl: args.data.publicUrl ?? null,
          thumbnailUrl: args.data.thumbnailUrl ?? null,
          sourceVideoId: args.data.sourceVideoId ?? null,
          durationSeconds: args.data.durationSeconds ?? 8,
          width: args.data.width ?? 1280,
          height: args.data.height ?? 720,
          status: args.data.status ?? "processing"
        });

        return getOne<Record<string, unknown>>("VisualAsset", {
          id
        });
      },
      async update(args: { where: WhereInput; data: Record<string, unknown> }) {
        updateRow("VisualAsset", args.where, args.data, {
          touchUpdatedAt: true
        });

        return getOne<Record<string, unknown>>("VisualAsset", args.where) ?? null;
      },
      async findUnique(args: { where: WhereInput }) {
        return getOne<Record<string, unknown>>("VisualAsset", args.where) ?? null;
      }
    },
    renderJob: {
      async create(args: { data: Record<string, unknown> }) {
        const id = randomUUID();

        insertRow("RenderJob", {
          id,
          sessionId: args.data.sessionId,
          submissionId: args.data.submissionId ?? null,
          sourceAssetId: args.data.sourceAssetId ?? null,
          outputAssetId: args.data.outputAssetId ?? null,
          mode: args.data.mode,
          status: args.data.status ?? "queued",
          openaiVideoId: args.data.openaiVideoId ?? null,
          promptText: args.data.promptText,
          failureReason: args.data.failureReason ?? null,
          lastPolledAt: args.data.lastPolledAt ?? null,
          completedAt: args.data.completedAt ?? null
        });

        return hydrateRenderJob(
          getOne<Record<string, unknown>>("RenderJob", {
            id
          }) ?? null,
          undefined
        );
      },
      async update(args: { where: WhereInput; data: Record<string, unknown> }) {
        updateRow("RenderJob", args.where, args.data, {
          touchUpdatedAt: true
        });

        return hydrateRenderJob(
          getOne<Record<string, unknown>>("RenderJob", args.where) ?? null,
          undefined
        );
      },
      async findUnique(args: { where: WhereInput; include?: IncludeInput }) {
        return hydrateRenderJob(
          getOne<Record<string, unknown>>("RenderJob", args.where) ?? null,
          args.include
        );
      },
      async findMany(args: { where: WhereInput; orderBy?: OrderByInput; include?: IncludeInput; take?: number }) {
        return getMany<Record<string, unknown>>("RenderJob", {
          where: args.where,
          orderBy: args.orderBy,
          take: args.take
        }).map((row) => hydrateRenderJob(row, args.include));
      }
    },
    playbackState: {
      async findUnique(args: { where: WhereInput }) {
        return hydratePlaybackState(
          getOne<Record<string, unknown>>("PlaybackState", args.where) ?? null
        );
      },
      async update(args: { where: WhereInput; data: Record<string, unknown> }) {
        updateRow("PlaybackState", args.where, args.data, {
          touchUpdatedAt: true
        });

        return hydratePlaybackState(
          getOne<Record<string, unknown>>("PlaybackState", args.where) ?? null
        );
      }
    },
    auditEvent: {
      async create(args: { data: Record<string, unknown> }) {
        insertRow(
          "AuditEvent",
          {
            id: randomUUID(),
            sessionId: args.data.sessionId ?? null,
            userId: args.data.userId ?? null,
            type: args.data.type,
            summary: args.data.summary,
            details: args.data.details ?? null
          },
          {
            withUpdatedAt: false
          }
        );
      }
    },
    async $transaction<T>(callback: (tx: ReturnType<typeof createDbApi>) => Promise<T>) {
      sqlite.exec("BEGIN");
      transactionDepth += 1;

      try {
        const tx = createDbApi();
        const result = await callback(tx);
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    }
  };
}

const writeOperations = new Set([
  "$transaction",
  "user.create",
  "user.update",
  "emailVerificationToken.create",
  "emailVerificationToken.update",
  "emailVerificationToken.updateMany",
  "dJSession.create",
  "dJSession.update",
  "promptSubmission.create",
  "promptSubmission.update",
  "moderationResult.create",
  "rankingResult.create",
  "visualAsset.create",
  "visualAsset.update",
  "renderJob.create",
  "renderJob.update",
  "playbackState.update",
  "auditEvent.create"
]);

function wrapDbApiForPersistence(api: any) {
  if (!blobPersistenceEnabled) {
    return api;
  }

  const wrapped: Record<string, unknown> = {};

  for (const [namespace, value] of Object.entries(api)) {
    if (typeof value === "function") {
      const mode = writeOperations.has(namespace) ? "write" : "read";
      wrapped[namespace] = (...args: unknown[]) =>
        withPersistentDatabase(mode, () => (value as (...input: unknown[]) => unknown)(...args));
      continue;
    }

    if (!value || typeof value !== "object") {
      wrapped[namespace] = value;
      continue;
    }

    const model: Record<string, unknown> = {};

    for (const [method, modelValue] of Object.entries(value)) {
      if (typeof modelValue !== "function") {
        model[method] = modelValue;
        continue;
      }

      const operationName = `${namespace}.${method}`;
      const mode = writeOperations.has(operationName) ? "write" : "read";
      model[method] = (...args: unknown[]) =>
        withPersistentDatabase(mode, () => (modelValue as (...input: unknown[]) => unknown)(...args));
    }

    wrapped[namespace] = model;
  }

  return wrapped;
}

export const db: any = wrapDbApiForPersistence(createDbApi());
