CREATE TABLE "public_chat_presence" (
  "user_id" text PRIMARY KEY NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "public_chat_presence_last_seen_idx" ON "public_chat_presence" ("last_seen_at");
