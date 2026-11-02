import { useQuery } from "@tanstack/react-query";
import { listFolders } from "@/server/functions/folders";

export const foldersQueryOptions = () => ({
  queryKey: ["library-folders"],
  queryFn: () => listFolders(),
});
export const useLibraryFolders = (enabled = true) =>
  useQuery({ ...foldersQueryOptions(), enabled });
export type LibraryFolder = Awaited<ReturnType<typeof listFolders>>["folders"][number];

export function folderPath(folder: LibraryFolder, folders: LibraryFolder[]): string {
  const byId = new Map(folders.map((item) => [item.id, item]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current: LibraryFolder | undefined = folder;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.push(current.name);
    current = current.navigationParentId ? byId.get(current.navigationParentId) : undefined;
  }
  return names.reverse().join(" / ");
}
