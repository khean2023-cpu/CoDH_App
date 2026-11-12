import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const dataFile = resolve(root, "local-demo-data.json");
const maxUploadBytes = 4 * 1024 * 1024;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isJpeg = bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

const initialState = () => ({
  users: [
    { id: "emp-admin", name: "Demo Admin", email: "admin@codh.local", role: "Admin", dept: "System Administration", title: "System Administrator", avatar: "", password: "123456", status: "Approved" },
    { id: "emp-101", name: "Juan Cruz", email: "juan.cruz@company.com", role: "Employee", dept: "Medical Section", title: "Senior Medical Specialist", avatar: "", password: "password123", status: "Approved" },
    { id: "mgr-201", name: "Alex Reyes", email: "alex.reyes@company.com", role: "Department Head", dept: "Medical Section", headOfDept: "Medical Section", title: "Chief Medical Supervisor", avatar: "", password: "password123", status: "Approved" },
    { id: "hr-301", name: "Morgan Santos", email: "hr@hospital.gov", role: "Human Resource", dept: "Human Resource Department", title: "Human Resource Officer", avatar: "", password: "password123", status: "Approved" },
    { id: "admin-off-5", name: "Atty. Clara Vance", email: "clara.vance@hospital.gov", role: "Administrative Officer V", dept: "Administrative Section", title: "Administrative Officer V", avatar: "", password: "password123", status: "Approved" },
    { id: "chief-hosp", name: "Dr. Roberto Mendoza", email: "roberto.mendoza@hospital.gov", role: "Chief of Hospital", dept: "Executive Office", title: "Chief of Hospital", avatar: "", password: "password123", status: "Approved" },
  ],
  requests: [],
  notifications: [],
  archives: [],
  spaceInvadersScores: [],
  attachments: {},
  profileMedia: {},
});

