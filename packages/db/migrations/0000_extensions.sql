-- Extensions the schema relies on (spec §4.2): case-insensitive text and trigram search.
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
