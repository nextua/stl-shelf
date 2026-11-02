import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
type FolderDatabase = Pick<Database, "select">;
import {
  db,
  folderGrants,
  libraryFolders,
  member,
  modelFiles,
  models,
  modelVersions,
  organization,
  printProfiles,
} from "@/lib/db";
import {
  FOLDER_ROLE_LEVEL,
  isLibraryAdmin,
  resolveFolderLevels,
  type FolderActor,
  type FolderRole,
} from "@/lib/folders";

export class FolderAccessError extends Error {
  constructor(
    message = "Об’єкт не знайдено або немає доступу",
    public readonly status = 404,
  ) {
    super(message);
  }
}

export async function loadFolderGraph(actor: FolderActor, database: FolderDatabase = db) {
  const folders = await database
    .select()
    .from(libraryFolders)
    .where(
      and(
        eq(libraryFolders.organizationId, actor.organizationId),
        isNull(libraryFolders.deletedAt),
      ),
    );
  const grants = await database
    .select({
      folderId: folderGrants.folderId,
      userId: folderGrants.userId,
      role: folderGrants.role,
    })
    .from(folderGrants)
    .innerJoin(libraryFolders, eq(folderGrants.folderId, libraryFolders.id))
    .where(
      and(
        eq(libraryFolders.organizationId, actor.organizationId),
        eq(folderGrants.userId, actor.userId),
        isNull(libraryFolders.deletedAt),
      ),
    );
  return { folders, levels: resolveFolderLevels(folders, grants, actor) };
}

export async function assertFolderAccess(
  actor: FolderActor,
  folderId: string | null,
  minimum: FolderRole = "viewer",
  database: FolderDatabase = db,
) {
  if (folderId === null) {
    if (!isLibraryAdmin(actor))
      throw new FolderAccessError("Керувати коренем бібліотеки може лише адміністратор", 403);
    return;
  }
  if (!z.uuid().safeParse(folderId).success) throw new FolderAccessError();
  if (isLibraryAdmin(actor)) {
    const [folder] = await database
      .select({ id: libraryFolders.id })
      .from(libraryFolders)
      .where(
        and(
          eq(libraryFolders.id, folderId),
          eq(libraryFolders.organizationId, actor.organizationId),
          isNull(libraryFolders.deletedAt),
        ),
      )
      .limit(1);
    if (!folder) throw new FolderAccessError();
    return;
  }
  const graph = await loadFolderGraph(actor, database);
  const level = graph.levels.get(folderId) ?? 0;
  if (!level) throw new FolderAccessError();
  if (level < FOLDER_ROLE_LEVEL[minimum])
    throw new FolderAccessError("Недостатньо прав для цієї дії", 403);
}

export async function modelVisibilityPredicate(actor: FolderActor) {
  const scope = and(eq(models.organizationId, actor.organizationId), isNull(models.deletedAt));
  if (isLibraryAdmin(actor)) return scope!;
  const { levels } = await loadFolderGraph(actor);
  const allowed = [...levels].filter(([, level]) => level >= 1).map(([id]) => id);
  return and(
    scope,
    or(
      and(isNull(models.folderId), eq(models.ownerId, actor.userId)),
      allowed.length ? inArray(models.folderId, allowed) : sql`false`,
    ),
  )!;
}

export async function assertModelAccess(
  actor: FolderActor,
  modelId: string,
  minimum: FolderRole = "viewer",
  database: FolderDatabase = db,
) {
  if (!z.uuid().safeParse(modelId).success) throw new FolderAccessError();
  const [model] = await database
    .select({ id: models.id, folderId: models.folderId, ownerId: models.ownerId })
    .from(models)
    .where(
      and(
        eq(models.id, modelId),
        eq(models.organizationId, actor.organizationId),
        isNull(models.deletedAt),
      ),
    )
    .limit(1);
  if (!model) throw new FolderAccessError();
  let level = isLibraryAdmin(actor) ? 3 : 0;
  if (!level) {
    if (model.folderId)
      level = (await loadFolderGraph(actor, database)).levels.get(model.folderId) ?? 0;
    else if (model.ownerId === actor.userId) level = 2;
  }
  if (!level) throw new FolderAccessError();
  if (level < FOLDER_ROLE_LEVEL[minimum])
    throw new FolderAccessError("Недостатньо прав для цієї дії", 403);
  return { ...model, level, canEdit: level >= 2, canDelete: level >= 3, canMove: level >= 3 };
}

export type ModelResource = "model" | "version" | "file" | "profile" | "storage";
export async function assertResourceAccess(
  actor: FolderActor,
  kind: ModelResource,
  id: string,
  minimum: FolderRole = "viewer",
) {
  if (kind === "model") return assertModelAccess(actor, id, minimum);
  if (kind !== "storage" && !z.uuid().safeParse(id).success) throw new FolderAccessError();
  let modelId: string | undefined;
  if (kind === "version") {
    const [row] = await db
      .select({ modelId: modelVersions.modelId })
      .from(modelVersions)
      .where(eq(modelVersions.id, id))
      .limit(1);
    modelId = row?.modelId;
  } else if (kind === "profile") {
    const [row] = await db
      .select({ modelId: modelVersions.modelId })
      .from(printProfiles)
      .innerJoin(modelVersions, eq(printProfiles.versionId, modelVersions.id))
      .innerJoin(
        modelFiles,
        and(
          eq(printProfiles.fileId, modelFiles.id),
          eq(modelFiles.versionId, printProfiles.versionId),
        ),
      )
      .where(eq(printProfiles.id, id))
      .limit(1);
    modelId = row?.modelId;
  } else {
    const [row] = await db
      .select({ modelId: modelVersions.modelId })
      .from(modelFiles)
      .innerJoin(modelVersions, eq(modelFiles.versionId, modelVersions.id))
      .where(kind === "file" ? eq(modelFiles.id, id) : eq(modelFiles.storageKey, id))
      .limit(1);
    modelId = row?.modelId;
  }
  if (!modelId) throw new FolderAccessError();
  return assertModelAccess(actor, modelId, minimum);
}

type Session = { user: { id: string }; session: { activeOrganizationId?: string | null } };
export async function folderActorFromSession(session: Session): Promise<FolderActor> {
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) throw new FolderAccessError();
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, organizationId),
        isNull(organization.accountDeletionCompletedAt),
      ),
    )
    .limit(1);
  if (!membership) throw new FolderAccessError();
  return { organizationId, userId: session.user.id, memberRole: membership.role };
}

/** Route guard returns a response, so forbidden resources never become a 500 or redirect. */
export async function authorizeSessionResource(
  session: Session,
  kind: ModelResource,
  id: string,
  minimum: FolderRole = "viewer",
): Promise<Response | null> {
  try {
    await assertResourceAccess(await folderActorFromSession(session), kind, id, minimum);
    return null;
  } catch (error) {
    if (error instanceof FolderAccessError)
      return new Response(error.message, {
        status: error.status,
        headers: { "Cache-Control": "private, no-store" },
      });
    throw error;
  }
}

export async function authorizeActorResource(
  actor: FolderActor,
  kind: ModelResource,
  id: string,
  minimum: FolderRole = "viewer",
): Promise<Response | null> {
  try {
    await assertResourceAccess(actor, kind, id, minimum);
    return null;
  } catch (error) {
    if (error instanceof FolderAccessError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
