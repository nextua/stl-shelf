import { FolderOpen, Plus, Search } from "lucide-react";
import { useLocation } from "@tanstack/react-router";
import { useLibraryFolders } from "@/hooks/use-library-folders";
import { uploadModalActions } from "@/stores/upload-modal.store";
import { Button } from "@/components/ui/button";

export function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  const folderId = useLocation({
    select: (location) => (location.search as { folder?: string }).folder,
  });
  const { data } = useLibraryFolders();
  const canUpload = folderId
    ? (data?.folders.find((folder) => folder.id === folderId)?.accessLevel ?? 0) >= 2
    : data?.canManageLibrary;
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed py-12 text-center">
      {hasFilters ? (
        <Search className="mb-3 h-10 w-10 text-muted-foreground" />
      ) : (
        <FolderOpen className="mb-3 h-10 w-10 text-muted-foreground" />
      )}
      <h3 className="font-semibold">
        {hasFilters ? "Нічого не знайдено" : "Тут поки немає файлів і моделей"}
      </h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {hasFilters
          ? "Змініть пошук або фільтри в поточній теці."
          : canUpload
            ? "Завантажте файли кнопкою вище або додайте модель з кількома файлами та версіями."
            : "Нові файли з’являться тут, коли їх додадуть учасники проєкту."}
      </p>
      {!hasFilters && canUpload && (
        <Button className="mt-5" variant="outline" onClick={() => uploadModalActions.openModal()}>
          <Plus className="mr-2 h-4 w-4" />
          Додати модель
        </Button>
      )}
    </div>
  );
}
