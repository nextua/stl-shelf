// @vitest-environment node
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const modelSchema = await import("@/lib/db/schema/models");
  const folders = await import("@/lib/db/schema/folders");
  const auth = await import("@/lib/db/schema/auth");
  const schema = { ...modelSchema, ...folders, ...auth };
  return { ...schema, db: drizzle(new PGlite(), { schema }) };
});

import { db } from "@/lib/db";
import { assertModelAccess } from "@/server/services/folder-access.service";
import { assertCanEditModelOfFile, assertCanEditModelOfVersion } from "./model-permission.service";

const MODEL = "00000000-0000-4000-8000-000000000001";
const VERSION = "00000000-0000-4000-8000-000000000002";
const FILE = "00000000-0000-4000-8000-000000000003";
const FOLDER = "00000000-0000-4000-8000-000000000004";
const actor = { organizationId: "org", userId: "uploader", memberRole: "member" };

beforeEach(async () => {
  const schemaSQL = `
    DROP TABLE IF EXISTS model_files, model_versions, models, folder_grants, library_folders CASCADE;
    CREATE TABLE library_folders (id uuid PRIMARY KEY, organization_id text NOT NULL, parent_id uuid, name text NOT NULL, inherit_permissions boolean NOT NULL DEFAULT true, created_by text NOT NULL, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz);
    CREATE TABLE folder_grants (folder_id uuid NOT NULL, user_id text NOT NULL, role text NOT NULL, created_at timestamptz DEFAULT now());
    CREATE TABLE models (id uuid PRIMARY KEY, organization_id text NOT NULL, owner_id text NOT NULL, folder_id uuid, deleted_at timestamptz);
    CREATE TABLE model_versions (id uuid PRIMARY KEY, model_id uuid NOT NULL);
    CREATE TABLE model_files (id uuid PRIMARY KEY, version_id uuid NOT NULL, storage_key text);
  `;
  for (const statement of schemaSQL
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean))
    await db.execute(sql.raw(statement));
  await db.execute(
    sql`INSERT INTO library_folders (id, organization_id, name, created_by) VALUES (${FOLDER}, 'org', 'Project', 'administrator')`,
  );
  await db.execute(
    sql`INSERT INTO models (id, organization_id, owner_id, folder_id) VALUES (${MODEL}, 'org', 'uploader', ${FOLDER})`,
  );
  await db.execute(sql`INSERT INTO model_versions (id, model_id) VALUES (${VERSION}, ${MODEL})`);
  await db.execute(
    sql`INSERT INTO model_files (id, version_id, storage_key) VALUES (${FILE}, ${VERSION}, 'source')`,
  );
});

describe("folder-aware model resource guards", () => {
  it("does not let the original uploader bypass a private folder", async () => {
    await expect(assertCanEditModelOfVersion(VERSION, actor)).rejects.toMatchObject({
      status: 404,
    });
    await expect(assertCanEditModelOfFile(FILE, actor)).rejects.toMatchObject({ status: 404 });
  });
  it("allows viewers to read while denying file and version writes", async () => {
    await db.execute(
      sql`INSERT INTO folder_grants (folder_id, user_id, role) VALUES (${FOLDER}, 'uploader', 'viewer')`,
    );
    await expect(assertModelAccess(actor, MODEL)).resolves.toMatchObject({
      canEdit: false,
      canDelete: false,
    });
    await expect(assertCanEditModelOfVersion(VERSION, actor)).rejects.toMatchObject({
      status: 403,
    });
    await expect(assertCanEditModelOfFile(FILE, actor)).rejects.toMatchObject({ status: 403 });
  });
  it("allows an editor to update another uploader's model without granting management", async () => {
    await db.execute(
      sql`INSERT INTO folder_grants (folder_id, user_id, role) VALUES (${FOLDER}, 'colleague', 'editor')`,
    );
    const editor = { ...actor, userId: "colleague" };
    await expect(assertCanEditModelOfVersion(VERSION, editor)).resolves.toBeUndefined();
    await expect(assertCanEditModelOfFile(FILE, editor)).resolves.toBeUndefined();
    await expect(assertModelAccess(editor, MODEL, "manager")).rejects.toMatchObject({
      status: 403,
    });
  });
  it("lets a folder manager manage its model", async () => {
    await db.execute(
      sql`INSERT INTO folder_grants (folder_id, user_id, role) VALUES (${FOLDER}, 'colleague', 'manager')`,
    );
    await expect(
      assertModelAccess({ ...actor, userId: "colleague" }, MODEL, "manager"),
    ).resolves.toMatchObject({ canDelete: true, canMove: true });
  });
  it("revokes access after a grant is removed", async () => {
    await db.execute(
      sql`INSERT INTO folder_grants (folder_id, user_id, role) VALUES (${FOLDER}, 'uploader', 'viewer')`,
    );
    await assertModelAccess(actor, MODEL);
    await db.execute(sql`DELETE FROM folder_grants`);
    await expect(assertModelAccess(actor, MODEL)).rejects.toMatchObject({ status: 404 });
  });
  it("preserves access to a member's own unfiled models", async () => {
    await db.execute(sql`UPDATE models SET folder_id = NULL`);
    await expect(assertCanEditModelOfVersion(VERSION, actor)).resolves.toBeUndefined();
    await expect(assertModelAccess({ ...actor, userId: "other" }, MODEL)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("keeps other organizations and deleted models inaccessible to administrators", async () => {
    await expect(
      assertModelAccess({ ...actor, organizationId: "other", memberRole: "owner" }, MODEL),
    ).rejects.toMatchObject({ status: 404 });
    await db.execute(sql`UPDATE models SET deleted_at = now()`);
    await expect(assertModelAccess({ ...actor, memberRole: "owner" }, MODEL)).rejects.toMatchObject(
      { status: 404 },
    );
  });
  it("rejects unknown resource ids", async () => {
    await expect(
      assertCanEditModelOfVersion("00000000-0000-4000-8000-000000000099", actor),
    ).rejects.toMatchObject({ status: 404 });
  });
});
