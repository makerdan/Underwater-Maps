CREATE TABLE "poe_verification_diagnostics" (
	"route" text NOT NULL,
	"code" text NOT NULL,
	"count" integer NOT NULL,
	"last_occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "poe_verification_diagnostics_pk" PRIMARY KEY("route","code"),
	CONSTRAINT "poe_verification_diagnostics_route_check" CHECK ("poe_verification_diagnostics"."route" IN ('classify', 'help', 'models', 'query', 'unknown', 'upscale')),
	CONSTRAINT "poe_verification_diagnostics_code_check" CHECK ("poe_verification_diagnostics"."code" IN ('model_registry_unavailable', 'model_unavailable')),
	CONSTRAINT "poe_verification_diagnostics_count_check" CHECK ("poe_verification_diagnostics"."count" > 0)
);
