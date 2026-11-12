CREATE TYPE "public"."actor_type" AS ENUM('system', 'ai', 'user', 'api_key', 'contact', 'integration');--> statement-breakpoint
CREATE TYPE "public"."agent_mode" AS ENUM('built_in', 'external');--> statement-breakpoint
CREATE TYPE "public"."autonomy_level" AS ENUM('manual', 'assisted', 'autonomous');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."consent_basis" AS ENUM('legitimate_interest', 'consent', 'existing_relationship', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."email_verification" AS ENUM('unverified', 'valid', 'risky', 'catch_all', 'invalid', 'bounced');--> statement-breakpoint
CREATE TYPE "public"."escalation_priority" AS ENUM('urgent', 'high', 'normal');--> statement-breakpoint
CREATE TYPE "public"."escalation_reason" AS ENUM('knowledge_gap', 'pricing_negotiation', 'legal_or_compliance', 'human_requested', 'identity_question', 'complaint', 'high_value', 'meeting_logistics', 'attachment_received', 'new_participant', 'referral', 'goal_confirmation', 'low_confidence', 'guardrail_failed', 'suspicious_content', 'reply_limit', 'reopened', 'ai_unavailable', 'send_failure', 'unmatched_reply', 'went_quiet', 'custom_rule');--> statement-breakpoint
CREATE TYPE "public"."escalation_status" AS ENUM('open', 'snoozed', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."goal_method" AS ENUM('ai', 'external_event', 'link_click', 'manual', 'implied');--> statement-breakpoint
CREATE TYPE "public"."inbound_kind" AS ENUM('human_reply', 'auto_reply', 'out_of_office', 'bounce_hard', 'bounce_soft', 'unsubscribe_request', 'complaint', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_stage" AS ENUM('lead', 'prospect', 'engaged', 'opportunity', 'customer', 'churned', 'disqualified');--> statement-breakpoint
CREATE TYPE "public"."mailbox_auth" AS ENUM('password', 'oauth2_google', 'oauth2_microsoft');--> statement-breakpoint
CREATE TYPE "public"."mailbox_status" AS ENUM('pending', 'active', 'paused', 'error');--> statement-breakpoint
CREATE TYPE "public"."match_method" AS ENUM('headers', 'subject_sender', 'sender_fallback', 'dsn_original', 'manual');--> statement-breakpoint
CREATE TYPE "public"."message_author" AS ENUM('template', 'ai', 'human_app', 'human_external', 'contact', 'third_party', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('draft', 'pending_approval', 'scheduled', 'sending', 'sent', 'bounced', 'failed', 'cancelled', 'superseded', 'send_unknown', 'received');--> statement-breakpoint
CREATE TYPE "public"."next_action_type" AS ENUM('none', 'send_initial', 'send_reply', 'send_follow_up', 'await_reply');--> statement-breakpoint
CREATE TYPE "public"."open_status" AS ENUM('not_tracked', 'unopened', 'machine_only', 'opened');--> statement-breakpoint
CREATE TYPE "public"."sequence_finish" AS ENUM('exhaust', 'notify_owner', 'close_lost', 'keep_waiting');--> statement-breakpoint
CREATE TYPE "public"."step_mode" AS ENUM('template', 'ai_opening_line', 'ai_adapt', 'ai_write');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('subscribed', 'unsubscribed', 'complained');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('unsubscribed', 'hard_bounce', 'complaint', 'manual', 'do_not_contact', 'erased');--> statement-breakpoint
CREATE TYPE "public"."thread_stage" AS ENUM('queued', 'sent', 'received', 'responded', 'goal_achieved');--> statement-breakpoint
CREATE TYPE "public"."thread_state" AS ENUM('active', 'pending_approval', 'needs_human', 'paused', 'completed', 'exhausted', 'closed_lost', 'bounced', 'unsubscribed', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."tracking_source" AS ENUM('human', 'privacy_proxy', 'security_scanner', 'sender_self', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."tracking_type" AS ENUM('open', 'click');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."wait_unit" AS ENUM('hours', 'days', 'business_days');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" "bytea" NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by" text,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"timezone" text,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"physical_address" text NOT NULL,
	"default_timezone" text DEFAULT 'UTC' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" "citext",
	"website" text,
	"industry" text,
	"employee_range" text,
	"country" text,
	"notes" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"contact_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "contact_tags_contact_id_tag_id_pk" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" "citext" NOT NULL,
	"first_name" text,
	"last_name" text,
	"title" text,
	"phone" text,
	"linkedin_url" text,
	"company_id" text,
	"city" text,
	"country" text,
	"timezone" text,
	"lifecycle_stage" "lifecycle_stage" DEFAULT 'lead' NOT NULL,
	"owner_user_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_detail" text,
	"email_verification" "email_verification" DEFAULT 'unverified' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"email_flags" text[] DEFAULT '{}' NOT NULL,
	"subscription_status" "subscription_status" DEFAULT 'subscribed' NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"consent_basis" "consent_basis" DEFAULT 'unknown' NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"last_contacted_at" timestamp with time zone,
	"last_replied_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(first_name,'')||' '||coalesce(last_name,'')||' '||email||' '||coalesce(title,''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "custom_field_defs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb,
	"required" boolean DEFAULT false NOT NULL,
	CONSTRAINT "custom_field_defs_workspace_id_entity_key_unique" UNIQUE("workspace_id","entity","key"),
	CONSTRAINT "custom_field_defs_entity_check" CHECK (entity in ('contact','company')),
	CONSTRAINT "custom_field_defs_type_check" CHECK (type in ('text','number','date','boolean','select','url'))
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"mapping" jsonb,
	"dedupe_strategy" text DEFAULT 'skip' NOT NULL,
	"target_list_id" text,
	"tag_ids" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"total_rows" integer,
	"created_count" integer DEFAULT 0,
	"updated_count" integer DEFAULT 0,
	"skipped_count" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "list_members" (
	"list_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_members_list_id_contact_id_pk" PRIMARY KEY("list_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"filter" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lists_kind_check" CHECK (kind in ('static','dynamic'))
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" "citext",
	"email_hash" "bytea",
	"domain" "citext",
	"reason" "suppression_reason" NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppressions_target_check" CHECK (email is not null or email_hash is not null or domain is not null)
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	CONSTRAINT "tags_workspace_id_name_unique" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
CREATE TABLE "capacity_plans" (
	"day" date NOT NULL,
	"mailbox_id" text NOT NULL,
	"bucket" text NOT NULL,
	"kind" text NOT NULL,
	"allocated" integer NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"limited_by" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_plans_day_mailbox_id_bucket_kind_pk" PRIMARY KEY("day","mailbox_id","bucket","kind"),
	CONSTRAINT "capacity_plans_kind_check" CHECK (kind in ('allocation','forecast'))
);
--> statement-breakpoint
CREATE TABLE "domain_daily_stats" (
	"domain_id" text NOT NULL,
	"day" date NOT NULL,
	"planned_cap" integer NOT NULL,
	"sent" integer DEFAULT 0,
	"replies_sent" integer DEFAULT 0,
	"bounced_hard" integer DEFAULT 0,
	"complaints" integer DEFAULT 0,
	"opens_human" integer DEFAULT 0,
	"junk_replies" integer DEFAULT 0,
	"reputation_score" smallint,
	"reputation_band" text,
	"ramp_step" smallint,
	"ramp_action" text,
	"counted_as_sending_day" boolean DEFAULT false NOT NULL,
	CONSTRAINT "domain_daily_stats_domain_id_day_pk" PRIMARY KEY("domain_id","day")
);
--> statement-breakpoint
CREATE TABLE "mailbox_daily_stats" (
	"mailbox_id" text NOT NULL,
	"day" date NOT NULL,
	"sent" integer DEFAULT 0,
	"new_threads" integer DEFAULT 0,
	"replies_sent" integer DEFAULT 0,
	"bounced_hard" integer DEFAULT 0,
	"bounced_soft" integer DEFAULT 0,
	"complaints" integer DEFAULT 0,
	"inbound_replies" integer DEFAULT 0,
	"opens_human" integer DEFAULT 0,
	"unsubscribes" integer DEFAULT 0,
	CONSTRAINT "mailbox_daily_stats_mailbox_id_day_pk" PRIMARY KEY("mailbox_id","day")
);
--> statement-breakpoint
CREATE TABLE "mailbox_sync_state" (
	"mailbox_id" text NOT NULL,
	"folder" text NOT NULL,
	"uid_validity" bigint NOT NULL,
	"last_seen_uid" bigint DEFAULT 0 NOT NULL,
	"highest_modseq" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailbox_sync_state_mailbox_id_folder_pk" PRIMARY KEY("mailbox_id","folder")
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sending_domain_id" text NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text NOT NULL,
	"signature_text" text,
	"signature_html" text,
	"owner_user_id" text,
	"auth" "mailbox_auth" NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer NOT NULL,
	"smtp_secure" text NOT NULL,
	"smtp_username" text NOT NULL,
	"imap_host" text NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"imap_username" text NOT NULL,
	"credentials_enc" "bytea" NOT NULL,
	"credentials_key_version" integer NOT NULL,
	"folders" jsonb NOT NULL,
	"append_to_sent" boolean DEFAULT false NOT NULL,
	"catalyst_dkim" jsonb,
	"status" "mailbox_status" DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"daily_limit" integer DEFAULT 40 NOT NULL,
	"hourly_limit" integer DEFAULT 12 NOT NULL,
	"min_interval_sec" integer DEFAULT 120 NOT NULL,
	"max_interval_sec" integer DEFAULT 420 NOT NULL,
	"warmup_enabled" boolean DEFAULT true NOT NULL,
	"warmup_started_at" date,
	"warmup_step" smallint DEFAULT 0 NOT NULL,
	"warmup_start_volume" integer DEFAULT 10 NOT NULL,
	"warmup_daily_increment" integer DEFAULT 5 NOT NULL,
	"health_score" smallint DEFAULT 100 NOT NULL,
	"health_band" text DEFAULT 'healthy' NOT NULL,
	"health_inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_poll_at" timestamp with time zone,
	"last_poll_status" text,
	"next_poll_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailboxes_workspace_id_email_unique" UNIQUE("workspace_id","email"),
	CONSTRAINT "mailboxes_smtp_secure_check" CHECK (smtp_secure in ('tls','starttls')),
	CONSTRAINT "mailboxes_daily_limit_check" CHECK (daily_limit between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "poll_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"mailbox_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"fetched_count" integer DEFAULT 0,
	"matched_count" integer DEFAULT 0,
	"ignored_count" integer DEFAULT 0,
	"error" text,
	CONSTRAINT "poll_runs_trigger_check" CHECK (trigger in ('schedule','manual','api','catch_up'))
);
--> statement-breakpoint
CREATE TABLE "sending_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"domain" "citext" NOT NULL,
	"tracking_host" "citext",
	"spf_status" text,
	"dkim_status" text,
	"dkim_selectors" text[] DEFAULT '{}' NOT NULL,
	"dmarc_status" text,
	"dmarc_policy" text,
	"mx_status" text,
	"tracking_status" text,
	"alignment_status" text,
	"blocklisted" boolean DEFAULT false NOT NULL,
	"blocklist_details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reputation_score" smallint DEFAULT 100 NOT NULL,
	"reputation_band" text DEFAULT 'healthy' NOT NULL,
	"reputation_inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"band_changed_at" timestamp with time zone,
	"postmaster_connected" boolean DEFAULT false NOT NULL,
	"postmaster_data" jsonb,
	"ramp_plan" text DEFAULT 'new_domain' NOT NULL,
	"ramp_custom_schedule" jsonb,
	"ramp_step" smallint DEFAULT 0 NOT NULL,
	"ramp_status" text DEFAULT 'ramping' NOT NULL,
	"ramp_status_reason" text,
	"ramp_manual_hold" boolean DEFAULT false NOT NULL,
	"last_sending_day" date,
	"cap_override" integer,
	"cap_override_until" date,
	"cap_override_reason" text,
	"cap_override_by" text,
	"check_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sending_domains_workspace_id_domain_unique" UNIQUE("workspace_id","domain"),
	CONSTRAINT "sending_domains_ramp_plan_check" CHECK (ramp_plan in ('new_domain','aged_domain','established','custom'))
);
--> statement-breakpoint
CREATE TABLE "campaign_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"position" smallint NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"success_criteria" text NOT NULL,
	"detection_methods" "goal_method"[] DEFAULT '{ai,manual}' NOT NULL,
	"external_event_match" jsonb,
	"tracked_link_key" text,
	"click_counts_as_achieved" boolean DEFAULT false NOT NULL,
	"auto_confirm" boolean DEFAULT true NOT NULL,
	"playbook" text NOT NULL,
	"lifecycle_stage_on_achieve" "lifecycle_stage",
	"marks_customer" boolean DEFAULT false NOT NULL,
	"value_cents" bigint,
	CONSTRAINT "campaign_goals_campaign_id_position_unique" UNIQUE("campaign_id","position"),
	CONSTRAINT "campaign_goals_campaign_id_key_unique" UNIQUE("campaign_id","key"),
	CONSTRAINT "campaign_goals_position_check" CHECK (position >= 1)
);
--> statement-breakpoint
CREATE TABLE "campaign_mailboxes" (
	"campaign_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "campaign_mailboxes_campaign_id_mailbox_id_pk" PRIMARY KEY("campaign_id","mailbox_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_step_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"step_id" text NOT NULL,
	"label" text DEFAULT 'A' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"subject_template" text,
	"body_template" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"sequence_id" text,
	"position" smallint NOT NULL,
	"wait_amount" smallint DEFAULT 0 NOT NULL,
	"wait_unit" "wait_unit" DEFAULT 'business_days' NOT NULL,
	"wait_from" text DEFAULT 'last_message' NOT NULL,
	"send_as_reply" boolean DEFAULT true NOT NULL,
	"mode" "step_mode" DEFAULT 'template' NOT NULL,
	"ai_guidance" text,
	"include_tracking" boolean,
	CONSTRAINT "campaign_steps_campaign_id_sequence_id_position_unique" UNIQUE NULLS NOT DISTINCT("campaign_id","sequence_id","position"),
	CONSTRAINT "campaign_steps_wait_from_check" CHECK (wait_from in ('last_message','goal_event')),
	CONSTRAINT "campaign_steps_position_check" CHECK (position between 1 and 6),
	CONSTRAINT "campaign_steps_initial_email_check" CHECK (sequence_id is not null or (position = 1 and wait_amount = 0 and mode <> 'ai_adapt'))
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"objective" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"owner_user_id" text,
	"autonomy" "autonomy_level" DEFAULT 'assisted' NOT NULL,
	"agent_mode" "agent_mode" DEFAULT 'built_in' NOT NULL,
	"persona" jsonb NOT NULL,
	"agent_instructions" text,
	"sending_window" jsonb NOT NULL,
	"blackout_dates" date[] DEFAULT '{}' NOT NULL,
	"daily_new_threads_limit" integer DEFAULT 30 NOT NULL,
	"sending_priority" text DEFAULT 'normal' NOT NULL,
	"final_wait_business_days" integer DEFAULT 5 NOT NULL,
	"open_tracking" boolean DEFAULT true NOT NULL,
	"track_first_touch" boolean DEFAULT true NOT NULL,
	"click_tracking" boolean DEFAULT false NOT NULL,
	"list_unsubscribe_header" boolean DEFAULT true NOT NULL,
	"unsubscribe_footer" boolean DEFAULT true NOT NULL,
	"delivery_grace_minutes" integer DEFAULT 240 NOT NULL,
	"reply_delay_min_minutes" integer DEFAULT 8 NOT NULL,
	"reply_delay_max_minutes" integer DEFAULT 45 NOT NULL,
	"auto_send_min_confidence" numeric(4, 3) DEFAULT '0.800' NOT NULL,
	"goal_auto_confirm_threshold" numeric(4, 3) DEFAULT '0.850' NOT NULL,
	"max_ai_replies_per_thread" integer DEFAULT 6 NOT NULL,
	"pause_on_manual_reply" boolean DEFAULT true NOT NULL,
	"on_not_interested" text DEFAULT 'close_silently' NOT NULL,
	"review_first_n_personalized" integer DEFAULT 10 NOT NULL,
	"enrollment_rules" jsonb DEFAULT '{"skip_active_elsewhere":true,"cooldown_days":30,"allow_role_accounts":false,"allow_risky":false}'::jsonb NOT NULL,
	"escalation_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"launched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "campaigns_sending_priority_check" CHECK (sending_priority in ('high','normal','low')),
	CONSTRAINT "campaigns_on_not_interested_check" CHECK (on_not_interested in ('close_silently','send_polite_close'))
);
--> statement-breakpoint
CREATE TABLE "follow_up_sequences" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"stages" text[] NOT NULL,
	"finish" "sequence_finish" DEFAULT 'exhaust' NOT NULL,
	"final_wait_amount" smallint DEFAULT 5 NOT NULL,
	"final_wait_unit" "wait_unit" DEFAULT 'business_days' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_up_sequences_stages_check" CHECK (cardinality(stages) >= 1)
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"filename" text,
	"content_type" text,
	"size_bytes" integer,
	"storage_key" text NOT NULL,
	"content_id" text,
	"is_inline" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text,
	"mailbox_id" text NOT NULL,
	"direction" "message_direction" NOT NULL,
	"status" "message_status" NOT NULL,
	"author" "message_author" NOT NULL,
	"step_id" text,
	"variant_id" text,
	"goal_id" text,
	"message_id_header" text NOT NULL,
	"in_reply_to_header" text,
	"references_headers" text[] DEFAULT '{}' NOT NULL,
	"match_method" "match_method",
	"from_email" "citext" NOT NULL,
	"from_name" text,
	"to_emails" jsonb NOT NULL,
	"cc_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to" text,
	"subject" text NOT NULL,
	"body_text" text,
	"body_html" text,
	"stripped_text" text,
	"snippet" text,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"raw_storage_key" text,
	"size_bytes" integer,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"smtp_response" text,
	"smtp_attempts" smallint DEFAULT 0 NOT NULL,
	"error" text,
	"imap_folder" text,
	"imap_uid" bigint,
	"inbound_kind" "inbound_kind",
	"auto_reply_until" date,
	"dsn_status" text,
	"needs_reply_p" numeric(4, 3),
	"tracking_token" text,
	"open_count" integer DEFAULT 0 NOT NULL,
	"first_opened_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"human_open" boolean DEFAULT false NOT NULL,
	"ai_run_id" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"lint_report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_tracking_token_unique" UNIQUE("tracking_token"),
	CONSTRAINT "messages_mailbox_id_message_id_header_unique" UNIQUE("mailbox_id","message_id_header")
);
--> statement-breakpoint
CREATE TABLE "thread_goal_achievements" (
	"thread_id" text NOT NULL,
	"goal_id" text NOT NULL,
	"achieved_at" timestamp with time zone NOT NULL,
	"method" "goal_method" NOT NULL,
	"confidence" numeric(4, 3),
	"evidence" text,
	"event_at" timestamp with time zone,
	"message_id" text,
	"integration_event_id" text,
	"confirmed_by" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revoke_reason" text,
	CONSTRAINT "thread_goal_achievements_thread_id_goal_id_pk" PRIMARY KEY("thread_id","goal_id")
);
--> statement-breakpoint
CREATE TABLE "thread_participants" (
	"thread_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"role" text DEFAULT 'cc' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_participants_thread_id_contact_id_pk" PRIMARY KEY("thread_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"mailbox_id" text,
	"stage" "thread_stage" DEFAULT 'queued' NOT NULL,
	"stage_rank" smallint DEFAULT 0 NOT NULL,
	"achieved_goal_id" text,
	"manual_floor_rank" smallint DEFAULT 0 NOT NULL,
	"state" "thread_state" DEFAULT 'active' NOT NULL,
	"state_reason" text,
	"next_action_type" "next_action_type" DEFAULT 'send_initial' NOT NULL,
	"next_action_at" timestamp with time zone,
	"next_action_message_id" text,
	"throttle_reason" text,
	"waiting_since" timestamp with time zone,
	"follow_up_sequence_id" text,
	"follow_up_step_position" smallint,
	"follow_ups_stopped" boolean DEFAULT false NOT NULL,
	"follow_ups_not_before" timestamp with time zone,
	"finish_applied_at" timestamp with time zone,
	"follow_ups_sent" smallint DEFAULT 0 NOT NULL,
	"ai_replies_sent" smallint DEFAULT 0 NOT NULL,
	"ai_paused" boolean DEFAULT false NOT NULL,
	"manually_paused" boolean DEFAULT false NOT NULL,
	"stopped_at" timestamp with time zone,
	"closed_reason" text,
	"closed_at" timestamp with time zone,
	"subject" text,
	"root_message_id_header" text,
	"open_status" "open_status" DEFAULT 'unopened' NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"first_opened_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"clicked" boolean DEFAULT false NOT NULL,
	"first_sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"latest_intent" text,
	"latest_intent_p" numeric(4, 3),
	"latest_sentiment" text,
	"temperature" numeric(3, 2),
	"classification_run_id" text,
	"classification_fallback" boolean DEFAULT false NOT NULL,
	"ai_summary" text,
	"ai_summary_at" timestamp with time zone,
	"assigned_user_id" text,
	"open_escalations" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threads_campaign_id_contact_id_unique" UNIQUE("campaign_id","contact_id"),
	CONSTRAINT "threads_goal_stage_check" CHECK ((stage = 'goal_achieved') = (achieved_goal_id is not null)),
	CONSTRAINT "threads_mailbox_check" CHECK (stage = 'queued' or mailbox_id is not null)
);
--> statement-breakpoint
CREATE TABLE "tracked_links" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"position" smallint NOT NULL,
	"original_url" text NOT NULL,
	"link_key" text
);
--> statement-breakpoint
CREATE TABLE "tracking_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"message_id" text NOT NULL,
	"thread_id" text,
	"type" "tracking_type" NOT NULL,
	"link_id" text,
	"source" "tracking_source" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" "bytea",
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text,
	"message_id" text,
	"task" text NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text NOT NULL,
	"effort" text,
	"prompt_version" text NOT NULL,
	"trigger_message_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"cost_usd_micros" bigint,
	"latency_ms" integer,
	"stop_reason" text,
	"status" text NOT NULL,
	"output" jsonb,
	"guardrail_report" jsonb,
	"decision" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_runs_provider_check" CHECK (provider in ('anthropic','typesafe'))
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text,
	"trigger_message_id" text,
	"reason" "escalation_reason" NOT NULL,
	"reasons" "escalation_reason"[] NOT NULL,
	"priority" "escalation_priority" NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_draft_id" text,
	"status" "escalation_status" DEFAULT 'open' NOT NULL,
	"assigned_user_id" text,
	"due_at" timestamp with time zone NOT NULL,
	"snoozed_until" timestamp with time zone,
	"resolution" text,
	"resolution_note" text,
	"knowledge_item_id" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"visibility" text DEFAULT 'shareable' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_escalation_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "knowledge_items_kind_check" CHECK (kind in ('product','pricing','faq','objection','policy','case_study','link','other')),
	CONSTRAINT "knowledge_items_visibility_check" CHECK (visibility in ('shareable','internal'))
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"contact_id" text,
	"thread_id" text,
	"campaign_id" text,
	"type" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"diff" jsonb,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" "bytea" NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_workspace_id_principal_id_key_pk" PRIMARY KEY("workspace_id","principal_id","key")
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"integration_id" text,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"contact_email" "citext",
	"goal_key" text,
	"value_cents" bigint,
	"payload" jsonb NOT NULL,
	"matched_contact_id" text,
	"matched_thread_id" text,
	"outcome" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "integration_events_workspace_id_source_external_id_unique" UNIQUE("workspace_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"signing_secret_enc" "bytea" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt" smallint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response_status" integer,
	"response_snippet" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"events" text[] NOT NULL,
	"secret_enc" "bytea" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_defs" ADD CONSTRAINT "custom_field_defs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_target_list_id_lists_id_fk" FOREIGN KEY ("target_list_id") REFERENCES "public"."lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_plans" ADD CONSTRAINT "capacity_plans_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_daily_stats" ADD CONSTRAINT "domain_daily_stats_domain_id_sending_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."sending_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_daily_stats" ADD CONSTRAINT "mailbox_daily_stats_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_sync_state" ADD CONSTRAINT "mailbox_sync_state_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_sending_domain_id_sending_domains_id_fk" FOREIGN KEY ("sending_domain_id") REFERENCES "public"."sending_domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_runs" ADD CONSTRAINT "poll_runs_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD CONSTRAINT "sending_domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD CONSTRAINT "sending_domains_cap_override_by_users_id_fk" FOREIGN KEY ("cap_override_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_goals" ADD CONSTRAINT "campaign_goals_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_mailboxes" ADD CONSTRAINT "campaign_mailboxes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_mailboxes" ADD CONSTRAINT "campaign_mailboxes_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_step_variants" ADD CONSTRAINT "campaign_step_variants_step_id_campaign_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_sequence_id_follow_up_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."follow_up_sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_sequences" ADD CONSTRAINT "follow_up_sequences_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_step_id_campaign_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_variant_id_campaign_step_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."campaign_step_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_goal_id_campaign_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."campaign_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_goal_achievements" ADD CONSTRAINT "thread_goal_achievements_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_goal_achievements" ADD CONSTRAINT "thread_goal_achievements_goal_id_campaign_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."campaign_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_goal_achievements" ADD CONSTRAINT "thread_goal_achievements_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_goal_achievements" ADD CONSTRAINT "thread_goal_achievements_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_achieved_goal_id_campaign_goals_id_fk" FOREIGN KEY ("achieved_goal_id") REFERENCES "public"."campaign_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_follow_up_sequence_id_follow_up_sequences_id_fk" FOREIGN KEY ("follow_up_sequence_id") REFERENCES "public"."follow_up_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_link_id_tracked_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."tracked_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_trigger_message_id_messages_id_fk" FOREIGN KEY ("trigger_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_suggested_draft_id_messages_id_fk" FOREIGN KEY ("suggested_draft_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_matched_contact_id_contacts_id_fk" FOREIGN KEY ("matched_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_matched_thread_id_threads_id_fk" FOREIGN KEY ("matched_thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_domain_uq" ON "companies" USING btree ("workspace_id","domain") WHERE deleted_at is null and domain is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_uq" ON "contacts" USING btree ("workspace_id","email") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "contacts_search_idx" ON "contacts" USING gin ("search");--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_email_uq" ON "suppressions" USING btree ("workspace_id","email_hash") WHERE email_hash is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_domain_uq" ON "suppressions" USING btree ("workspace_id","domain") WHERE domain is not null;--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id",coalesce(sent_at, received_at, created_at));--> statement-breakpoint
CREATE INDEX "messages_refs_idx" ON "messages" USING gin ("references_headers");--> statement-breakpoint
CREATE INDEX "messages_pending_idx" ON "messages" USING btree ("status") WHERE status in ('pending_approval','scheduled','sending','send_unknown');--> statement-breakpoint
CREATE INDEX "threads_due_idx" ON "threads" USING btree ("next_action_at") WHERE state = 'active' and next_action_type <> 'none';--> statement-breakpoint
CREATE INDEX "threads_campaign_idx" ON "threads" USING btree ("campaign_id","stage_rank","state");--> statement-breakpoint
CREATE INDEX "threads_contact_idx" ON "threads" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "tracking_events_msg_idx" ON "tracking_events" USING btree ("message_id","occurred_at");--> statement-breakpoint
CREATE INDEX "escalations_open_idx" ON "escalations" USING btree ("workspace_id","status","priority","due_at") WHERE status in ('open','snoozed');--> statement-breakpoint
CREATE INDEX "activities_contact_idx" ON "activities" USING btree ("contact_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activities_thread_idx" ON "activities" USING btree ("thread_id","occurred_at" DESC NULLS LAST);