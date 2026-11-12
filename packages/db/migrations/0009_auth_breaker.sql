ALTER TABLE "sending_domains" ADD COLUMN "first_touches_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "first_touches_paused_reason" text;