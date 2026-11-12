import type { Config } from "@netlify/functions";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, desc, sql } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import { db } from "../../db/index.js";
import { users, requests, notifications, archives, attachments, profileMedia, spaceInvadersScores } from "../../db/schema.js";
import { SYSTEM_ADMIN } from "../../db/seed.js";

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

type UserRow = typeof users.$inferSelect;
const publicUser = ({ passwordHash, createdAt, ...rest }: UserRow) => rest;

const json = (data: unknown, status = 200) => Response.json(data, { status });
const error = (message: string, status = 400) => json({ error: message }, status);

const SYSTEM_ADMIN_PASSWORD_REQUIRED =
  "Set the SYSTEM_ADMIN_PASSWORD environment variable in Netlify before the first API request.";

// Bootstrap the configured system administrator once, without deploying demo credentials.
let seeded = false;
const ensureSeeded = async () => {
  if (seeded) return;
  const email = (process.env.SYSTEM_ADMIN_EMAIL || SYSTEM_ADMIN.email).trim().toLowerCase();
  let [systemAdmin] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (!systemAdmin) {
    const password = process.env.SYSTEM_ADMIN_PASSWORD;
    if (!password) throw new Error(SYSTEM_ADMIN_PASSWORD_REQUIRED);

    const passwordHash = hashPassword(password);
    const [legacyAdmin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, SYSTEM_ADMIN.id))
      .limit(1);

    if (legacyAdmin) {
      await db
        .update(users)
        .set({
          name: SYSTEM_ADMIN.name,
          email,
          role: SYSTEM_ADMIN.role,
          dept: SYSTEM_ADMIN.dept,
          title: SYSTEM_ADMIN.title,
          passwordHash,
          status: SYSTEM_ADMIN.status,
        })
        .where(eq(users.id, legacyAdmin.id));
    } else {
      await db
        .insert(users)
        .values({
          ...SYSTEM_ADMIN,
          email,
          passwordHash,
        })
        .onConflictDoNothing();
    }

    [systemAdmin] = await db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (!systemAdmin) throw new Error("Could not provision the configured system administrator.");
  } else {
    const adminUpdate: Partial<typeof users.$inferInsert> = {
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

    await db.update(users).set(adminUpdate).where(eq(users.id, systemAdmin.id));
  }
  seeded = true;
};

