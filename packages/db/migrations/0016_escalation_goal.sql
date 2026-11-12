ALTER TABLE "escalations" ADD COLUMN "goal_id" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "goal_p" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_goal_id_campaign_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."campaign_goals"("id") ON DELETE no action ON UPDATE no action;