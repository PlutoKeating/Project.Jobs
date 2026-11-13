CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "app_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"version" text NOT NULL,
	"git_sha" text,
	"env_url" text NOT NULL,
	"seeded_defects" jsonb,
	"prd" text,
	"product_spec_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"form" text DEFAULT 'web' NOT NULL,
	"stage" text DEFAULT 'mvp',
	"description" text DEFAULT '',
	"envs" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apps_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "calibration_results" (
	"id" text PRIMARY KEY NOT NULL,
	"calibration_set_id" text NOT NULL,
	"study_id" text,
	"app_id" text,
	"segment" text DEFAULT '*' NOT NULL,
	"scenario_class" text DEFAULT '*' NOT NULL,
	"dimension" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision,
	"ci_low" double precision,
	"ci_high" double precision,
	"n" integer NOT NULL,
	"method" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trust_level" text DEFAULT 'unknown' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"app_version_id" text,
	"app_id" text,
	"source" text NOT NULL,
	"name" text,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exploration_coverage" (
	"id" text PRIMARY KEY NOT NULL,
	"app_version_id" text NOT NULL,
	"dimension" text NOT NULL,
	"key" text NOT NULL,
	"label" text,
	"visits" integer DEFAULT 0 NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"sessions" jsonb DEFAULT '[]'::jsonb,
	"last_new_issue_at" timestamp with time zone,
	"saturation" real DEFAULT 0 NOT NULL,
	"priority" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"step_idx" integer NOT NULL,
	"sim_time" text NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"caused_by_event_id" text,
	"text" text NOT NULL,
	"effects" jsonb NOT NULL,
	"perceived" boolean DEFAULT true NOT NULL,
	"perceived_text" text
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"storage_ref" text,
	"inline" jsonb,
	"mime" text,
	"hash" text NOT NULL,
	"bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"study_id" text,
	"session_id" text,
	"step_idx" integer,
	"persona_id" text
);
--> statement-breakpoint
CREATE TABLE "evidence_links" (
	"evidence_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"role" text DEFAULT 'supporting' NOT NULL,
	CONSTRAINT "evidence_links_evidence_id_subject_type_subject_id_pk" PRIMARY KEY("evidence_id","subject_type","subject_id")
);
--> statement-breakpoint
CREATE TABLE "executor_comparisons" (
	"id" text PRIMARY KEY NOT NULL,
	"app_version_id" text NOT NULL,
	"executor" text NOT NULL,
	"action_set" text NOT NULL,
	"results" jsonb NOT NULL,
	"success_rate" real,
	"avg_ms" real,
	"failure_layers" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"app_version_id" text,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"entry_points" jsonb DEFAULT '[]'::jsonb,
	"url_patterns" jsonb DEFAULT '[]'::jsonb,
	"state_ids" jsonb DEFAULT '[]'::jsonb,
	"source" text DEFAULT 'crawl' NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"study_id" text,
	"kind" text NOT NULL,
	"statement_for_persona" text NOT NULL,
	"locale" text DEFAULT 'zh-CN' NOT NULL,
	"linked_task_ids" jsonb DEFAULT '[]'::jsonb,
	"linked_hypothesis_ids" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"study_id" text NOT NULL,
	"reason" text NOT NULL,
	"url" text,
	"cdp_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "hypotheses" (
	"id" text PRIMARY KEY NOT NULL,
	"study_id" text,
	"app_id" text NOT NULL,
	"key" text,
	"statement" text NOT NULL,
	"about" text DEFAULT 'ux' NOT NULL,
	"target_segments" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb,
	"rationale" text,
	"created_by" text DEFAULT 'team' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"kind" text DEFAULT 'post_session' NOT NULL,
	"qa" jsonb NOT NULL,
	"questionnaire" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"study_id" text NOT NULL,
	"session_id" text NOT NULL,
	"step_idx" integer,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"heuristics" jsonb DEFAULT '[]'::jsonb,
	"state_id" text,
	"url" text,
	"error_code" text,
	"error_layer" text,
	"attribution" text,
	"attribution_detail" jsonb,
	"severity_hint" text,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb,
	"issue_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY NOT NULL,
	"app_version_id" text NOT NULL,
	"study_id" text,
	"title" text NOT NULL,
	"title_en" text,
	"description" text,
	"category" text NOT NULL,
	"heuristics" jsonb DEFAULT '[]'::jsonb,
	"severity" text NOT NULL,
	"attribution" text NOT NULL,
	"affected_segments" jsonb DEFAULT '[]'::jsonb,
	"affected_personas" jsonb DEFAULT '[]'::jsonb,
	"session_ids" jsonb DEFAULT '[]'::jsonb,
	"fingerprint" text NOT NULL,
	"disagreement" real,
	"trust_level" text DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"recommendation" text,
	"url_pattern" text,
	"repro_path_id" text,
	"seeded_match" text,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judgments" (
	"id" text PRIMARY KEY NOT NULL,
	"study_id" text,
	"target" text NOT NULL,
	"target_id" text NOT NULL,
	"evaluator_role" text NOT NULL,
	"model_alias" text,
	"model_family" text,
	"eval_class" text NOT NULL,
	"rubric_version" text NOT NULL,
	"scores" jsonb NOT NULL,
	"rationale" text,
	"rationale_ev" text,
	"order_swapped" boolean DEFAULT false NOT NULL,
	"phase" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"alias" text NOT NULL,
	"model" text,
	"family" text,
	"study_id" text,
	"session_id" text,
	"step_idx" integer,
	"purpose" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"step_idx" integer NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"state_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_global_state" (
	"persona_id" text PRIMARY KEY NOT NULL,
	"ai_trust" real NOT NULL,
	"app_trust" jsonb DEFAULT '{}'::jsonb,
	"sim_day" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "persona_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"app_id" text,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"valence" real DEFAULT 0 NOT NULL,
	"importance" real DEFAULT 0.5 NOT NULL,
	"source_session_id" text,
	"embedding" vector(768),
	"sim_time" text,
	"sim_day" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_recalled_at" timestamp with time zone,
	"decay" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" text NOT NULL,
	"version" text NOT NULL,
	"kind" text NOT NULL,
	"locale" text NOT NULL,
	"segment" text NOT NULL,
	"target_user" boolean DEFAULT true NOT NULL,
	"source" text NOT NULL,
	"spec" jsonb NOT NULL,
	"embedding" vector(768),
	"frozen" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personas_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"study_id" text NOT NULL,
	"formats" jsonb NOT NULL,
	"sections" jsonb NOT NULL,
	"calibration_card" jsonb,
	"diff_from_report_id" text,
	"paths" jsonb,
	"metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repro_paths" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text,
	"candidate_id" text,
	"start_url" text NOT NULL,
	"steps" jsonb NOT NULL,
	"from_session_ids" jsonb DEFAULT '[]'::jsonb,
	"replay_runs" integer DEFAULT 0 NOT NULL,
	"replay_ok" integer DEFAULT 0 NOT NULL,
	"replay_ok_rate" real,
	"last_replay" jsonb
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" text PRIMARY KEY NOT NULL,
	"study_id" text NOT NULL,
	"segment" text NOT NULL,
	"scenario_class" text NOT NULL,
	"dimension" text NOT NULL,
	"eval_class" text NOT NULL,
	"mean" double precision,
	"p10" double precision,
	"p90" double precision,
	"stdev" double precision,
	"n" integer NOT NULL,
	"trust_level" text DEFAULT 'unknown' NOT NULL,
	"method" text DEFAULT 'raw'
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"study_id" text NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"persona_id" text NOT NULL,
	"persona_version" text NOT NULL,
	"world_template_id" text NOT NULL,
	"goal_id" text,
	"mode" text NOT NULL,
	"is_expert_baseline" boolean DEFAULT false NOT NULL,
	"revisit_day" integer DEFAULT 0 NOT NULL,
	"plan_priority" real,
	"plan_reason" jsonb,
	"status" text DEFAULT 'planned' NOT NULL,
	"outcome" text,
	"end_reason" text,
	"steps_count" integer DEFAULT 0 NOT NULL,
	"rng_seed" integer NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"executor" text DEFAULT 'stagehand' NOT NULL,
	"path_signature" text,
	"video_ev" text,
	"har_ev" text,
	"rrweb_ev" text,
	"summary" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "steps" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"idx" integer NOT NULL,
	"world_state_id" text,
	"observation_id" text,
	"perceived_summary" text,
	"monologue" text,
	"expectation" text,
	"expectation_violated" boolean,
	"dynamic_state" jsonb,
	"intent" text,
	"decision" text,
	"action_request" jsonb,
	"action_result" jsonb,
	"sim_clock" text,
	"real_ms" integer,
	"tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studies" (
	"id" text PRIMARY KEY NOT NULL,
	"app_version_id" text NOT NULL,
	"name" text,
	"trigger" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"status_detail" text,
	"idempotency_key" text,
	"rng_seed" integer NOT NULL,
	"workflow_id" text,
	"isolation_warning" text,
	"tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"stop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "studies_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "task_defs" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"app_version_id" text,
	"key" text NOT NULL,
	"feature_ids" jsonb DEFAULT '[]'::jsonb,
	"statement" text NOT NULL,
	"statement_en" text,
	"success_signals" jsonb DEFAULT '[]'::jsonb,
	"regression" boolean DEFAULT false NOT NULL,
	"requires_login" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_states" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"step_idx" integer NOT NULL,
	"sim_clock" text NOT NULL,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"scenario_class" text NOT NULL,
	"spec" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_versions" ADD CONSTRAINT "app_versions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_app_version_id_app_versions_id_fk" FOREIGN KEY ("app_version_id") REFERENCES "public"."app_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steps" ADD CONSTRAINT "steps_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_app_version_id_app_versions_id_fk" FOREIGN KEY ("app_version_id") REFERENCES "public"."app_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_defs" ADD CONSTRAINT "task_defs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_defs" ADD CONSTRAINT "task_defs_app_version_id_app_versions_id_fk" FOREIGN KEY ("app_version_id") REFERENCES "public"."app_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_versions_app_version" ON "app_versions" USING btree ("app_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "cov_unique" ON "exploration_coverage" USING btree ("app_version_id","dimension","key");--> statement-breakpoint
CREATE INDEX "events_session" ON "events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "evidence_session" ON "evidence" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "evidence_hash" ON "evidence" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "cand_study" ON "issue_candidates" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "issues_av" ON "issues" USING btree ("app_version_id");--> statement-breakpoint
CREATE INDEX "issues_fp" ON "issues" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "judg_target" ON "judgments" USING btree ("target","target_id");--> statement-breakpoint
CREATE INDEX "trace_study" ON "llm_traces" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "trace_session" ON "llm_traces" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "obs_session" ON "observations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "obs_state" ON "observations" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "pm_persona_app" ON "persona_memories" USING btree ("persona_id","app_id");--> statement-breakpoint
CREATE INDEX "sessions_study" ON "sessions" USING btree ("study_id");--> statement-breakpoint
CREATE UNIQUE INDEX "steps_session_idx" ON "steps" USING btree ("session_id","idx");--> statement-breakpoint
CREATE UNIQUE INDEX "ws_session_step" ON "world_states" USING btree ("session_id","step_idx");