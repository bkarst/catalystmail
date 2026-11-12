ALTER TABLE "sending_domains" ADD COLUMN "postmaster_credentials_enc" "bytea";--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "postmaster_credentials_key_version" integer;