const nextRequestId = async () => {
  const year = new Date().getFullYear();
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(requests);
  for (let n = count + 1; n < count + 1000; n++) {
    const id = `REQ-${year}-${String(n).padStart(3, "0")}`;
    const existing = await db.select({ id: requests.id }).from(requests).where(eq(requests.id, id));
    if (existing.length === 0) return id;
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
  return out as Partial<typeof requests.$inferInsert>;
};

// --- file uploads ---
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((b, i) => bytes[i] === b);
const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
const uploadsStore = () => getStore({ name: "request-attachments", consistency: "strong" });
const profileMediaStore = () => getStore({ name: "profile-media", consistency: "strong" });

export default async (req: Request) => {
  try {
    await ensureSeeded();

    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const [resource, id, action] = parts;
    const method = req.method;

    // --- PROFILE MEDIA (raw binary upload, handled before JSON parsing) ---
    if (resource === "profile-media") {
      if (method === "POST" && id && (action === "avatar" || action === "signature")) {
        const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
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
        await profileMediaStore().set(blobKey, bytes.buffer as ArrayBuffer, {
          metadata: { fileName, contentType, userId: id, mediaType: action },
        });
        try {
          await db.insert(profileMedia).values({
            id: mediaId,
            userId: id,
            mediaType: action,
            fileName,
            contentType,
            size: bytes.length,
            blobKey,
          });
        } catch (err) {
          try {
            await profileMediaStore().delete(blobKey);
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
        const [media] = await db.select().from(profileMedia).where(eq(profileMedia.id, id));
        if (!media) return error("Profile image not found.", 404);
        const data = await profileMediaStore().get(media.blobKey, { type: "arrayBuffer" });
        if (!data) return error("Profile image file is missing.", 404);
        return new Response(data, {
          headers: {
            "Content-Type": media.contentType,
            "Content-Disposition": `inline; filename="${media.fileName.replace(/["\\\r\n]/g, "")}"`,
            "Cache-Control": "private, max-age=3600",
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
        const uploadedBy = req.headers.get("x-uploaded-by") || null;
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
        await uploadsStore().set(blobKey, bytes.buffer as ArrayBuffer, {
          metadata: { fileName, contentType },
        });
        const [created] = await db
          .insert(attachments)
          .values({ id: attachmentId, uploadedBy, fileName, contentType, size: bytes.length, blobKey })
          .returning();
        const { createdAt, blobKey: _k, ...rest } = created;
        return json(rest, 201);
      }

      // GET /api/attachments/<id> — serve the stored file
      if (id && method === "GET") {
        const [meta] = await db.select().from(attachments).where(eq(attachments.id, id));
        if (!meta) return error("Attachment not found.", 404);
        const data = await uploadsStore().get(meta.blobKey, { type: "arrayBuffer" });
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

    // GET /api/data — everything the dashboard needs
    if (resource === "data" && method === "GET") {
      const [u, r, n, existingArchives] = await Promise.all([
        db.select().from(users).orderBy(users.createdAt),
        db.select().from(requests).orderBy(desc(requests.createdAt)),
        db.select().from(notifications).orderBy(desc(notifications.createdAt)),
        db.select().from(archives).orderBy(desc(archives.createdAt)),
      ]);
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
      const createdHrNotifications = missingHrNotifications.length
        ? await db.insert(notifications).values(missingHrNotifications).returning()
        : [];
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
      const createdHrCopies = missingHrCopies.length
        ? await db.insert(archives).values(missingHrCopies).returning()
        : [];
      const a = [...createdHrCopies, ...existingArchives];
      return json({
        users: u.map(publicUser),
        requests: r.map(({ createdAt, ...rest }) => rest),
        notifications: [...createdHrNotifications, ...n].map(({ createdAt, ...rest }) => rest),
        archives: a.map(({ createdAt, ...rest }) => rest),
      });
    }

    // POST /api/login
    if (resource === "login" && method === "POST") {
      const email = String(body.email || "").toLowerCase().trim();
      const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
      if (!user) return error("Account not found.", 404);
      if (!verifyPassword(String(body.password || ""), user.passwordHash)) return error("Invalid password.", 401);
      if (user.status === "Pending") return error("Account pending admin approval.", 403);
      if (user.status === "Deactivated") return error("Account deactivated by system admin.", 403);
      return json(publicUser(user));
    }

    // --- SPACE INVADERS LEADERBOARD ---
    if (resource === "space-invaders") {
      if (method === "GET") {
        const rows = await db
          .select({
            userId: users.id,
            name: users.name,
            avatar: users.avatar,
            highScore: spaceInvadersScores.highScore,
            updatedAt: spaceInvadersScores.updatedAt,
          })
          .from(users)
          .leftJoin(spaceInvadersScores, eq(spaceInvadersScores.userId, users.id))
          .where(eq(users.status, "Approved"));
        const leaderboard = rows
          .map(row => ({ ...row, highScore: row.highScore || 0 }))
          .sort((a, b) => b.highScore - a.highScore || a.name.localeCompare(b.name));
        return json({ leaderboard });
      }

      if (method === "POST") {
        const userId = String(body.userId || "");
        const score = Number(body.score);
        if (!userId || !Number.isSafeInteger(score) || score < 0 || score > 10000000) {
          return error("A valid user and score are required.");
        }
        const [user] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), eq(users.status, "Approved")))
          .limit(1);
        if (!user) return error("Approved account not found.", 404);
        await db
          .insert(spaceInvadersScores)
          .values({ userId, highScore: score })
          .onConflictDoUpdate({
            target: spaceInvadersScores.userId,
            set: {
              highScore: sql`greatest(${spaceInvadersScores.highScore}, excluded.high_score)`,
              updatedAt: new Date(),
            },
          });
        return json({ ok: true });
      }
    }

    // --- USERS ---
    if (resource === "users") {
      if (method === "POST" && !id) {
        const { firstName, middleName, lastName, email, role, dept, headOfDept, password } = body;
        const title = String(body.title || "").trim();
        const employmentType = String(body.employmentType || "");
        if (!String(firstName || "").trim() || !String(lastName || "").trim() || !title || !email || !password ||
            !["Contract of Service", "Permanent"].includes(employmentType)) {
          return error("Please provide your first name, last name, position, employment type, email, and password.");
        }
        const existing = await db
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${String(email).toLowerCase().trim()}`);
        if (existing.length) return error("An account with this email already exists.", 409);
        const name = `${String(lastName).trim()}, ${String(firstName).trim()}${String(middleName || "").trim() ? ` ${String(middleName).trim()}` : ""}`;
        const [created] = await db
          .insert(users)
          .values({
            id: `emp-${Date.now()}`,
            name,
            firstName: String(firstName).trim(),
            middleName: String(middleName || "").trim() || null,
            lastName: String(lastName).trim(),
            email: String(email).trim(),
            role: role || "Employee",
            dept,
            headOfDept: headOfDept ?? null,
            title,
            employmentType,
            passwordHash: hashPassword(String(password)),
            status: "Pending",
          })
          .returning();
        return json(publicUser(created), 201);
      }

      if (id && method === "PUT") {
        const [user] = await db.select().from(users).where(eq(users.id, id));
        if (!user) return error("User not found.", 404);
        const employmentType = "employmentType" in body
          ? String(body.employmentType || "")
          : user.employmentType || "Contract of Service";
        if (!["Contract of Service", "Permanent"].includes(employmentType)) {
          return error("Select a valid employment type.");
        }

        if ("currentPassword" in body || "newPassword" in body) {
          const currentPassword = String(body.currentPassword || "");
          const newPassword = String(body.newPassword || "");
          if (!currentPassword || !newPassword) return error("Enter your current password and a new password.");
          if (newPassword.length !== 6) return error("New password must be exactly 6 characters.");
          if (!verifyPassword(currentPassword, user.passwordHash)) return error("Current password is incorrect.", 401);
        }

        const updates: Partial<typeof users.$inferInsert> = {};
        for (const key of ["email", "role", "dept", "headOfDept", "avatar", "signature", "status"] as const) {
          if (key in body) (updates as Record<string, unknown>)[key] = body[key];
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
        const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
        if (!updated) return error("User not found.", 404);
        return json(publicUser(updated));
      }

      if (id && method === "DELETE") {
        await db.delete(users).where(eq(users.id, id));
        return json({ ok: true });
      }
    }

    // --- REQUESTS ---
    if (resource === "requests") {
      if (method === "POST" && !id) {
        const values = pickRequest(body);
        if (!values.type || !values.applicantId) return error("Missing request type or applicant.");
        const [created] = await db
          .insert(requests)
          .values({
            ...values,
            id: await nextRequestId(),
            status: values.status || "Pending Dept Head Approval",
            hrApproval: values.hrApproval || "Pending",
          } as typeof requests.$inferInsert)
          .returning();
        if (created.attachmentId) {
          await db.update(attachments).set({ requestId: created.id }).where(eq(attachments.id, created.attachmentId));
        }
        const { createdAt, ...rest } = created;
        return json(rest, 201);
      }

      if (id && method === "PUT") {
        const [updated] = await db.update(requests).set(pickRequest(body)).where(eq(requests.id, id)).returning();
        if (!updated) return error("Request not found.", 404);
        const { createdAt, ...rest } = updated;
        return json(rest);
      }
    }

    // --- NOTIFICATIONS ---
    if (resource === "notifications") {
      if (method === "POST" && !id) {
        const { userId, requestId, title, message, date } = body;
        if (!userId || !title || !message) return error("Missing notification fields.");
        const [created] = await db
          .insert(notifications)
          .values({ id: `notif-${Date.now()}-${randomBytes(3).toString("hex")}`, userId, requestId: requestId ?? null, title, message, date, read: false })
          .returning();
        return json(created, 201);
      }

      // POST /api/notifications/<notificationId>/read
      if (id && action === "read" && method === "POST") {
        const userId = String(body.userId || "");
        if (!userId) return error("Missing notification owner.");
        const [updated] = await db
          .update(notifications)
          .set({ read: true })
          .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
          .returning({ id: notifications.id });
        if (!updated) return error("Notification not found.", 404);
        return json({ ok: true });
      }
    }

    // --- ARCHIVES ---
    if (resource === "archives" && method === "POST" && !id) {
      const { originalReqId, applicantId, recipientId, applicantName, type, section, status, archivedDate, reason } = body;
      if (!originalReqId || !applicantId) return error("Missing archive fields.");
      const [created] = await db
        .insert(archives)
        .values({
          id: `ARCH-${Date.now()}-${randomBytes(3).toString("hex")}`,
          originalReqId, applicantId, recipientId: recipientId ?? applicantId, applicantName, type, section, status, archivedDate, reason,
        })
        .returning();
      return json(created, 201);
    }

    return error("Not found.", 404);
  } catch (err) {
    console.error("API error:", err);
    if (err instanceof Error && err.message === SYSTEM_ADMIN_PASSWORD_REQUIRED) {
      return error(SYSTEM_ADMIN_PASSWORD_REQUIRED, 500);
    }
    return error("Server error. Please try again.", 500);
  }
};

export const config: Config = {
  path: "/api/*",
};
