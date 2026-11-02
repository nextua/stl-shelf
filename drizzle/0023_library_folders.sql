CREATE TYPE "public"."folder_role" AS ENUM('viewer', 'editor', 'manager');--> statement-breakpoint
CREATE TABLE "folder_grants" (
	"folder_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "folder_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folder_grants_folder_id_user_id_pk" PRIMARY KEY("folder_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "library_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"inherit_permissions" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "library_folders_id_org_uidx" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "folder_grants" ADD CONSTRAINT "folder_grants_folder_id_library_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."library_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_grants" ADD CONSTRAINT "folder_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_parent_org_fk" FOREIGN KEY ("parent_id","organization_id") REFERENCES "public"."library_folders"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folder_grants_user_idx" ON "folder_grants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_folders_root_name_uidx" ON "library_folders" USING btree ("organization_id","name") WHERE "library_folders"."parent_id" IS NULL AND "library_folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "library_folders_child_name_uidx" ON "library_folders" USING btree ("organization_id","parent_id","name") WHERE "library_folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "library_folders_parent_idx" ON "library_folders" USING btree ("organization_id","parent_id");--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_folder_org_fk" FOREIGN KEY ("folder_id","organization_id") REFERENCES "public"."library_folders"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "models_folder_idx" ON "models" USING btree ("organization_id","folder_id");