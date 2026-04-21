import { randomUUID } from "crypto";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { env } from "@/lib/env";

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

const sqlite =
  global.crowdRemixSqlite ??
  new DatabaseSync(resolveDatabasePath(env.databaseUrl));

sqlite.exec("PRAGMA foreign_keys = ON");
ensureColumn("User", "openAiApiKeyEncrypted", 'TEXT');
ensureColumn("User", "openAiApiKeyLast4", 'TEXT');

if (process.env.NODE_ENV !== "production") {
  global.crowdRemixSqlite = sqlite;
}

const booleanColumns = {
  DJSession: new Set(["venueSafeMode", "autoSelectEnabled"]),
  PlaybackState: new Set(["emergencyPaused"])
} as const;

function resolveDatabasePath(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(`Unsupported DATABASE_URL: ${databaseUrl}`);
  }

  const rawPath = databaseUrl.slice("file:".length);
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

function ensureColumn(table: string, column: string, typeDefinition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
    name: string;
  }>;

  if (columns.some((entry) => entry.name === column)) {
    return;
  }

  sqlite.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${typeDefinition}`);
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
      async update(args: { where: WhereInput; data: Record<string, unknown>; select?: Record<string, boolean> }) {
        updateRow("User", args.where, args.data, {
          touchUpdatedAt: true
        });

        return applySelect(getUser(args.where), args.select);
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

      try {
        const tx = createDbApi();
        const result = await callback(tx);
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
}

export const db: any = createDbApi();
