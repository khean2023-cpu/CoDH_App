CREATE TABLE "cyber_dash_scores" (
  "user_id" text PRIMARY KEY NOT NULL,
  "high_score" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
