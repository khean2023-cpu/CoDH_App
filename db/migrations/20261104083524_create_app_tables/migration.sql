CREATE TABLE "archives" (
	"id" text PRIMARY KEY,
	"original_req_id" text NOT NULL,
	"applicant_id" text NOT NULL,
	"applicant_name" text,
	"type" text,
	"section" text,
	"status" text,
	"archived_date" text,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"date" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY,
	"type" text NOT NULL,
	"sub_type" text,
	"section" text,
	"applicant_id" text NOT NULL,
	"applicant_name" text,
	"date_filed" text,
	"log_date" text,
	"time_in" text,
	"time_out" text,
	"start_date" text,
	"end_date" text,
	"total_days" integer,
	"extra_off_date" text,
	"reason" text,
	"attachment_name" text,
	"status" text NOT NULL,
	"dept_head_approval" text,
	"final_approval" text,
	"approved_by" text,
	"approval_date" text,
	"tagged_users" jsonb DEFAULT '[]',
	"logs" jsonb DEFAULT '[]',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"role" text DEFAULT 'Employee' NOT NULL,
	"dept" text,
	"head_of_dept" text,
	"title" text,
	"avatar" text,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id");--> statement-breakpoint
CREATE INDEX "requests_applicant_idx" ON "requests" ("applicant_id");