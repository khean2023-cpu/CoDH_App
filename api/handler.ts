import type { Collection } from "../db/index.js";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { deleteStoredBlob, getStoredBlob, setStoredBlob } from "../db/blob-storage.js";
import { getDatabase } from "../db/index.js";
import {
  canAccessRequest,
  canManageLeaveCredits,
  createApprovalUpdate,
  isHumanResourceReviewer,
} from "./authorization.js";
import { LEAVE_CREDIT_KEYS } from "../db/schema.js";
import type {
  ArchiveDocument,
  AttachmentDocument,
  LeaveCreditKey,
  NotificationDocument,
  ProfileMediaDocument,
  PublicChatPresenceDocument,
  PublicChatMessageDocument,
  RequestDocument,
  SessionDocument,
  SpaceInvadersScoreDocument,
  UserDocument,
} from "../db/schema.js";
import { SYSTEM_ADMIN } from "../db/seed.js";

// --- password helpers ---
const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

const verifyPassword = (password: string, stored: string) => {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const publicUser = (user: UserDocument, viewer?: UserDocument) => {
  const {
    passwordHash,
    emailNormalized,
    createdAt,
    salary,
    salaryHistory,
    leaveCredits,
    signature,
    requestedRole,
    requestedDept,
    requestedEmploymentType,
    ...rest
  } = user;
  const canViewLeaveCredits =
    (viewer?.id === user.id &&
      user.role === "Employee" &&
      user.status === "Approved" &&
      user.employmentType === "Permanent") ||
    (viewer !== undefined && canManageLeaveCredits(viewer));
  const safeLeaveCredits = canViewLeaveCredits && leaveCredits ? { leaveCredits } : {};
  if (viewer && (viewer.role === "Admin" || viewer.id === user.id)) {
    return {
      ...rest,
      salary,
      salaryHistory,
      ...(viewer.role === "Admin" ? {} : safeLeaveCredits),
      signature,
      requestedRole,
      requestedDept,
      requestedEmploymentType,
    };
  }
  if (viewer && canManageLeaveCredits(viewer)) return { ...rest, ...safeLeaveCredits };
  return rest;
};

const json = (data: unknown, status = 200, headers?: HeadersInit) => {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json(data, { status, headers: responseHeaders });
};
const error = (message: string, status = 400) => json({ error: message }, status);

const SYSTEM_ADMIN_PASSWORD_REQUIRED =
  "Set the SYSTEM_ADMIN_PASSWORD environment variable before the first API request.";
const SESSION_COOKIE = "codh_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
type PseiQuote = {
  symbol: string;
  currency: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number | null;
  dayLow: number | null;
  quoteTime: number | null;
};
let pseiQuoteCache: { expiresAt: number; quote: PseiQuote } | null = null;
type CurrencyRates = {
  baseCode: "PHP";
  rates: Record<string, number>;
  lastUpdatedAt: number;
  nextUpdateAt: number;
};
let currencyRatesCache: { expiresAt: number; rates: CurrencyRates } | null = null;
const VALID_USER_ROLES = new Set<string>([
  "Admin",
  "Employee",
  "Department Head",
  "Human Resource",
  "Administrative Officer V",
  "Chief of Hospital",
]);
const VALID_REGISTRATION_ROLES = new Set([...VALID_USER_ROLES].filter(role => role !== "Admin"));
const VALID_EMPLOYMENT_TYPES = new Set(["Contract of Service", "Permanent"]);
const VALID_USER_STATUSES = new Set<string>(["Pending", "Approved", "Deactivated"]);
const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");
const isValidLeaveCredit = (credit: unknown): credit is number =>
  typeof credit === "number" &&
  Number.isFinite(credit) &&
  credit >= 0 &&
  credit <= 9999.99 &&
  Math.abs(credit * 100 - Math.round(credit * 100)) < 1e-8;
const isValidLeaveCreditRecord = (
  value: unknown,
): value is Partial<Record<LeaveCreditKey, number | null>> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const credits = value as Record<string, unknown>;
  const keys = Object.keys(credits);
  return keys.length > 0 && keys.every(key =>
    LEAVE_CREDIT_KEYS.some(creditKey => creditKey === key) &&
    (credits[key] === null || isValidLeaveCredit(credits[key]))
  );
};

const requestSessionToken = (req: Request) => {
  const cookies = req.headers.get("cookie");
  if (!cookies) return null;
  for (const cookie of cookies.split(";")) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=") || null;
  }
  return null;
};

const sessionCookie = (token: string, secure: boolean) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`;

const clearedSessionCookie = (secure: boolean) =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`;

const getSessionUser = async (
  req: Request,
  sessions: Collection<SessionDocument>,
  users: Collection<UserDocument>,
) => {
  const token = requestSessionToken(req);
  if (!token) return null;
  const tokenHash = sessionHash(token);
  const session = await sessions.findOne({ tokenHash, expiresAt: { $gt: new Date() } });
  if (!session) {
    await sessions.deleteOne({ tokenHash });
    return null;
  }
  const user = await users.findOne({ id: session.userId, status: "Approved" });
  if (!user) await sessions.deleteOne({ tokenHash });
  return user;
};

