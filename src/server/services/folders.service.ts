import { and, eq, isNull, sql } from "drizzle-orm";
import { db, folderGrants, libraryFolders, member, models, user } from "@/lib/db";
import {
  isLibraryAdmin,
  wouldCreateFolderCycle,
  type FolderActor,
  type FolderRole,
} from "@/lib/folders";
import {
  assertFolderAccess,
  assertModelAccess,
  FolderAccessError,
  loadFolderGraph,
} from "./folder-access.service";

export async function listLibraryFolders(actor: FolderActor) {
  const { folders, levels } = await loadFolderGraph(actor);
  const visible = new Set([...levels].filter(([, level]) => level > 0).map(([id]) => id));
  return {
    canManageLibrary: isLibraryAdmin(actor),
    folders: folders
      .filter((folder) => visible.has(folder.id))
      .map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        navigationParentId:
          folder.parentId && visible.has(folder.parentId) ? folder.parentId : null,
        inheritPermissions: folder.inheritPermissions,
        accessLevel: levels.get(folder.id) ?? 0,
      })),
  };
}

/** All hierarchy/ACL writes take the same organization lock; simultaneous moves cannot create a cycle. */
export async function createLibraryFolder(
  actor: FolderActor,
  name: string,
  parentId: string | null,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${actor.organizationId}))`);
    await assertFolderAccess(actor, parentId, "editor", tx);
    const [folder] = await tx
      .insert(libraryFolders)
      .values({ organizationId: actor.organizationId, createdBy: actor.userId, name, parentId })
      .returning();
    return folder!;
  });
}

export async function updateLibraryFolder(
  actor: FolderActor,
  input: { id: string; name?: string; parentId?: string | null; inheritPermissions?: boolean },
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${actor.organizationId}))`);
    await assertFolderAccess(actor, input.id, "manager", tx);
    if (input.parentId !== undefined) {
      await assertFolderAccess(actor, input.parentId, "manager", tx);
      const { folders } = await loadFolderGraph(actor, tx);
      if (wouldCreateFolderCycle(folders, input.id, input.parentId))
        throw new Error("Не можна перемістити теку в неї саму або в її підтеку");
    }
    const [folder] = await tx
      .update(libraryFolders)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.inheritPermissions !== undefined
          ? { inheritPermissions: input.inheritPermissions }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(libraryFolders.id, input.id),
          eq(libraryFolders.organizationId, actor.organizationId),
          isNull(libraryFolders.deletedAt),
        ),
      )
      .returning();
    return folder!;
  });
}

export async function deleteEmptyLibraryFolder(actor: FolderActor, id: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${actor.organizationId}))`);
    await assertFolderAccess(actor, id, "manager", tx);
    const children = await tx
      .select({ id: libraryFolders.id })
      .from(libraryFolders)
      .where(and(eq(libraryFolders.parentId, id), isNull(libraryFolders.deletedAt)))
      .limit(1);
    const contents = await tx
      .select({ id: models.id })
      .from(models)
      .where(and(eq(models.folderId, id), isNull(models.deletedAt)))
      .limit(1);
    if (children.length || contents.length)
      throw new Error("Спочатку перемістіть або видаліть вміст теки");
    await tx
      .update(libraryFolders)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(libraryFolders.id, id));
    return { success: true };
  });
}

export async function getLibraryFolderAccess(actor: FolderActor, id: string) {
  await assertFolderAccess(actor, id, "manager");
  const members = await db
    .select({ userId: user.id, name: user.name, email: user.email, organizationRole: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(eq(member.organizationId, actor.organizationId), isNull(user.accountDeletionCompletedAt)),
    );
  const grants = await db
    .select({ userId: folderGrants.userId, role: folderGrants.role })
    .from(folderGrants)
    .where(eq(folderGrants.folderId, id));
  return { members, grants, canCreateUsers: isLibraryAdmin(actor) };
}

export async function setLibraryFolderGrant(
  actor: FolderActor,
  id: string,
  userId: string,
  role: FolderRole | null,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${actor.organizationId}))`);
    await assertFolderAccess(actor, id, "manager", tx);
    const [membership] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, actor.organizationId), eq(member.userId, userId)))
      .limit(1);
    if (!membership) throw new FolderAccessError("Користувач не є учасником організації", 400);
    if (role)
      await tx
        .insert(folderGrants)
        .values({ folderId: id, userId, role })
        .onConflictDoUpdate({
          target: [folderGrants.folderId, folderGrants.userId],
          set: { role },
        });
    else
      await tx
        .delete(folderGrants)
        .where(and(eq(folderGrants.folderId, id), eq(folderGrants.userId, userId)));
    return { success: true };
  });
}

export async function moveLibraryModel(
  actor: FolderActor,
  modelId: string,
  folderId: string | null,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${actor.organizationId}))`);
    await assertModelAccess(actor, modelId, "manager", tx);
    await assertFolderAccess(actor, folderId, "manager", tx);
    await tx
      .update(models)
      .set({ folderId, updatedAt: new Date() })
      .where(and(eq(models.id, modelId), eq(models.organizationId, actor.organizationId)));
    return { success: true };
  });
}
