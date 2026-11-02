export type FolderRole = "viewer" | "editor" | "manager";
export const FOLDER_ROLE_LEVEL: Record<FolderRole, number> = { viewer: 1, editor: 2, manager: 3 };
export type FolderActor = { organizationId: string; userId: string; memberRole: string };
export type FolderNode = { id: string; parentId: string | null; inheritPermissions: boolean };
export type FolderGrant = { folderId: string; userId: string; role: FolderRole };
export const isLibraryAdmin = (actor: FolderActor) => ["owner", "admin"].includes(actor.memberRole);

/** Iterative traversal: nesting has no configured depth limit or JS recursion limit. */
export function resolveFolderLevels(
  nodes: FolderNode[],
  grants: FolderGrant[],
  actor: FolderActor,
): Map<string, number> {
  const folders = new Map(nodes.map((node) => [node.id, node]));
  const levels = new Map<string, number>();
  const ownGrants = new Map(
    grants
      .filter((grant) => grant.userId === actor.userId)
      .map((grant) => [grant.folderId, FOLDER_ROLE_LEVEL[grant.role]]),
  );
  for (const node of nodes) {
    if (isLibraryAdmin(actor)) {
      levels.set(node.id, 3);
      continue;
    }
    if (levels.has(node.id)) continue;
    const chain: FolderNode[] = [];
    const visited = new Set<string>();
    let current: FolderNode | undefined = node;
    while (current && !levels.has(current.id)) {
      if (visited.has(current.id)) throw new Error("Folder hierarchy contains a cycle");
      visited.add(current.id);
      chain.push(current);
      current =
        current.inheritPermissions && current.parentId ? folders.get(current.parentId) : undefined;
    }
    let inherited = current ? (levels.get(current.id) ?? 0) : 0;
    while (chain.length) {
      const folder = chain.pop()!;
      inherited = Math.max(
        folder.inheritPermissions ? inherited : 0,
        ownGrants.get(folder.id) ?? 0,
      );
      levels.set(folder.id, inherited);
    }
  }
  return levels;
}

export function wouldCreateFolderCycle(
  nodes: FolderNode[],
  folderId: string,
  parentId: string | null,
): boolean {
  const folders = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  let current = parentId;
  while (current) {
    if (current === folderId || visited.has(current)) return true;
    visited.add(current);
    current = folders.get(current)?.parentId ?? null;
  }
  return false;
}