// Bootstrap the configured system administrator once, without deploying demo credentials.
let seeded = false;
const ensureSeeded = async () => {
  if (seeded) return;
  const db = await getDatabase();
  const users = db.collection<UserDocument>("users");
  const email = (process.env.SYSTEM_ADMIN_EMAIL || SYSTEM_ADMIN.email).trim().toLowerCase();
  let systemAdmin = await users.findOne({ emailNormalized: email });

  if (!systemAdmin) {
    const password = process.env.SYSTEM_ADMIN_PASSWORD;
    if (!password) throw new Error(SYSTEM_ADMIN_PASSWORD_REQUIRED);

    const passwordHash = hashPassword(password);
    const legacyAdmin = await users.findOne({ id: SYSTEM_ADMIN.id });

    if (legacyAdmin) {
      await users.updateOne(
        { id: legacyAdmin.id },
        { $set: {
          name: SYSTEM_ADMIN.name,
          email,
          emailNormalized: email,
          role: SYSTEM_ADMIN.role,
          dept: SYSTEM_ADMIN.dept,
          title: SYSTEM_ADMIN.title,
          passwordHash,
          status: SYSTEM_ADMIN.status,
        } },
      );
    } else {
      await users.updateOne(
        { emailNormalized: email },
        { $setOnInsert: {
          ...SYSTEM_ADMIN,
          email,
          emailNormalized: email,
          passwordHash,
          firstName: null,
          middleName: null,
          lastName: null,
          headOfDept: null,
          employmentType: "Contract of Service",
          salary: null,
          salaryHistory: [],
          avatar: null,
          signature: null,
          createdAt: new Date(),
        } },
        { upsert: true },
      );
    }

    systemAdmin = await users.findOne({ emailNormalized: email });
    if (!systemAdmin) throw new Error("Could not provision the configured system administrator.");
  } else {
    const adminUpdate: Partial<UserDocument> = {
      role: SYSTEM_ADMIN.role,
      dept: SYSTEM_ADMIN.dept,
      title: SYSTEM_ADMIN.title,
      status: SYSTEM_ADMIN.status,
    };
    if (systemAdmin.role !== SYSTEM_ADMIN.role) {
      const password = process.env.SYSTEM_ADMIN_PASSWORD;
      if (!password) throw new Error(SYSTEM_ADMIN_PASSWORD_REQUIRED);
      adminUpdate.name = SYSTEM_ADMIN.name;
      adminUpdate.passwordHash = hashPassword(password);
    }

    await users.updateOne({ id: systemAdmin.id }, { $set: adminUpdate });
  }
  seeded = true;
};

const nextRequestId = async () => {
  const year = new Date().getFullYear();
  const db = await getDatabase();
  const requests = db.collection<RequestDocument>("requests");
  const count = await requests.countDocuments();
  for (let n = count + 1; n < count + 1000; n++) {
    const id = `REQ-${year}-${String(n).padStart(3, "0")}`;
    const existing = await requests.findOne({ id }, { projection: { _id: 1 } });
    if (!existing) return id;
  }
  return `REQ-${year}-${Date.now()}`;
};

// Only allow known request columns to be written from client payloads.
const REQUEST_FIELDS = [
  "type", "subType", "section", "applicantId", "applicantName", "dateFiled", "logDate", "timeIn", "timeOut",
  "startDate", "endDate", "totalDays", "leaveDetails", "extraOffDate", "reason", "attachmentName", "attachmentId", "status", "deptHeadApproval",
  "finalApproval", "hrApproval", "approvedBy", "approvalDate", "taggedUsers", "logs",
] as const;

const pickRequest = (body: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const key of REQUEST_FIELDS) if (key in body) out[key] = body[key] ?? null;
  return out as Partial<RequestDocument>;
};

const APPLICANT_REQUEST_FIELDS = [
  "type", "subType", "logDate", "timeIn", "timeOut", "startDate", "endDate",
  "totalDays", "leaveDetails", "extraOffDate", "reason", "attachmentName", "attachmentId", "taggedUsers",
] as const;
const REQUEST_TYPES = new Set(["Missed Log", "Exchange of Duty", "Extra Off Request", "Leave"]);

const pickApplicantRequest = (body: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const key of APPLICANT_REQUEST_FIELDS) if (key in body) out[key] = body[key] ?? null;
  return out as Partial<RequestDocument>;
};

const getNotificationRecipients = (request: RequestDocument, users: UserDocument[]) => {
  const approvedUsers = users.filter(user => user.status === "Approved");
  let recipients: string[] = [];
  if (request.status === "Pending Duty Swap Approval") {
    recipients = request.taggedUsers || [];
  } else if (request.status === "Pending Dept Head Approval") {
    recipients = approvedUsers
      .filter(user => user.role === "Department Head" && (user.headOfDept || user.dept) === request.section)
      .map(user => user.id);
  } else if (request.status === "Pending Human Resource Verification") {
    recipients = approvedUsers.filter(user => isHumanResourceReviewer(user, approvedUsers)).map(user => user.id);
  } else if (request.status === "Pending Administrative Officer V Approval") {
    recipients = approvedUsers.filter(user => user.role === "Administrative Officer V").map(user => user.id);
  } else if (request.status === "Pending Chief of Hospital Approval") {
    recipients = approvedUsers.filter(user => user.role === "Chief of Hospital").map(user => user.id);
  }
  return [...new Set([request.applicantId, ...recipients])];
};

const getArchiveRecipients = (request: RequestDocument, users: UserDocument[]) => users
  .filter(user => user.status === "Approved" && (
    user.id === request.applicantId ||
    (user.role === "Department Head" && (user.headOfDept || user.dept) === request.section) ||
    (request.type === "Exchange of Duty" && request.taggedUsers?.includes(user.id)) ||
    isHumanResourceReviewer(user, users) ||
    ["Administrative Officer V", "Chief of Hospital"].includes(user.role)
  ))
  .map(user => user.id);

