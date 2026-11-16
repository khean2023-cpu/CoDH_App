ALTER TABLE "requests" ADD COLUMN "hr_approval" text;
--> statement-breakpoint
ALTER TABLE "archives" ADD COLUMN "recipient_id" text;
--> statement-breakpoint
UPDATE "requests"
SET "hr_approval" = 'Pending',
    "status" = 'Pending Human Resource Verification',
    "final_approval" = 'Pending'
WHERE "status" IN ('Pending Administrative Officer V Approval', 'Pending Chief of Hospital Approval')
  AND "dept_head_approval" = 'Approved';