const state = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, "utf8")) : initialState();
state.profileMedia ||= {};
state.spaceInvadersScores ||= [];
const saveState = () => writeFileSync(dataFile, JSON.stringify(state, null, 2));
let migratedState = false;
for (const user of state.users) {
  if (!user.employmentType) {
    user.employmentType = "Contract of Service";
    migratedState = true;
  }
  if (!Array.isArray(user.salaryHistory)) {
    user.salaryHistory = [];
    migratedState = true;
  }
}
if (!state.users.some(user => user.role === "Human Resource")) {
  state.users.push({
    id: "hr-301",
    name: "Morgan Santos",
    email: "hr@hospital.gov",
    role: "Human Resource",
    dept: "Human Resource Department",
    title: "Human Resource Officer",
    avatar: "",
    employmentType: "Contract of Service",
    salary: null,
    salaryHistory: [],
    password: "password123",
    status: "Approved",
  });
  migratedState = true;
}
for (const request of state.requests) {
  if (["Pending Administrative Officer V Approval", "Pending Chief of Hospital Approval"].includes(request.status) &&
      request.deptHeadApproval === "Approved") {
    request.status = "Pending Human Resource Verification";
    request.hrApproval = "Pending";
    request.finalApproval = "Pending";
    migratedState = true;
  } else if (!("hrApproval" in request) && request.status === "Pending Dept Head Approval") {
    request.hrApproval = "Pending";
    migratedState = true;
  }
}
if (migratedState) saveState();
const json = (res, body, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};
const fail = (res, message, status = 400) => json(res, { error: message }, status);
const publicUser = ({ password, ...user }) => user;
const readBody = (req, limit = 1024 * 1024) => new Promise((resolveBody, reject) => {
  const chunks = [];
  let length = 0;
  req.on("data", chunk => {
    length += chunk.length;
    if (length > limit) {
      reject(new Error("Request body is too large."));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => resolveBody(Buffer.concat(chunks)));
  req.on("error", reject);
});

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] === "api") {
      const [, resource, id, action] = parts;

      if (resource === "profile-media" && req.method === "POST" && id && ["avatar", "signature"].includes(action)) {
        const user = state.users.find(item => item.id === id);
        if (!user) return fail(res, "User not found.", 404);
        const bytes = await readBody(req, maxUploadBytes);
        const encodedName = req.headers["x-file-name"] || "profile-image.png";
        const fileName = decodeURIComponent(String(encodedName)).slice(0, 200);
        if (!bytes.length) return fail(res, "The uploaded file is empty.");
        if (bytes.length > maxUploadBytes) return fail(res, "File is too large. Maximum size is 4 MB.", 413);
        const contentType = bytes.subarray(0, pngSignature.length).equals(pngSignature) && /\.png$/i.test(fileName)
          ? "image/png"
          : isJpeg(bytes) && /\.(jpe?g)$/i.test(fileName)
            ? "image/jpeg"
            : null;
        if (!contentType) return fail(res, "Only valid .png, .jpg, or .jpeg images are allowed.", 415);
        const mediaId = `MEDIA-${Date.now()}-${randomBytes(4).toString("hex")}`;
        state.profileMedia[mediaId] = {
          userId: id,
          mediaType: action,
          fileName,
          contentType,
          size: bytes.length,
          bytes: bytes.toString("base64"),
        };
        saveState();
        return json(res, {
          id: mediaId,
          fileName,
          url: `/api/profile-media/${encodeURIComponent(mediaId)}`,
        }, 201);
      }

      if (resource === "profile-media" && id && req.method === "GET") {
        const media = state.profileMedia[id];
        if (!media) return fail(res, "Profile image not found.", 404);
        res.writeHead(200, {
          "Content-Type": media.contentType,
          "Content-Disposition": `inline; filename="${media.fileName.replace(/["\\\r\n]/g, "")}"`,
          "X-Content-Type-Options": "nosniff",
        });
        return res.end(Buffer.from(media.bytes, "base64"));
      }

      if (resource === "attachments" && req.method === "POST" && !id) {
        const bytes = await readBody(req, maxUploadBytes);
        const encodedName = req.headers["x-file-name"] || "attachment.png";
        const fileName = decodeURIComponent(String(encodedName)).slice(0, 200);
        if (!bytes.length) return fail(res, "The uploaded file is empty.");
        if (bytes.length > maxUploadBytes) return fail(res, "File is too large. Maximum size is 4 MB.", 413);
        const contentType = bytes.subarray(0, pngSignature.length).equals(pngSignature) && /\.png$/i.test(fileName)
          ? "image/png"
          : isJpeg(bytes) && /\.(jpe?g)$/i.test(fileName)
            ? "image/jpeg"
            : null;
        if (!contentType) return fail(res, "Only valid .png, .jpg, or .jpeg images are allowed.", 415);
        const attachmentId = `ATT-${Date.now()}-${randomBytes(4).toString("hex")}`;
        state.attachments[attachmentId] = {
          fileName,
          contentType,
          uploadedBy: req.headers["x-uploaded-by"] || null,
          bytes: bytes.toString("base64"),
        };
        saveState();
        return json(res, { id: attachmentId, fileName }, 201);
      }

      if (resource === "attachments" && id && req.method === "GET") {
        const attachment = state.attachments[id];
        if (!attachment) return fail(res, "Attachment not found.", 404);
        res.writeHead(200, {
          "Content-Type": attachment.contentType || (/\.(jpe?g)$/i.test(attachment.fileName) ? "image/jpeg" : "image/png"),
          "Content-Disposition": `inline; filename="${attachment.fileName.replace(/["\\\r\n]/g, "")}"`,
          "X-Content-Type-Options": "nosniff",
        });
        return res.end(Buffer.from(attachment.bytes, "base64"));
      }

      if (resource === "data" && req.method === "GET") {
        const humanResourceDepartmentHeads = state.users.filter(user =>
          user.role === "Department Head" &&
          (user.headOfDept || user.dept) === "Human Resource Department" &&
          user.status === "Approved",
        );
        const humanResourceUsers = humanResourceDepartmentHeads.length
          ? humanResourceDepartmentHeads
          : state.users.filter(user => user.role === "Human Resource" && user.status === "Approved");
        const pendingHrRequests = state.requests.filter(request =>
          request.status === "Pending Human Resource Verification" && (request.hrApproval || "Pending") === "Pending",
        );
        const existingHrNotifications = new Set(
          state.notifications
            .filter(notification => notification.title === "Verification required: Human Resource" && notification.requestId)
            .map(notification => `${notification.userId}:${notification.requestId}`),
        );
        let addedHrNotifications = false;
        for (const request of pendingHrRequests) {
          for (const user of humanResourceUsers) {
            const notificationKey = `${user.id}:${request.id}`;
            if (existingHrNotifications.has(notificationKey)) continue;
            state.notifications.unshift({
              id: `notif-${Date.now()}-${randomBytes(3).toString("hex")}`,
              userId: user.id,
              requestId: request.id,
              title: "Verification required: Human Resource",
              message: `Request ${request.id} is awaiting Human Resource verification.`,
              date: request.approvalDate || request.dateFiled || new Date().toLocaleString(),
              read: false,
            });
            existingHrNotifications.add(notificationKey);
            addedHrNotifications = true;
          }
        }
        if (addedHrNotifications) saveState();
        const finalizedRequests = state.requests.filter(request => ["Approved", "Rejected"].includes(request.status));
        const existingHrCopies = new Set(
          state.archives
            .filter(archive => archive.recipientId)
            .map(archive => `${archive.originalReqId}:${archive.recipientId}`),
        );
        for (const request of finalizedRequests) {
          for (const user of humanResourceUsers) {
            const copyKey = `${request.id}:${user.id}`;
            if (existingHrCopies.has(copyKey)) continue;
            state.archives.unshift({
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
            });
            existingHrCopies.add(copyKey);
            migratedState = true;
          }
        }
        if (migratedState) {
          saveState();
          migratedState = false;
        }
        return json(res, {
          users: state.users.map(publicUser),
          requests: state.requests,
          notifications: state.notifications,
          archives: state.archives,
        });
      }

      if (resource === "login" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const user = state.users.find(item => item.email.toLowerCase() === String(body.email || "").toLowerCase().trim());
        if (!user) return fail(res, "Account not found.", 404);
        const supplied = Buffer.from(String(body.password || ""));
        const expected = Buffer.from(user.password);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return fail(res, "Invalid password.", 401);
        if (user.status === "Pending") return fail(res, "Account pending admin approval.", 403);
        if (user.status === "Deactivated") return fail(res, "Account deactivated by system admin.", 403);
        return json(res, publicUser(user));
      }

      if (resource === "space-invaders" && req.method === "GET") {
        const leaderboard = state.users
          .filter(user => user.status === "Approved")
          .map(user => {
            const score = state.spaceInvadersScores.find(item => item.userId === user.id);
            return {
              userId: user.id,
              name: user.name,
              avatar: user.avatar || "",
              highScore: score?.highScore || 0,
              updatedAt: score?.updatedAt || null,
            };
          })
          .sort((a, b) => b.highScore - a.highScore || a.name.localeCompare(b.name));
        return json(res, { leaderboard });
      }

      if (resource === "space-invaders" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const userId = String(body.userId || "");
        const score = Number(body.score);
        if (!userId || !Number.isSafeInteger(score) || score < 0 || score > 10000000) {
          return fail(res, "A valid user and score are required.");
        }
        const user = state.users.find(item => item.id === userId && item.status === "Approved");
        if (!user) return fail(res, "Approved account not found.", 404);
        const existing = state.spaceInvadersScores.find(item => item.userId === userId);
        if (existing) {
          if (score > existing.highScore) {
            existing.highScore = score;
            existing.updatedAt = new Date().toISOString();
          }
        } else {
          state.spaceInvadersScores.push({ userId, highScore: score, updatedAt: new Date().toISOString() });
        }
        saveState();
        return json(res, { ok: true });
      }

      if (resource === "users" && req.method === "POST" && !id) {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const firstName = String(body.firstName || "").trim();
        const middleName = String(body.middleName || "").trim();
        const lastName = String(body.lastName || "").trim();
        const title = String(body.title || "").trim();
        if (!firstName || !lastName || !title || !body.email || !body.password ||
            !["Contract of Service", "Permanent"].includes(body.employmentType)) {
          return fail(res, "Please provide your first name, last name, position, employment type, email, and password.");
        }
        if (state.users.some(user => user.email.toLowerCase() === String(body.email).toLowerCase().trim())) {
          return fail(res, "An account with this email already exists.", 409);
        }
        const created = {
          id: `emp-${Date.now()}`,
          name: `${lastName}, ${firstName}${middleName ? ` ${middleName}` : ""}`,
          firstName,
          middleName: middleName || null,
          lastName,
          email: String(body.email).trim(),
          role: body.role || "Employee",
          dept: body.dept || null,
          headOfDept: body.headOfDept || null,
          title,
          employmentType: body.employmentType,
          salary: null,
          salaryHistory: [],
          avatar: "",
          password: String(body.password),
          status: "Pending",
        };
        state.users.push(created);
        saveState();
        return json(res, publicUser(created), 201);
      }

      if (resource === "users" && id && req.method === "PUT") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const user = state.users.find(item => item.id === id);
        if (!user) return fail(res, "User not found.", 404);

        const employmentType = "employmentType" in body
          ? String(body.employmentType || "")
          : user.employmentType || "Contract of Service";
        if (!["Contract of Service", "Permanent"].includes(employmentType)) {
          return fail(res, "Select a valid employment type.");
        }
        const salary = String(body.salary || "").trim();
        if (employmentType === "Permanent" && salary && !/^\d+(?:\.\d{1,2})?$/.test(salary)) {
          return fail(res, "Salary must be a non-negative amount with up to two decimal places.");
        }
        if (employmentType !== "Permanent" &&
            (("salary" in body && body.salary !== "") || ("title" in body && body.title))) {
          return fail(res, "Position and salary can only be updated for permanent accounts.");
        }
        const hasNameFields = ["firstName", "middleName", "lastName"].some(key => key in body);
        const firstName = hasNameFields ? String(body.firstName ?? user.firstName ?? "").trim() : "";
        const middleName = hasNameFields ? String(body.middleName ?? user.middleName ?? "").trim() : "";
        const lastName = hasNameFields ? String(body.lastName ?? user.lastName ?? "").trim() : "";
        if (hasNameFields && (!firstName || !lastName)) {
          return fail(res, "First name and last name are required.");
        }

        if ("currentPassword" in body || "newPassword" in body) {
          if (!body.currentPassword || !body.newPassword) return fail(res, "Enter your current password and a new password.");
          if (String(body.newPassword).length !== 6) return fail(res, "New password must be exactly 6 characters.");
          const supplied = Buffer.from(String(body.currentPassword));
          const expected = Buffer.from(user.password);
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            return fail(res, "Current password is incorrect.", 401);
          }
          user.password = String(body.newPassword);
        }

        if (body.email && state.users.some(item => item.id !== id && item.email.toLowerCase() === String(body.email).toLowerCase().trim())) {
          return fail(res, "An account with this email already exists.", 409);
        }
        for (const key of ["email", "role", "dept", "headOfDept", "avatar", "signature", "status"]) {
          if (key in body) user[key] = body[key];
        }
        if (hasNameFields) {
          user.firstName = firstName;
          user.middleName = middleName || null;
          user.lastName = lastName;
          user.name = `${lastName}, ${firstName}${middleName ? ` ${middleName}` : ""}`;
        } else if ("name" in body) {
          user.name = String(body.name);
        }
        user.employmentType = employmentType;
        if (employmentType === "Permanent") {
          if ("title" in body) user.title = body.title;
          if ("salary" in body) {
            if (salary && salary !== user.salary) {
              user.salaryHistory ||= [];
              user.salaryHistory.push({
                id: `SAL-${Date.now()}-${randomBytes(3).toString("hex")}`,
                adjustedAt: new Date().toISOString(),
                previousSalary: user.salary || null,
                newSalary: salary,
              });
              user.salary = salary;
            }
          }
        }
        if (body.password) user.password = body.password;
        saveState();
        return json(res, publicUser(user));
      }

      if (resource === "users" && id && req.method === "DELETE") {
        state.users = state.users.filter(user => user.id !== id);
        saveState();
        return json(res, { ok: true });
      }

      if (resource === "requests" && req.method === "POST" && !id) {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        if (!body.type || !body.applicantId) return fail(res, "Missing request type or applicant.");
        const created = {
          ...body,
          hrApproval: body.hrApproval || "Pending",
          id: `REQ-${new Date().getFullYear()}-${Date.now()}`,
        };
        state.requests.unshift(created);
        saveState();
        return json(res, created, 201);
      }

      if (resource === "requests" && id && req.method === "PUT") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const index = state.requests.findIndex(request => request.id === id);
        if (index < 0) return fail(res, "Request not found.", 404);
        state.requests[index] = { ...state.requests[index], ...body, id };
        saveState();
        return json(res, state.requests[index]);
      }

      if (resource === "notifications" && req.method === "POST" && !id) {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        if (!body.userId || !body.title || !body.message) return fail(res, "Missing notification fields.");
        const created = { ...body, id: `notif-${Date.now()}`, read: false };
        state.notifications.unshift(created);
        saveState();
        return json(res, created, 201);
      }

      if (resource === "notifications" && id && action === "read" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const notification = state.notifications.find(item => item.id === id && item.userId === body.userId);
        if (!notification) return fail(res, "Notification not found.", 404);
        notification.read = true;
        saveState();
        return json(res, { ok: true });
      }

      if (resource === "archives" && req.method === "POST" && !id) {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        if (!body.originalReqId || !body.applicantId) return fail(res, "Missing archive fields.");
        const created = { ...body, id: `ARCH-${Date.now()}` };
        state.archives.unshift(created);
        saveState();
        return json(res, created, 201);
      }

      return fail(res, "Not found.", 404);
    }

    const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = resolve(root, `.${requestedPath}`);
    if (filePath !== root && !filePath.startsWith(root + sep)) return fail(res, "Not found.", 404);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".webmanifest": "application/manifest+json",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
    };
    const contents = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    res.end(contents);
  } catch (error) {
    if (!res.headersSent) fail(res, error.message || "Local demo server error.", error.message?.includes("too large") ? 413 : 500);
    else res.destroy();
    console.error("Local demo server error:", error);
  }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, "127.0.0.1", () => {
  console.log(`CoDH local demo is running at http://127.0.0.1:${port}`);
  console.log("Demo admin: admin@codh.local / 123456");
  console.log("Data is local to this computer and saved in local-demo-data.json.");
});
