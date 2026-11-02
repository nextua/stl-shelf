import { folderPath, useLibraryFolders } from "@/hooks/use-library-folders";
import { wouldCreateFolderCycle } from "@/lib/folders";

export function FolderPicker({
  value,
  onChange,
  minimum = 3,
  excludeId,
}: {
  value: string;
  onChange: (value: string) => void;
  minimum?: number;
  excludeId?: string;
}) {
  const { data } = useLibraryFolders();
  const folders = data?.folders ?? [];
  const paths = new Map(folders.map((folder) => [folder.id, folderPath(folder, folders)]));
  const available = folders.filter(
    (folder) =>
      folder.accessLevel >= minimum &&
      (!excludeId || !wouldCreateFolderCycle(folders, excludeId, folder.id)),
  );
  return (
    <select
      aria-label="Тека призначення"
      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled={!data?.canManageLibrary}>
        Корінь бібліотеки
      </option>
      {available
        .sort((a, b) => paths.get(a.id)!.localeCompare(paths.get(b.id)!))
        .map((folder) => (
          <option key={folder.id} value={folder.id}>
            {paths.get(folder.id)}
          </option>
        ))}
    </select>
  );
}
