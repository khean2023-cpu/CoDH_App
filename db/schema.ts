import { pgTable, text, integer, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export type LeaveApplicationDetails = {
  formVariant?: "CSC" | "COS";
  position?: string;
  salary?: string;
  leaveType?: string;
  leaveTypeOther?: string;
  purpose?: string;
  relieverName?: string;
  relieverDesignation?: string;
  relieverTemporaryDesignation?: string;
  locationType?: string;
  destination?: string;
  sickTreatment?: string;
  illness?: string;
  studyPurposes?: string[];
  otherPurpose?: string;
  commutation?: string;
};

export const users = pgTable("users", {
  id: text().primaryKey(),
  name: text().notNull(),
  firstName: text("first_name"),
  middleName: text("middle_name"),
  lastName: text("last_name"),
  email: text().notNull().unique(),
  role: text().notNull().default("Employee"),
  dept: text(),
  headOfDept: text("head_of_dept"),
  title: text(),
  employmentType: text("employment_type").notNull().default("Contract of Service"),
  salary: text(),
  salaryHistory: jsonb("salary_history").$type<{
    id: string;
    adjustedAt: string;
    previousSalary: string | null;
    newSalary: string;
  }[]>().notNull().default([]),
  avatar: text(),
  signature: text(),
  passwordHash: text("password_hash").notNull(),
  status: text().notNull().default("Pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const requests = pgTable(
  "requests",
  {
    id: text().primaryKey(),
    type: text().notNull(),
    subType: text("sub_type"),
    section: text(),
    applicantId: text("applicant_id").notNull(),
    applicantName: text("applicant_name"),
    dateFiled: text("date_filed"),
    logDate: text("log_date"),
    timeIn: text("time_in"),
    timeOut: text("time_out"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    totalDays: integer("total_days"),
    leaveDetails: jsonb("leave_details").$type<LeaveApplicationDetails>(),
    extraOffDate: text("extra_off_date"),
    reason: text(),
    attachmentName: text("attachment_name"),
    attachmentId: text("attachment_id"),
    status: text().notNull(),
    deptHeadApproval: text("dept_head_approval"),
    hrApproval: text("hr_approval"),
    finalApproval: text("final_approval"),
    approvedBy: text("approved_by"),
    approvalDate: text("approval_date"),
    taggedUsers: jsonb("tagged_users").$type<string[]>().default([]),
    logs: jsonb().$type<{ date: string; action: string; user: string; signature?: string }[]>().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("requests_applicant_idx").on(t.applicantId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text().primaryKey(),
    userId: text("user_id").notNull(),
    requestId: text("request_id"),
    title: text().notNull(),
    message: text().notNull(),
    date: text(),
    read: boolean().notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("notifications_user_idx").on(t.userId)],
);

export const archives = pgTable("archives", {
  id: text().primaryKey(),
  originalReqId: text("original_req_id").notNull(),
  applicantId: text("applicant_id").notNull(),
  recipientId: text("recipient_id"),
  applicantName: text("applicant_name"),
  type: text(),
  section: text(),
  status: text(),
  archivedDate: text("archived_date"),
  reason: text(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Uploaded files (PNG/JPEG attachments). The file bytes live in Netlify Blobs under `blobKey`;
// this table records each upload and links it to its request.
export const attachments = pgTable(
  "attachments",
  {
    id: text().primaryKey(),
    requestId: text("request_id"),
    uploadedBy: text("uploaded_by"),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer().notNull(),
    blobKey: text("blob_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("attachments_request_idx").on(t.requestId)],
);

export const profileMedia = pgTable(
  "profile_media",
  {
    id: text().primaryKey(),
    userId: text("user_id").notNull(),
    mediaType: text("media_type").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer().notNull(),
    blobKey: text("blob_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("profile_media_user_idx").on(t.userId),
    index("profile_media_user_type_idx").on(t.userId, t.mediaType),
  ],
);

export const spaceInvadersScores = pgTable("space_invaders_scores", {
  userId: text("user_id").primaryKey(),
  highScore: integer("high_score").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
