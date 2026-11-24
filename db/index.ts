import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type {
  ArchiveDocument,
  AttachmentDocument,
  NotificationDocument,
  PublicChatPresenceDocument,
  ProfileMediaDocument,
  PublicChatMessageDocument,
  RequestDocument,
  SessionDocument,
  SpaceInvadersScoreDocument,
  UserDocument,
} from "./schema.js";

type CollectionName =
  | "users"
  | "requests"
  | "notifications"
  | "archives"
  | "attachments"
  | "profileMedia"
  | "publicChatMessages"
  | "publicChatPresence"
  | "spaceInvadersScores"
  | "sessions";

type CollectionFilter<T> = Partial<Record<keyof T, unknown>> & Record<string, unknown>;
type CollectionUpdate<T> = {
  $set?: Partial<T>;
  $setOnInsert?: Partial<T>;
  $max?: Partial<Record<keyof T, number>>;
};
type CollectionOptions = { projection?: Record<string, 0 | 1> };
type QueryRow = Record<string, unknown>;
type NeonClient = NeonQueryFunction<false, false>;

export interface Collection<T extends object> {
  find(filter?: CollectionFilter<T>, options?: CollectionOptions): CollectionCursor<T>;
  findOne(filter: CollectionFilter<T>, options?: CollectionOptions): Promise<T | null>;
  insertOne(document: T): Promise<void>;
  insertMany(documents: T[]): Promise<void>;
  updateOne(
    filter: CollectionFilter<T>,
    update: CollectionUpdate<T>,
    options?: { upsert?: boolean },
  ): Promise<{ matchedCount: number }>;
  deleteOne(filter: CollectionFilter<T>): Promise<{ deletedCount: number }>;
  deleteMany(filter: CollectionFilter<T>): Promise<{ deletedCount: number }>;
  countDocuments(filter?: CollectionFilter<T>): Promise<number>;
}

export interface CollectionCursor<T extends object> {
  sort(fields: Record<string, 1 | -1>): CollectionCursor<T>;
  limit(count: number): CollectionCursor<T>;
  toArray(): Promise<T[]>;
}

export interface Database {
  collection<T extends object>(name: CollectionName): Collection<T>;
}

interface CollectionDefinition {
  table: string;
  columns: readonly string[];
  jsonColumns: readonly string[];
  dateColumns: readonly string[];
  upsertColumn?: string;
}

