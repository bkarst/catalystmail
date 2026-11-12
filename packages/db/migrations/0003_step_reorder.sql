ALTER TABLE "campaign_steps" DROP CONSTRAINT "campaign_steps_position_check";--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_position_check" CHECK (position >= 1);