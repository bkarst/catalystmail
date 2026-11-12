ALTER TABLE "imports" ADD COLUMN "headers" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "processed_rows" integer DEFAULT 0 NOT NULL;