const definitions: Record<CollectionName, CollectionDefinition> = {
  users: {
    table: "users",
    columns: [
      "id", "name", "firstName", "middleName", "lastName", "email", "emailNormalized", "role",
      "dept", "headOfDept", "title", "employmentType", "requestedRole", "requestedDept",
      "requestedEmploymentType", "salary", "salaryHistory", "leaveCredits", "avatar",
      "signature", "passwordHash", "status", "createdAt",
    ],
    jsonColumns: ["salaryHistory", "leaveCredits"],
    dateColumns: ["createdAt"],
    upsertColumn: "emailNormalized",
  },
  requests: {
    table: "requests",
    columns: [
      "id", "type", "subType", "section", "applicantId", "applicantName", "dateFiled", "logDate",
      "timeIn", "timeOut", "startDate", "endDate", "totalDays", "leaveDetails", "extraOffDate",
      "reason", "attachmentName", "attachmentId", "status", "deptHeadApproval", "hrApproval",
      "finalApproval", "approvedBy", "approvalDate", "taggedUsers", "logs", "createdAt",
    ],
    jsonColumns: ["leaveDetails", "taggedUsers", "logs"],
    dateColumns: ["createdAt"],
  },
  notifications: {
    table: "notifications",
    columns: ["id", "userId", "requestId", "title", "message", "date", "read", "createdAt"],
    jsonColumns: [],
    dateColumns: ["createdAt"],
  },
  archives: {
    table: "archives",
    columns: [
      "id", "originalReqId", "applicantId", "recipientId", "applicantName", "type", "section",
      "status", "archivedDate", "reason", "createdAt",
    ],
    jsonColumns: [],
    dateColumns: ["createdAt"],
  },
  attachments: {
    table: "attachments",
    columns: ["id", "requestId", "uploadedBy", "fileName", "contentType", "size", "blobKey", "createdAt"],
    jsonColumns: [],
    dateColumns: ["createdAt"],
  },
  profileMedia: {
    table: "profile_media",
    columns: ["id", "userId", "mediaType", "fileName", "contentType", "size", "blobKey", "createdAt"],
    jsonColumns: [],
    dateColumns: ["createdAt"],
  },
  publicChatMessages: {
    table: "public_chat_messages",
    columns: ["id", "senderId", "senderName", "senderRole", "senderAvatar", "message", "createdAt"],
    jsonColumns: [],
    dateColumns: ["createdAt"],
  },
  publicChatPresence: {
    table: "public_chat_presence",
    columns: ["userId", "lastSeenAt"],
    jsonColumns: [],
    dateColumns: ["lastSeenAt"],
    upsertColumn: "userId",
  },
  spaceInvadersScores: {
    table: "space_invaders_scores",
    columns: ["userId", "highScore", "updatedAt"],
    jsonColumns: [],
    dateColumns: ["updatedAt"],
    upsertColumn: "userId",
  },
  sessions: {
    table: "sessions",
    columns: ["tokenHash", "userId", "createdAt", "expiresAt"],
    jsonColumns: [],
    dateColumns: ["createdAt", "expiresAt"],
  },
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    first_name TEXT,
    middle_name TEXT,
    last_name TEXT,
    email TEXT NOT NULL UNIQUE,
    email_normalized TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'Employee',
    dept TEXT,
    head_of_dept TEXT,
    title TEXT,
    employment_type TEXT NOT NULL DEFAULT 'Contract of Service',
    requested_role TEXT,
    requested_dept TEXT,
    requested_employment_type TEXT,
    salary TEXT,
    salary_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    leave_credits JSONB,
    avatar TEXT,
    signature TEXT,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS requested_role TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS requested_dept TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS requested_employment_type TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS leave_credits JSONB",
  `CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    sub_type TEXT,
    section TEXT,
    applicant_id TEXT NOT NULL,
    applicant_name TEXT,
    date_filed TEXT,
    log_date TEXT,
    time_in TEXT,
    time_out TEXT,
    start_date TEXT,
    end_date TEXT,
    total_days INTEGER,
    leave_details JSONB,
    extra_off_date TEXT,
    reason TEXT,
    attachment_name TEXT,
    attachment_id TEXT,
    status TEXT NOT NULL,
    dept_head_approval TEXT,
    hr_approval TEXT,
    final_approval TEXT,
    approved_by TEXT,
    approval_date TEXT,
    tagged_users JSONB NOT NULL DEFAULT '[]'::jsonb,
    logs JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    request_id TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    date TEXT,
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS archives (
    id TEXT PRIMARY KEY,
    original_req_id TEXT NOT NULL,
    applicant_id TEXT NOT NULL,
    recipient_id TEXT,
    applicant_name TEXT,
    type TEXT,
    section TEXT,
    status TEXT,
    archived_date TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    request_id TEXT,
    uploaded_by TEXT,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    blob_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS profile_media (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    media_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    blob_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS space_invaders_scores (
    user_id TEXT PRIMARY KEY,
    high_score INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS public_chat_messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_role TEXT NOT NULL,
    sender_avatar TEXT,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS public_chat_presence (
    user_id TEXT PRIMARY KEY,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  "ALTER TABLE public_chat_messages ADD COLUMN IF NOT EXISTS sender_avatar TEXT",
  "CREATE INDEX IF NOT EXISTS requests_applicant_idx ON requests (applicant_id)",
  "CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id)",
  "CREATE INDEX IF NOT EXISTS attachments_request_idx ON attachments (request_id)",
  "CREATE INDEX IF NOT EXISTS profile_media_user_idx ON profile_media (user_id)",
  "CREATE INDEX IF NOT EXISTS profile_media_user_type_idx ON profile_media (user_id, media_type)",
  "CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at)",
  "CREATE INDEX IF NOT EXISTS public_chat_messages_created_idx ON public_chat_messages (created_at DESC, id DESC)",
  "CREATE INDEX IF NOT EXISTS public_chat_presence_last_seen_idx ON public_chat_presence (last_seen_at DESC)",
];

const toSnakeCase = (value: string) => value.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const columnName = (definition: CollectionDefinition, property: string) => {
  if (!definition.columns.includes(property)) {
    throw new Error(`Unknown ${definition.table} column: ${property}`);
  }
  return quoteIdentifier(toSnakeCase(property));
};

const isOperatorObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !(value instanceof Date) &&
  !Array.isArray(value) &&
  Object.keys(value).some(key => key.startsWith("$"));

const isJsonColumn = (definition: CollectionDefinition, property: string) =>
  definition.jsonColumns.includes(property);

const addValue = (values: unknown[], value: unknown, json: boolean) => {
  values.push(json ? JSON.stringify(value) : value);
  return `$${values.length}${json ? "::jsonb" : ""}`;
};

const buildWhere = (
  definition: CollectionDefinition,
  filter: Record<string, unknown>,
  values: unknown[],
) => {
  const conditions: string[] = [];
  for (const [property, value] of Object.entries(filter)) {
    if (value === undefined) continue;

    if (property === "logs.signature" && definition.table === "requests") {
      conditions.push(`${columnName(definition, "logs")} @> ${addValue(values, [{ signature: value }], true)}`);
      continue;
    }

    const column = columnName(definition, property);
    if (!isOperatorObject(value)) {
      conditions.push(value === null ? `${column} IS NULL` : `${column} = ${addValue(values, value, isJsonColumn(definition, property))}`);
      continue;
    }

    for (const [operator, operand] of Object.entries(value)) {
      if (operator === "$gt") {
        conditions.push(`${column} > ${addValue(values, operand, false)}`);
      } else if (operator === "$ne") {
        conditions.push(operand === null ? `${column} IS NOT NULL` : `${column} <> ${addValue(values, operand, false)}`);
      } else if (operator === "$in") {
        if (!Array.isArray(operand)) throw new Error(`The $in filter for ${property} must be an array.`);
        if (operand.length === 0) {
          conditions.push("FALSE");
        } else {
          const parameters = operand.map(item => addValue(values, item, false));
          conditions.push(`${column} IN (${parameters.join(", ")})`);
        }
      } else {
        throw new Error(`Unsupported database filter operator: ${operator}`);
      }
    }
  }
  return conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
};

const toDocument = <T>(row: QueryRow, definition: CollectionDefinition): T => {
  const document: QueryRow = {};
  for (const [column, rawValue] of Object.entries(row)) {
    const property = column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    let value = rawValue;
    if (value !== null && definition.dateColumns.includes(property) && !(value instanceof Date)) {
      value = new Date(String(value));
    } else if (value !== null && isJsonColumn(definition, property) && typeof value === "string") {
      value = JSON.parse(value);
    }
    document[property] = value;
  }
  return document as T;
};

class PostgresCollection<T extends object> implements Collection<T> {
  constructor(
    private readonly client: NeonClient,
    private readonly definition: CollectionDefinition,
  ) {}

  find(filter: CollectionFilter<T> = {}, _options?: CollectionOptions) {
    return new PostgresCursor<T>(this, filter);
  }

  async findOne(filter: CollectionFilter<T>, _options?: CollectionOptions): Promise<T | null> {
    const rows = await this.select(filter, undefined, 1);
    return rows[0] ?? null;
  }

  async insertOne(document: T) {
    const entries = Object.entries(document).filter(([, value]) => value !== undefined);
    const columns = entries.map(([property]) => columnName(this.definition, property));
    const values: unknown[] = [];
    const placeholders = entries.map(([property, value]) =>
      addValue(values, value, isJsonColumn(this.definition, property)),
    );
    const query = `INSERT INTO ${quoteIdentifier(this.definition.table)} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`;
    await this.client.query(query, values);
  }

  async insertMany(documents: T[]) {
    if (documents.length === 0) return;
    const entries = Object.entries(documents[0]).filter(([, value]) => value !== undefined);
    const columns = entries.map(([property]) => columnName(this.definition, property));
    const values: unknown[] = [];
    const rows = documents.map(document => {
      const placeholders = entries.map(([property]) => {
        const value = (document as Record<string, unknown>)[property];
        return addValue(values, value, isJsonColumn(this.definition, property));
      });
      return `(${placeholders.join(", ")})`;
    });
    await this.client.query(
      `INSERT INTO ${quoteIdentifier(this.definition.table)} (${columns.join(", ")}) VALUES ${rows.join(", ")}`,
      values,
    );
  }

  async updateOne(
    filter: CollectionFilter<T>,
    update: CollectionUpdate<T>,
    options: { upsert?: boolean } = {},
  ) {
    const set = update.$set ?? {};
    const max = update.$max ?? {};

    if (options.upsert) {
      const insertValues: Record<string, unknown> = {};
      for (const [property, value] of Object.entries(filter)) {
        if (!isOperatorObject(value)) insertValues[property] = value;
      }
      Object.assign(insertValues, update.$setOnInsert, set);
      for (const [property, value] of Object.entries(max)) {
        if (!(property in insertValues)) insertValues[property] = value;
      }

      const entries = Object.entries(insertValues).filter(([, value]) => value !== undefined);
      const columns = entries.map(([property]) => columnName(this.definition, property));
      const values: unknown[] = [];
      const placeholders = entries.map(([property, value]) =>
        addValue(values, value, isJsonColumn(this.definition, property)),
      );
      const conflictColumn = this.definition.upsertColumn;
      if (!conflictColumn) throw new Error(`Upsert is not configured for ${this.definition.table}.`);

      const conflictUpdates = [
        ...Object.keys(set).map(property => {
          const column = columnName(this.definition, property);
          return `${column} = EXCLUDED.${column}`;
        }),
        ...Object.keys(max).map(property => {
          const column = columnName(this.definition, property);
          return `${column} = GREATEST(${quoteIdentifier(this.definition.table)}.${column}, EXCLUDED.${column})`;
        }),
      ];
      const onConflict = conflictUpdates.length
        ? `DO UPDATE SET ${conflictUpdates.join(", ")}`
        : "DO NOTHING";
      const result = await this.client.query(
        `INSERT INTO ${quoteIdentifier(this.definition.table)} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) ON CONFLICT (${columnName(this.definition, conflictColumn)}) ${onConflict} RETURNING 1`,
        values,
      );
      return { matchedCount: result.length };
    }

    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [property, value] of Object.entries(set)) {
      const column = columnName(this.definition, property);
      assignments.push(`${column} = ${addValue(values, value, isJsonColumn(this.definition, property))}`);
    }
    for (const [property, value] of Object.entries(max)) {
      const column = columnName(this.definition, property);
      assignments.push(`${column} = GREATEST(${column}, ${addValue(values, value, false)})`);
    }
    if (assignments.length === 0) return { matchedCount: 0 };

    const where = buildWhere(this.definition, filter, values);
    const result = await this.client.query(
      `UPDATE ${quoteIdentifier(this.definition.table)} SET ${assignments.join(", ")}${where} RETURNING 1`,
      values,
    );
    return { matchedCount: result.length };
  }

  async deleteOne(filter: CollectionFilter<T>) {
    return this.deleteMany(filter);
  }

  async deleteMany(filter: CollectionFilter<T>) {
    const values: unknown[] = [];
    const where = buildWhere(this.definition, filter, values);
    const result = await this.client.query(
      `DELETE FROM ${quoteIdentifier(this.definition.table)}${where} RETURNING 1`,
      values,
    );
    return { deletedCount: result.length };
  }

  async countDocuments(filter: CollectionFilter<T> = {}) {
    const values: unknown[] = [];
    const where = buildWhere(this.definition, filter, values);
    const [row] = await this.client.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(this.definition.table)}${where}`, values);
    return Number((row as QueryRow).count);
  }

  async select(filter: CollectionFilter<T>, sort?: Record<string, 1 | -1>, limit?: number): Promise<T[]> {
    const values: unknown[] = [];
    const where = buildWhere(this.definition, filter, values);
    const orderBy = sort
      ? ` ORDER BY ${Object.entries(sort).map(([property, direction]) =>
        `${columnName(this.definition, property)} ${direction === 1 ? "ASC" : "DESC"}`,
      ).join(", ")}`
      : "";
    const limitClause = limit ? ` LIMIT ${Math.max(1, Math.floor(limit))}` : "";
    const result = await this.client.query(
      `SELECT * FROM ${quoteIdentifier(this.definition.table)}${where}${orderBy}${limitClause}`,
      values,
    );
    return result.map(row => toDocument<T>(row as QueryRow, this.definition));
  }
}

class PostgresCursor<T extends object> implements CollectionCursor<T> {
  private sortFields?: Record<string, 1 | -1>;
  private limitCount?: number;

  constructor(
    private readonly collection: PostgresCollection<T>,
    private readonly filter: CollectionFilter<T>,
  ) {}

  sort(fields: Record<string, 1 | -1>) {
    this.sortFields = fields;
    return this;
  }

  limit(count: number) {
    this.limitCount = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
    return this;
  }

  toArray() {
    return this.collection.select(this.filter, this.sortFields, this.limitCount);
  }
}

class PostgresDatabase implements Database {
  constructor(private readonly client: NeonClient) {}

  collection<T extends object>(name: CollectionName): Collection<T> {
    return new PostgresCollection<T>(this.client, definitions[name]);
  }
}

let database: Promise<PostgresDatabase> | undefined;

export const getDatabase = (): Promise<Database> => {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Connect a PostgreSQL Marketplace database and set POSTGRES_URL or DATABASE_URL.");
  }
  if (!database) {
    const client = neon(connectionString);
    database = (async () => {
      for (const statement of schemaStatements) await client.query(statement);
      return new PostgresDatabase(client);
    })().catch(error => {
      database = undefined;
      throw error;
    });
  }
  return database;
};
