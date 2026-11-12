ALTER TABLE "users" ADD COLUMN "first_name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "middle_name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "employment_type" text DEFAULT 'Contract of Service' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "salary" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "salary_history" jsonb DEFAULT '[]'::jsonb NOT NULL;
