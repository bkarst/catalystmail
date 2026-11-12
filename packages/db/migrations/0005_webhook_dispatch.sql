ALTER TABLE "activities" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "activities_created_idx" ON "activities" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_unique" UNIQUE("endpoint_id","event_id");