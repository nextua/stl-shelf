import { assertResourceAccess } from "@/server/services/folder-access.service";
import type { FolderActor } from "@/lib/folders";

export async function assertCanEditModelOfVersion(
  versionId: string,
  actor: FolderActor,
): Promise<void> {
  await assertResourceAccess(actor, "version", versionId, "editor");
}
export async function assertCanEditModelOfFile(fileId: string, actor: FolderActor): Promise<void> {
  await assertResourceAccess(actor, "file", fileId, "editor");
}
