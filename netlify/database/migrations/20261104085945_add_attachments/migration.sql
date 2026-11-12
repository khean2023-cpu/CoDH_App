CREATE TABLE "attachments" (
	"id" text PRIMARY KEY,
	"request_id" text,
	"uploaded_by" text,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"blob_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "attachment_id" text;--> statement-breakpoint
CREATE INDEX "attachments_request_idx" ON "attachments" ("request_id");