const isOwnedProfileMedia = async (
  value: unknown,
  userId: string,
  mediaType: "avatar" | "signature",
  profileMedia: Collection<ProfileMediaDocument>,
) => {
  if (value == null || value === "") return true;
  if (typeof value !== "string") return false;
  const match = /^\/api\/profile-media\/([^/?#]+)$/.exec(value);
  if (!match) return false;
  let mediaId: string;
  try {
    mediaId = decodeURIComponent(match[1]);
  } catch {
    return false;
  }
  return Boolean(await profileMedia.findOne(
    { id: mediaId, userId, mediaType },
    { projection: { _id: 1 } },
  ));
};

// --- file uploads ---
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((b, i) => bytes[i] === b);
const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export const handleApi = async (req: Request, apiPath?: string) => {
  try {
    const url = new URL(req.url);
    const parts = (apiPath ?? url.pathname).replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const [resource, id] = parts;

    if (resource === "market" && id === "psei" && req.method === "GET") {
      if (pseiQuoteCache && pseiQuoteCache.expiresAt > Date.now()) {
        return json(pseiQuoteCache.quote);
      }

      try {
        const response = await fetch(
          "https://query1.finance.yahoo.com/v8/finance/chart/PSEI.PS?range=1d&interval=1m",
          {
            headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!response.ok) return error("The PSEi quote provider is temporarily unavailable.", 502);

        const payload = await response.json() as {
          chart?: {
            result?: Array<{
              meta?: {
                currency?: string;
                regularMarketPrice?: number;
                regularMarketChangePercent?: number;
                previousClose?: number;
                regularMarketDayHigh?: number;
                regularMarketDayLow?: number;
                regularMarketTime?: number;
              };
            }>;
          };
        };
        const meta = payload.chart?.result?.[0]?.meta;
        const price = meta?.regularMarketPrice;
        const changePercent = meta?.regularMarketChangePercent;
        const previousClose = meta?.previousClose;
        if (
          !meta ||
          typeof price !== "number" || !Number.isFinite(price) ||
          typeof changePercent !== "number" || !Number.isFinite(changePercent) ||
          typeof previousClose !== "number" || !Number.isFinite(previousClose)
        ) {
          return error("The PSEi quote provider returned invalid market data.", 502);
        }

        const quote: PseiQuote = {
          symbol: "PSEI.PS",
          currency: meta?.currency || "PHP",
          price,
          change: price - previousClose,
          changePercent,
          dayHigh: typeof meta.regularMarketDayHigh === "number" ? meta.regularMarketDayHigh : null,
          dayLow: typeof meta.regularMarketDayLow === "number" ? meta.regularMarketDayLow : null,
          quoteTime: typeof meta.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : null,
        };
        pseiQuoteCache = { expiresAt: Date.now() + 60_000, quote };
        return json(quote);
      } catch {
        return error("Unable to retrieve the latest PSEi quote. Please try again later.", 502);
      }
    }

    if (resource === "market" && id === "currency-rates" && req.method === "GET") {
      if (currencyRatesCache && currencyRatesCache.expiresAt > Date.now()) {
        return json(currencyRatesCache.rates);
      }

      try {
        const response = await fetch("https://open.er-api.com/v6/latest/PHP", {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) return error("The exchange-rate provider is temporarily unavailable.", 502);

        const payload = await response.json() as {
          result?: string;
          base_code?: string;
          rates?: Record<string, unknown>;
          time_last_update_unix?: number;
          time_next_update_unix?: number;
        };
        const rawRates = payload.rates;
        if (
          payload.result !== "success" ||
          payload.base_code !== "PHP" ||
          !rawRates ||
          typeof rawRates !== "object" ||
          Array.isArray(rawRates) ||
          typeof payload.time_last_update_unix !== "number" ||
          !Number.isFinite(payload.time_last_update_unix) ||
          typeof payload.time_next_update_unix !== "number" ||
          !Number.isFinite(payload.time_next_update_unix) ||
          payload.time_next_update_unix <= payload.time_last_update_unix
        ) {
          return error("The exchange-rate provider returned invalid data.", 502);
        }

        const entries = Object.entries(rawRates);
        if (
          entries.length < 20 ||
          entries.some(([currency, rate]) =>
            !/^[A-Z]{3}$/.test(currency) ||
            typeof rate !== "number" ||
            !Number.isFinite(rate) ||
            rate <= 0
          )
        ) {
          return error("The exchange-rate provider returned invalid currency rates.", 502);
        }

        const rates = Object.fromEntries(entries) as Record<string, number>;
        if (rates.PHP !== 1 || typeof rates.USD !== "number") {
          return error("The exchange-rate provider did not return PHP and USD rates.", 502);
        }

        const exchangeRates: CurrencyRates = {
          baseCode: "PHP",
          rates,
          lastUpdatedAt: payload.time_last_update_unix * 1000,
          nextUpdateAt: payload.time_next_update_unix * 1000,
        };
        currencyRatesCache = {
          expiresAt: Math.max(Date.now() + 60_000, exchangeRates.nextUpdateAt),
          rates: exchangeRates,
        };
        return json(exchangeRates);
      } catch {
        return error("Unable to retrieve Philippine peso exchange rates. Please try again later.", 502);
      }
    }

    await ensureSeeded();
    const db = await getDatabase();
    const users = db.collection<UserDocument>("users");
    const requests = db.collection<RequestDocument>("requests");
    const notifications = db.collection<NotificationDocument>("notifications");
    const archives = db.collection<ArchiveDocument>("archives");
    const attachments = db.collection<AttachmentDocument>("attachments");
    const profileMedia = db.collection<ProfileMediaDocument>("profileMedia");
    const publicChatMessages = db.collection<PublicChatMessageDocument>("publicChatMessages");
    const publicChatPresence = db.collection<PublicChatPresenceDocument>("publicChatPresence");
    const spaceInvadersScores = db.collection<SpaceInvadersScoreDocument>("spaceInvadersScores");
    const sessions = db.collection<SessionDocument>("sessions");

    const [, , action] = parts;
    const method = req.method;

    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const requestOrigin = req.headers.get("origin");
      if (requestOrigin) {
        let origin: string;
        try {
          origin = new URL(requestOrigin).origin;
        } catch {
          return error("Cross-origin requests are not allowed.", 403);
        }
        if (origin !== url.origin) return error("Cross-origin requests are not allowed.", 403);
      }
    }

    if (resource === "logout" && method === "POST") {
      const token = requestSessionToken(req);
      if (token) await sessions.deleteOne({ tokenHash: sessionHash(token) });
      return json({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie(url.protocol === "https:") });
    }

    if (resource === "login" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const email = String(body.email || "").toLowerCase().trim();
      const password = String(body.password || "");
      if (password.length > 1024) return error("Invalid email or password.", 401);
      const user = await users.findOne({ emailNormalized: email });
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return error("Invalid email or password.", 401);
      }
      if (user.status !== "Approved") return error("Account is not approved.", 403);

      const token = randomBytes(32).toString("base64url");
      await sessions.insertOne({
        tokenHash: sessionHash(token),
        userId: user.id,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
      });
      return json(publicUser(user, user), 200, {
        "Set-Cookie": sessionCookie(token, url.protocol === "https:"),
      });
    }

    if (resource === "users" && method === "POST" && !id) {
      const body = await req.json().catch(() => ({}));
      const { firstName, middleName, lastName, email, password } = body;
      const title = String(body.title || "").trim();
      const requestedRole = String(body.requestedRole || "").trim();
      const requestedDept = String(body.requestedDept || "").trim();
      const requestedEmploymentType = String(body.requestedEmploymentType || "").trim();
      if (!String(firstName || "").trim() || !String(lastName || "").trim() || !title || !email) {
        return error("Please provide your first name, last name, position, and email.");
      }
      if (String(password || "").length !== 6) return error("Password must be exactly 6 characters.");
      if (requestedRole && !VALID_REGISTRATION_ROLES.has(requestedRole)) {
        return error("Select a valid requested role.");
      }
      if (requestedDept.length > 120) return error("Requested department must be 120 characters or fewer.");
      if (requestedEmploymentType && !VALID_EMPLOYMENT_TYPES.has(requestedEmploymentType)) {
        return error("Select a valid requested employment type.");
      }
      const existing = await users.findOne(
        { emailNormalized: String(email).toLowerCase().trim() },
        { projection: { _id: 1 } },
      );
      if (existing) return error("An account with this email already exists.", 409);
      const name = `${String(lastName).trim()}, ${String(firstName).trim()}${String(middleName || "").trim() ? ` ${String(middleName).trim()}` : ""}`;
      const created: UserDocument = {
        id: `emp-${Date.now()}`,
        name,
        firstName: String(firstName).trim(),
        middleName: String(middleName || "").trim() || null,
        lastName: String(lastName).trim(),
        email: String(email).trim(),
        emailNormalized: String(email).toLowerCase().trim(),
        role: "Employee",
        dept: null,
        headOfDept: null,
        title,
        employmentType: "Contract of Service",
        requestedRole: requestedRole || null,
        requestedDept: requestedDept || null,
        requestedEmploymentType: requestedEmploymentType || null,
        salary: null,
        salaryHistory: [],
        avatar: null,
        signature: null,
        passwordHash: hashPassword(String(password)),
        status: "Pending",
        createdAt: new Date(),
      };
      await users.insertOne(created);
      return json(publicUser(created), 201);
    }

    if (resource === "session" && method === "GET") {
      const sessionUser = await getSessionUser(req, sessions, users);
      return json(sessionUser ? publicUser(sessionUser, sessionUser) : null);
    }

    const actor = await getSessionUser(req, sessions, users);
    if (!actor) return error("Your session is invalid or has expired. Please sign in again.", 401);

    // --- PROFILE MEDIA (raw binary upload, handled before JSON parsing) ---
    if (resource === "profile-media") {
      if (method === "POST" && id && (action === "avatar" || action === "signature")) {
        if (id !== actor.id && actor.role !== "Admin") return error("You cannot update another user's profile media.", 403);
        const owner = await users.findOne({ id }, { projection: { _id: 1 } });
        if (!owner) return error("User not found.", 404);

        const fileName = decodeURIComponent(req.headers.get("x-file-name") || "profile-image.png").slice(0, 200);
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (bytes.length === 0) return error("The uploaded file is empty.");
        if (bytes.length > MAX_UPLOAD_BYTES) return error("File is too large. Maximum size is 4 MB.", 413);
        const contentType = isPng(bytes) && /\.png$/i.test(fileName)
          ? "image/png"
          : isJpeg(bytes) && /\.(jpe?g)$/i.test(fileName)
            ? "image/jpeg"
            : null;
        if (!contentType) return error("Only valid .png, .jpg, or .jpeg images are allowed.", 415);

        const mediaId = `MEDIA-${Date.now()}-${randomBytes(4).toString("hex")}`;
        const blobKey = `${mediaId}.${contentType === "image/png" ? "png" : "jpg"}`;
        await setStoredBlob("profile-media", blobKey, bytes.buffer as ArrayBuffer, {
          fileName,
          contentType,
          userId: id,
          mediaType: action,
        });
        try {
          await profileMedia.insertOne({
            id: mediaId,
            userId: id,
            mediaType: action,
            fileName,
            contentType,
            size: bytes.length,
            blobKey,
            createdAt: new Date(),
          });
        } catch (err) {
          try {
            await deleteStoredBlob("profile-media", blobKey);
          } catch (cleanupError) {
            console.error("Could not clean up profile media blob:", cleanupError);
          }
          throw err;
        }
        return json({
          id: mediaId,
          fileName,
          url: `/api/profile-media/${encodeURIComponent(mediaId)}`,
        }, 201);
      }

      if (id && method === "GET") {
        const media = await profileMedia.findOne({ id });
        if (!media) return error("Profile image not found.", 404);
        if (media.mediaType === "signature" && media.userId !== actor.id && actor.role !== "Admin") {
          const signatureUrl = `/api/profile-media/${encodeURIComponent(id)}`;
          const [signedRequests, allUsers] = await Promise.all([
            requests.find({ "logs.signature": signatureUrl }).toArray(),
            users.find().toArray(),
          ]);
          if (!signedRequests.some(request => canAccessRequest(actor, request, allUsers))) {
            return error("You cannot access this signature.", 403);
          }
        }
        const data = await getStoredBlob("profile-media", media.blobKey);
        if (!data) return error("Profile image file is missing.", 404);
        return new Response(data, {
          headers: {
            "Content-Type": media.contentType,
            "Content-Disposition": `inline; filename="${media.fileName.replace(/["\\\r\n]/g, "")}"`,
            "Cache-Control": media.mediaType === "signature" ? "private, no-store" : "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
    }

    // --- ATTACHMENTS (raw binary upload, handled before JSON parsing) ---
    if (resource === "attachments") {
      // POST /api/attachments — body is the raw PNG or JPEG file
      if (method === "POST" && !id) {
        const fileName = decodeURIComponent(req.headers.get("x-file-name") || "attachment.png").slice(0, 200);
        const uploadedBy = actor.id;
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (bytes.length === 0) return error("The uploaded file is empty.");
        if (bytes.length > MAX_UPLOAD_BYTES) return error("File is too large. Maximum size is 4 MB.", 413);
        const contentType = isPng(bytes) && /\.png$/i.test(fileName)
          ? "image/png"
          : isJpeg(bytes) && /\.(jpe?g)$/i.test(fileName)
            ? "image/jpeg"
            : null;
        if (!contentType) return error("Only valid .png, .jpg, or .jpeg images are allowed.", 415);

        const attachmentId = `ATT-${Date.now()}-${randomBytes(4).toString("hex")}`;
        const extension = contentType === "image/png" ? "png" : "jpg";
        const blobKey = `${attachmentId}.${extension}`;
        await setStoredBlob("request-attachments", blobKey, bytes.buffer as ArrayBuffer, {
          fileName,
          contentType,
        });
        const created: AttachmentDocument = {
          id: attachmentId,
          uploadedBy,
          fileName,
          contentType,
          size: bytes.length,
          blobKey,
          createdAt: new Date(),
        };
        await attachments.insertOne(created);
        const { createdAt, blobKey: _k, ...rest } = created;
        return json(rest, 201);
      }

      // GET /api/attachments/<id> — serve the stored file
      if (id && method === "GET") {
        const meta = await attachments.findOne({ id });
        if (!meta) return error("Attachment not found.", 404);
        if (actor.role !== "Admin") {
          if (!meta.requestId) {
            if (meta.uploadedBy !== actor.id) return error("You cannot access this attachment.", 403);
          } else {
            const request = await requests.findOne({ id: meta.requestId });
            if (!request || !canAccessRequest(actor, request, await users.find().toArray())) {
              return error("You cannot access this attachment.", 403);
            }
          }
        }
        const data = await getStoredBlob("request-attachments", meta.blobKey);
        if (!data) return error("Attachment file is missing.", 404);
        return new Response(data, {
          headers: {
            "Content-Type": meta.contentType,
            "Content-Disposition": `inline; filename="${meta.fileName.replace(/["\\\r\n]/g, "")}"`,
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
    }

    const body = ["POST", "PUT", "PATCH"].includes(method) ? await req.json().catch(() => ({})) : {};

    if (resource === "public-chat") {
      if (method === "POST" && id === "presence") {
        const now = new Date();
        await publicChatPresence.updateOne(
          { userId: actor.id },
          { $set: { lastSeenAt: now } },
          { upsert: true },
        );
        const onlineCount = await publicChatPresence.countDocuments({
          lastSeenAt: { $gt: new Date(now.getTime() - 60_000) },
        });
        return json({ onlineCount });
      }

      if (method === "GET" && !id) {
        const messages = await publicChatMessages
          .find()
          .sort({ createdAt: -1, id: -1 })
          .limit(100)
          .toArray();
        return json({ messages: messages.reverse() });
      }

      if (method === "POST" && !id) {
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (!message) return error("Type a message before sending.");
        if (message.length > 500) return error("Messages must be 500 characters or fewer.");

        const created: PublicChatMessageDocument = {
          id: `CHAT-${Date.now()}-${randomBytes(4).toString("hex")}`,
          senderId: actor.id,
          senderName: actor.name,
          senderRole: actor.role,
          senderAvatar: actor.avatar || null,
          message,
          createdAt: new Date(),
        };
        await publicChatMessages.insertOne(created);
        return json(created, 201);
      }

      if (method === "DELETE" && id) {
        const message = await publicChatMessages.findOne({ id });
        if (!message) return error("Public chat message not found.", 404);
        if (message.senderId !== actor.id) {
          return error("You can only unsend your own messages.", 403);
        }
        await publicChatMessages.deleteOne({ id });
        return json({ ok: true });
      }
    }

    // GET /api/data — everything the dashboard needs
    if (resource === "data" && method === "GET") {
      const [u, r, n, existingArchives] = await Promise.all([
        users.find().sort({ createdAt: 1 }).toArray(),
        requests.find().sort({ createdAt: -1 }).toArray(),
        notifications.find().sort({ createdAt: -1 }).toArray(),
        archives.find().sort({ createdAt: -1 }).toArray(),
      ]);
      const departmentHeadApplicantIds = new Set(
        u.filter(user => user.role === "Department Head").map(user => user.id),
      );
      for (const request of r) {
        if (
          departmentHeadApplicantIds.has(request.applicantId) &&
          request.status === "Pending Administrative Officer V Approval" &&
          request.deptHeadApproval === "Not required" &&
          request.hrApproval === "Not required" &&
          request.finalApproval === "Pending"
        ) {
          const result = await requests.updateOne(
            {
              id: request.id,
              status: "Pending Administrative Officer V Approval",
              deptHeadApproval: "Not required",
              hrApproval: "Not required",
              finalApproval: "Pending",
            },
            { $set: { status: "Pending Human Resource Verification", hrApproval: "Pending" } },
          );
          if (result.matchedCount) {
            request.status = "Pending Human Resource Verification";
            request.hrApproval = "Pending";
          }
        }
      }
      const humanResourceDepartmentHeads = u.filter(user =>
        user.role === "Department Head" &&
        (user.headOfDept || user.dept) === "Human Resource Department" &&
        user.status === "Approved",
      );
      const humanResourceUsers = humanResourceDepartmentHeads.length
        ? humanResourceDepartmentHeads
        : u.filter(user => user.role === "Human Resource" && user.status === "Approved");
      const pendingHrRequests = r.filter(request =>
        request.status === "Pending Human Resource Verification" && (request.hrApproval || "Pending") === "Pending",
      );
      const existingHrNotifications = new Set(
        n
          .filter(notification => notification.title === "Verification required: Human Resource" && notification.requestId)
          .map(notification => `${notification.userId}:${notification.requestId}`),
      );
      const missingHrNotifications = pendingHrRequests.flatMap(request =>
        humanResourceUsers
          .filter(user => !existingHrNotifications.has(`${user.id}:${request.id}`))
          .map(user => ({
            id: `notif-${Date.now()}-${randomBytes(3).toString("hex")}`,
            userId: user.id,
            requestId: request.id,
            title: "Verification required: Human Resource",
            message: `Request ${request.id} is awaiting Human Resource verification.`,
            date: request.approvalDate || request.dateFiled || new Date().toLocaleString(),
            read: false,
          })),
      );
      const createdHrNotifications: NotificationDocument[] = missingHrNotifications.map(notification => ({
        ...notification,
        createdAt: new Date(),
      }));
      if (createdHrNotifications.length) await notifications.insertMany(createdHrNotifications);
      const finalizedRequests = r.filter(request => ["Approved", "Rejected"].includes(request.status));
      const existingHrCopies = new Set(
        existingArchives
          .filter(archive => archive.recipientId)
          .map(archive => `${archive.originalReqId}:${archive.recipientId}`),
      );
      const missingHrCopies = finalizedRequests.flatMap(request =>
        humanResourceUsers
          .filter(user => !existingHrCopies.has(`${request.id}:${user.id}`))
          .map(user => ({
            id: `ARCH-${Date.now()}-${randomBytes(3).toString("hex")}`,
            originalReqId: request.id,
            applicantId: request.applicantId,
            recipientId: user.id,
            applicantName: request.applicantName,
            type: request.type,
            section: request.section,
            status: request.status,
            archivedDate: request.approvalDate || request.dateFiled,
            reason: request.reason,
          })),
      );
      const createdHrCopies: ArchiveDocument[] = missingHrCopies.map(archive => ({
        ...archive,
        createdAt: new Date(),
      }));
      if (createdHrCopies.length) await archives.insertMany(createdHrCopies);
      const a = [...createdHrCopies, ...existingArchives];
      const visibleUsers = actor.role === "Admin"
        ? u
        : u.filter(user => user.status === "Approved" || user.id === actor.id);
      const visibleRequests = r.filter(request => canAccessRequest(actor, request, u));
      const visibleNotifications = [...createdHrNotifications, ...n]
        .filter(notification => notification.userId === actor.id);
      const visibleArchives = actor.role === "Admin"
        ? a
        : a.filter(archive => archive.recipientId === actor.id || archive.applicantId === actor.id);
      return json({
        users: visibleUsers.map(user => publicUser(user, actor)),
        requests: visibleRequests.map(({ createdAt, ...rest }) => rest),
        notifications: visibleNotifications.map(({ createdAt, ...rest }) => rest),
        archives: visibleArchives.map(({ createdAt, ...rest }) => rest),
      });
    }

    // --- SPACE INVADERS LEADERBOARD ---
    if (resource === "space-invaders") {
      if (method === "GET") {
        const [approvedUsers, scores] = await Promise.all([
          users.find(
            { status: "Approved" },
            { projection: { _id: 0, id: 1, name: 1, avatar: 1 } },
          ).toArray(),
          spaceInvadersScores.find().toArray(),
        ]);
        const scoresByUser = new Map(scores.map(score => [score.userId, score]));
        const leaderboard = approvedUsers
          .map(user => ({
            userId: user.id,
            name: user.name,
            avatar: user.avatar,
            highScore: scoresByUser.get(user.id)?.highScore || 0,
            updatedAt: scoresByUser.get(user.id)?.updatedAt || null,
          }))
          .sort((a, b) => b.highScore - a.highScore || a.name.localeCompare(b.name));
        return json({ leaderboard });
      }

      if (method === "POST") {
        const userId = actor.id;
        const score = Number(body.score);
        if (!Number.isSafeInteger(score) || score < 0 || score > 10000000) {
          return error("A valid score is required.");
        }
        await spaceInvadersScores.updateOne(
          { userId },
          {
            $max: { highScore: score },
            $set: { updatedAt: new Date() },
            $setOnInsert: { userId },
          },
          { upsert: true },
        );
        return json({ ok: true });
      }
    }

    // --- USERS ---
    if (resource === "users") {
      if (id && method === "PUT") {
        if (actor.role !== "Admin" && id !== actor.id) {
          if (!canManageLeaveCredits(actor) || Object.keys(body).length !== 1 || !("leaveCredits" in body)) {
            return error("You cannot update another user's account.", 403);
          }
        }
        const user = await users.findOne({ id });
        if (!user) return error("User not found.", 404);
        if ("leaveCredits" in body) {
          if (Object.keys(body).length !== 1) {
            return error("Leave credits must be updated separately from other account fields.");
          }
          if (!canManageLeaveCredits(actor)) {
            return error("Only an approved Human Resource account can update leave credits.", 403);
          }
          if (user.role !== "Employee" || user.status !== "Approved" || user.employmentType !== "Permanent") {
            return error("Leave credits can only be assigned to approved Permanent employee accounts.");
          }
          const value = body.leaveCredits;
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return error("Enter valid leave credits for all categories.");
          }
          if (!isValidLeaveCreditRecord(value)) {
            return error("Each leave balance must be blank or a non-negative number with up to two decimal places.");
          }
          const leaveCredits: Partial<Record<LeaveCreditKey, number | null>> = {};
          for (const key of LEAVE_CREDIT_KEYS) {
            leaveCredits[key] = Object.prototype.hasOwnProperty.call(value, key)
              ? value[key] ?? null
              : user.leaveCredits?.[key] ?? null;
          }

          await users.updateOne(
            { id },
            {
              $set: {
                leaveCredits: {
                  ...leaveCredits,
                  updatedAt: new Date().toISOString(),
                  updatedBy: actor.id,
                },
              },
            },
          );
          const updated = await users.findOne({ id });
          if (!updated) return error("User not found.", 404);
          return json(publicUser(updated, actor));
        }
        if ("avatar" in body && !await isOwnedProfileMedia(body.avatar, id, "avatar", profileMedia)) {
          return error("Select a valid profile image.", 400);
        }
        if ("signature" in body && !await isOwnedProfileMedia(body.signature, id, "signature", profileMedia)) {
          return error("Select a valid signature image.", 400);
        }
        if (actor.role !== "Admin" &&
            ["role", "status", "dept", "headOfDept", "employmentType"].some(key => key in body)) {
          return error("Only an administrator can change roles, status, department, or employment type.", 403);
        }
        if ("password" in body && (actor.role !== "Admin" || id === actor.id)) {
          return error("Only an administrator can set another account's password.", 403);
        }
        const employmentType = "employmentType" in body
          ? String(body.employmentType || "")
          : user.employmentType || "Contract of Service";
        if (!VALID_EMPLOYMENT_TYPES.has(employmentType)) {
          return error("Select a valid employment type.");
        }

        if ("currentPassword" in body || "newPassword" in body) {
          if (id !== actor.id) {
            return error("Password changes must be made from your own account.", 403);
          }
          const currentPassword = String(body.currentPassword || "");
          const newPassword = String(body.newPassword || "");
          if (!currentPassword || !newPassword) return error("Enter your current password and a new password.");
          if (newPassword.length !== 6) return error("New password must be exactly 6 characters.");
          if (!verifyPassword(currentPassword, user.passwordHash)) return error("Current password is incorrect.", 401);
        }

        const updates: Partial<UserDocument> = {};
        for (const key of ["email", "role", "dept", "headOfDept", "avatar", "signature", "status"] as const) {
          if (key in body) (updates as Record<string, unknown>)[key] = body[key];
        }
        if (updates.role && !VALID_USER_ROLES.has(updates.role)) {
          return error("Select a valid account role.");
        }
        if (updates.status && !VALID_USER_STATUSES.has(updates.status)) {
          return error("Select a valid account status.");
        }
        if (updates.status === "Approved" && !String(updates.dept ?? user.dept ?? "").trim()) {
          return error("Assign a department before approving this account.");
        }
        if ("email" in body) {
          const normalizedEmail = String(body.email).toLowerCase().trim();
          if (!normalizedEmail) return error("Email address is required.");
          updates.email = String(body.email).trim();
          updates.emailNormalized = normalizedEmail;
          const duplicateEmail = await users.findOne({
            emailNormalized: normalizedEmail,
            id: { $ne: id },
          }, { projection: { _id: 1 } });
          if (duplicateEmail) return error("An account with this email already exists.", 409);
        }
        const hasNameFields = ["firstName", "middleName", "lastName"].some(key => key in body);
        if (hasNameFields) {
          const firstName = String(body.firstName ?? user.firstName ?? "").trim();
          const middleName = String(body.middleName ?? user.middleName ?? "").trim();
          const lastName = String(body.lastName ?? user.lastName ?? "").trim();
          if (!firstName || !lastName) return error("First name and last name are required.");
          updates.firstName = firstName;
          updates.middleName = middleName || null;
          updates.lastName = lastName;
          updates.name = `${lastName}, ${firstName}${middleName ? ` ${middleName}` : ""}`;
        } else if ("name" in body) {
          updates.name = String(body.name);
        }
        if ("employmentType" in body) updates.employmentType = employmentType;
        if (employmentType === "Permanent") {
          if ("title" in body) updates.title = body.title == null ? null : String(body.title);
          if ("salary" in body) {
            const salary = String(body.salary || "").trim();
            if (salary && !/^\d+(?:\.\d{1,2})?$/.test(salary)) {
              return error("Salary must be a non-negative amount with up to two decimal places.");
            }
            if (salary && salary !== user.salary) {
              updates.salary = salary;
              updates.salaryHistory = [
                ...(user.salaryHistory || []),
                {
                  id: `SAL-${Date.now()}-${randomBytes(3).toString("hex")}`,
                  adjustedAt: new Date().toISOString(),
                  previousSalary: user.salary || null,
                  newSalary: salary,
                },
              ];
            }
          }
        } else if (("salary" in body && body.salary !== "") || ("title" in body && body.title)) {
          return error("Position and salary can only be updated for permanent accounts.");
        }
        if (body.newPassword) updates.passwordHash = hashPassword(String(body.newPassword));
        if (body.password) updates.passwordHash = hashPassword(String(body.password));
        await users.updateOne({ id }, { $set: updates });
        if (updates.status && updates.status !== "Approved") {
          await sessions.deleteMany({ userId: id });
        }
        const updated = await users.findOne({ id });
        if (!updated) return error("User not found.", 404);
        return json(publicUser(updated, actor));
      }

      if (id && method === "DELETE") {
        if (actor.role !== "Admin") return error("Only an administrator can delete user accounts.", 403);
        await sessions.deleteMany({ userId: id });
        await users.deleteOne({ id });
        return json({ ok: true });
      }
    }

    // --- REQUESTS ---
    if (resource === "requests") {
      if (method === "POST" && !id) {
        const values = pickApplicantRequest(body);
        if (!values.type || !REQUEST_TYPES.has(values.type)) return error("Select a valid request type.");
        if (!actor.dept) return error("Your account must be assigned to a department before submitting requests.", 403);
        const taggedUsers = values.type === "Exchange of Duty" && Array.isArray(values.taggedUsers)
          ? [...new Set(values.taggedUsers.filter((userId): userId is string => typeof userId === "string"))]
          : [];
        if (values.type === "Exchange of Duty") {
          const coveringUsers = await users.find({
            id: { $in: taggedUsers },
            role: "Employee",
            status: "Approved",
          }, { projection: { _id: 0, id: 1 } }).toArray();
          if (taggedUsers.length !== 1 || taggedUsers[0] === actor.id || coveringUsers.length !== taggedUsers.length) {
            return error("Select one available covering employee.");
          }
        }
        if (values.attachmentId) {
          const attachment = await attachments.findOne({ id: values.attachmentId, uploadedBy: actor.id });
          if (!attachment) return error("The selected attachment is unavailable.", 403);
        }
        const created: RequestDocument = {
          ...values,
          id: await nextRequestId(),
          dateFiled: new Date().toLocaleString(),
          status: values.type === "Exchange of Duty"
            ? "Pending Duty Swap Approval"
            : actor.role === "Department Head"
              ? "Pending Human Resource Verification"
              : "Pending Dept Head Approval",
          hrApproval: "Pending",
          applicantId: actor.id,
          applicantName: actor.name,
          section: actor.dept,
          taggedUsers,
          deptHeadApproval: actor.role === "Department Head" ? "Not required" : "Pending",
          finalApproval: "Pending",
          approvedBy: null,
          approvalDate: null,
          logs: [{
            date: new Date().toLocaleString(),
            action: `Submitted by ${actor.name}`,
            user: actor.name,
            userId: actor.id,
          }],
          type: values.type,
          createdAt: new Date(),
        };
        const archiveCopy: ArchiveDocument = {
          id: `ARCH-${Date.now()}-${randomBytes(3).toString("hex")}`,
          originalReqId: created.id,
          applicantId: actor.id,
          recipientId: actor.id,
          applicantName: created.applicantName,
          type: created.type,
          section: created.section,
          status: created.status,
          archivedDate: created.dateFiled || "",
          reason: created.reason,
          createdAt: new Date(),
        };
        await requests.insertOne(created);
        try {
          await archives.insertOne(archiveCopy);
          if (created.attachmentId) {
            await attachments.updateOne({ id: created.attachmentId }, { $set: { requestId: created.id } });
          }
        } catch (err) {
          const rollbacks = await Promise.allSettled([
            requests.deleteOne({ id: created.id }),
            archives.deleteOne({ id: archiveCopy.id }),
            ...(created.attachmentId
              ? [attachments.updateOne({ id: created.attachmentId }, { $set: { requestId: null } })]
              : []),
          ]);
          if (rollbacks.some(result => result.status === "rejected")) {
            console.error("Could not fully roll back request creation after archive-copy failure.", rollbacks);
          }
          throw err;
        }
        const { createdAt: requestCreatedAt, ...requestResponse } = created;
        const { createdAt: archiveCreatedAt, ...archiveResponse } = archiveCopy;
        return json({ request: requestResponse, archiveCopy: archiveResponse }, 201);
      }

      if (id && method === "PUT") {
        const request = await requests.findOne({ id });
        if (!request) return error("Request not found.", 404);
        let updates: Partial<RequestDocument>;

        if (actor.role === "Admin") {
          updates = pickRequest(body);
        } else if (request.applicantId === actor.id) {
          if (!["Pending Duty Swap Approval", "Pending Dept Head Approval"].includes(request.status)) {
            return error("This request can no longer be edited.", 403);
          }
          updates = pickApplicantRequest(body);
          if (!REQUEST_TYPES.has(String(updates.type))) {
            return error("Select a valid request type.");
          }
          if (updates.type === "Exchange of Duty") {
            const taggedUsers = Array.isArray(updates.taggedUsers)
              ? [...new Set(updates.taggedUsers.filter((userId): userId is string => typeof userId === "string"))]
              : request.taggedUsers || [];
            const coveringUsers = await users.find({
              id: { $in: taggedUsers },
              role: "Employee",
              status: "Approved",
            }, { projection: { _id: 0, id: 1 } }).toArray();
            if (taggedUsers.length !== 1 || taggedUsers[0] === actor.id || coveringUsers.length !== taggedUsers.length) {
              return error("Select one available covering employee.");
            }
            updates.taggedUsers = taggedUsers;
            updates.status = "Pending Duty Swap Approval";
            updates.deptHeadApproval = "Pending";
            updates.hrApproval = "Pending";
            updates.finalApproval = "Pending";
          } else if (request.status === "Pending Duty Swap Approval") {
            updates.taggedUsers = [];
            updates.status = "Pending Dept Head Approval";
            updates.deptHeadApproval = "Pending";
            updates.hrApproval = "Pending";
            updates.finalApproval = "Pending";
          } else {
            updates.taggedUsers = request.taggedUsers || [];
          }
          if (updates.attachmentId && updates.attachmentId !== request.attachmentId) {
            const attachment = await attachments.findOne({ id: updates.attachmentId, uploadedBy: actor.id });
            if (!attachment) return error("The selected attachment is unavailable.", 403);
          }
        } else {
          const allUsers = await users.find({ status: "Approved" }).toArray();
          const approvalUpdate = createApprovalUpdate(
            request,
            actor,
            allUsers,
            String(body.status || ""),
            String(body.approvalDate || new Date().toLocaleString()),
          );
          if (!approvalUpdate) return error("This request is not awaiting your approval stage.", 403);
          updates = approvalUpdate;
        }

        await requests.updateOne({ id }, { $set: updates });
        if (updates.attachmentId) {
          await attachments.updateOne({ id: updates.attachmentId }, { $set: { requestId: id } });
        }
        const updated = await requests.findOne({ id });
        if (!updated) return error("Request not found.", 404);
        const { createdAt, ...rest } = updated;
        return json(rest);
      }
    }

    // --- NOTIFICATIONS ---
    if (resource === "notifications") {
      if (method === "POST" && !id) {
        const { userId, requestId, title, message, date } = body;
        if (!userId || !requestId || !title || !message) return error("Missing notification fields.");
        const request = await requests.findOne({ id: String(requestId) });
        if (!request) return error("Request not found.", 404);
        const allUsers = await users.find({ status: "Approved" }).toArray();
        const recipients = getNotificationRecipients(request, allUsers);
        const lastLog = request.logs?.at(-1);
        if (!recipients.includes(String(userId)) ||
            lastLog?.userId !== actor.id) {
          return error("You cannot create this notification.", 403);
        }
        const created: NotificationDocument = {
          id: `notif-${Date.now()}-${randomBytes(3).toString("hex")}`,
          userId: String(userId),
          requestId: String(requestId),
          title: String(title),
          message: String(message),
          date: date == null ? null : String(date),
          read: false,
          createdAt: new Date(),
        };
        await notifications.insertOne(created);
        return json(created, 201);
      }

      // POST /api/notifications/<notificationId>/read
      if (id && action === "read" && method === "POST") {
        const updated = await notifications.updateOne(
          { id, userId: actor.id },
          { $set: { read: true } },
        );
        if (!updated.matchedCount) return error("Notification not found.", 404);
        return json({ ok: true });
      }
    }

    // --- ARCHIVES ---
    if (resource === "archives" && method === "POST" && !id) {
      const { originalReqId, recipientId, archivedDate } = body;
      if (!originalReqId || !recipientId) return error("Missing archive fields.");
      const request = await requests.findOne({ id: String(originalReqId) });
      if (!request) return error("Request not found.", 404);
      if (!["Approved", "Rejected"].includes(request.status)) {
        return error("Only completed requests can be archived.", 403);
      }
      const allUsers = await users.find({ status: "Approved" }).toArray();
      if (!getArchiveRecipients(request, allUsers).includes(String(recipientId))) {
        return error("You cannot create this archive copy.", 403);
      }
      const lastLog = request.logs?.at(-1);
      if (actor.role !== "Admin" && lastLog?.userId !== actor.id) {
        return error("Only the reviewer who completed the request can create archive copies.", 403);
      }
      const existing = await archives.findOne({
        originalReqId: request.id,
        recipientId: String(recipientId),
      });
      const archiveFields = {
        applicantId: request.applicantId,
        recipientId: String(recipientId),
        applicantName: request.applicantName,
        type: request.type,
        section: request.section,
        status: request.status,
        archivedDate: String(request.approvalDate || archivedDate || request.dateFiled || ""),
        reason: request.reason,
      };
      if (existing) {
        await archives.updateOne({ id: existing.id }, { $set: archiveFields });
        const updated = await archives.findOne({ id: existing.id });
        if (!updated) return error("The archive copy could not be updated.", 500);
        const { createdAt, ...rest } = updated;
        return json(rest);
      }
      const created: ArchiveDocument = {
        id: `ARCH-${Date.now()}-${randomBytes(3).toString("hex")}`,
        originalReqId: request.id,
        ...archiveFields,
        createdAt: new Date(),
      };
      await archives.insertOne(created);
      return json(created, 201);
    }

    return error("Not found.", 404);
  } catch (err) {
    console.error("API error:", err);
    if (err instanceof Error && err.message === SYSTEM_ADMIN_PASSWORD_REQUIRED) {
      return error(SYSTEM_ADMIN_PASSWORD_REQUIRED, 500);
    }
    if (err instanceof Error && err.message.startsWith("Connect a PostgreSQL Marketplace database")) {
      return error(err.message, 500);
    }
    return error("Server error. Please try again.", 500);
  }
};
