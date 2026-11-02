import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  Home,
  Loader2,
  Pencil,
  Share2,
  Trash2,
  Upload,
  FolderInput,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLibraryFolders, type LibraryFolder } from "@/hooks/use-library-folders";
import { createFolder, deleteFolder, updateFolder } from "@/server/functions/folders";
import { createModel } from "@/server/functions/models";
import { FolderAccessDialog } from "./folder-access-dialog";
import { FolderPicker } from "./folder-picker";

export function FolderBrowser({ folderId }: { folderId: string | null }) {
  const { data, isLoading, error } = useLibraryFolders();
  const folders = data?.folders ?? [];
  const current = folders.find((folder) => folder.id === folderId);
  const level = folderId ? (current?.accessLevel ?? 0) : data?.canManageLibrary ? 3 : 0;
  const children = folders
    .filter((folder) => folder.navigationParentId === folderId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const [dialog, setDialog] = useState<"create" | "rename" | "move" | "delete" | null>(null);
  const [accessFolder, setAccessFolder] = useState<LibraryFolder | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [pending, setPending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const navigate = useNavigate();
  const breadcrumbs: LibraryFolder[] = [];
  const seen = new Set<string>();
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  let node = current;
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    breadcrumbs.push(node);
    node = node.navigationParentId ? folderById.get(node.navigationParentId) : undefined;
  }
  breadcrumbs.reverse();
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["library-folders"] }),
      client.invalidateQueries({ queryKey: ["models"] }),
    ]);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      if (dialog === "create") await createFolder({ data: { name, parentId: folderId } });
      if (dialog === "rename" && current) await updateFolder({ data: { id: current.id, name } });
      if (dialog === "move" && current)
        await updateFolder({ data: { id: current.id, parentId: target || null } });
      if (dialog === "delete" && current) {
        await deleteFolder({ data: { id: current.id } });
        await navigate({
          to: "/library",
          search: { folder: current.navigationParentId ?? undefined },
        });
      }
      await refresh();
      setDialog(null);
      toast.success("Збережено");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Не вдалося зберегти");
    } finally {
      setPending(false);
    }
  };
  const upload = async (files: File[]) => {
    let completed = 0;
    try {
      for (const file of files) {
        if (file.size > 100 * 1024 * 1024)
          throw new Error(file.name + ": максимальний розмір — 100 МБ");
        setUploadProgress(completed + 1 + " / " + files.length);
        const form = new FormData();
        form.append("name", file.name.slice(0, 200));
        form.append("files", file);
        if (folderId) form.append("folderId", folderId);
        await createModel({ data: form });
        completed++;
      }
      toast.success("Завантажено файлів: " + completed);
    } catch (cause) {
      toast.error(
        (cause instanceof Error ? cause.message : "Помилка завантаження") +
          (completed ? ". Вже збережено: " + completed : ""),
      );
    } finally {
      setUploadProgress(null);
      if (fileInput.current) fileInput.current.value = "";
      await refresh();
    }
  };

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <nav
        aria-label="Шлях до теки"
        className="flex items-center gap-2 overflow-x-auto pb-1 text-sm"
      >
        <Link
          className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
          to="/library"
          search={{}}
        >
          <Home className="h-4 w-4" />
          Бібліотека
        </Link>
        {breadcrumbs.map((folder) => (
          <span className="flex shrink-0 items-center gap-2" key={folder.id}>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <Link to="/library" search={{ folder: folder.id }}>
              {folder.name}
            </Link>
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{current?.name ?? "Проєкти та теки"}</h2>
          <p className="text-xs text-muted-foreground">
            {folderId
              ? level >= 3
                ? "Керування"
                : level >= 2
                  ? "Редагування"
                  : "Перегляд"
              : "Теки, до яких ви маєте доступ"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {level >= 2 && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setName("");
                  setDialog("create");
                }}
              >
                <FolderPlus className="mr-2 h-4 w-4" />
                Створити теку
              </Button>
              <Button
                size="sm"
                disabled={Boolean(uploadProgress)}
                onClick={() => fileInput.current?.click()}
              >
                {uploadProgress ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {uploadProgress ?? "Завантажити файли"}
              </Button>
              <input
                className="hidden"
                ref={fileInput}
                type="file"
                multiple
                onChange={(event) => {
                  if (event.target.files) void upload(Array.from(event.target.files));
                }}
              />
            </>
          )}
          {current && level >= 3 && (
            <>
              <Button size="sm" variant="outline" onClick={() => setAccessFolder(current)}>
                <Share2 className="mr-2 h-4 w-4" />
                Доступ
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Перейменувати теку"
                title="Перейменувати"
                onClick={() => {
                  setName(current.name);
                  setDialog("rename");
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Перемістити теку"
                title="Перемістити"
                onClick={() => {
                  setTarget(current.parentId ?? "");
                  setDialog("move");
                }}
              >
                <FolderInput className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Видалити порожню теку"
                title="Видалити порожню теку"
                onClick={() => setDialog("delete")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Завантаження тек…</p>}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {folderId && !isLoading && !current && (
        <p className="text-sm text-destructive">Теку не знайдено або немає доступу.</p>
      )}
      {children.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {children.map((folder) => (
            <Link
              key={folder.id}
              to="/library"
              search={{ folder: folder.id }}
              className="group flex min-w-0 items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/60"
            >
              <Folder className="h-8 w-8 shrink-0 text-brand" />
              <div className="min-w-0">
                <p className="truncate font-medium">{folder.name}</p>
                <p className="text-xs text-muted-foreground">
                  {folder.accessLevel >= 3
                    ? "Керування"
                    : folder.accessLevel >= 2
                      ? "Редагування"
                      : "Перегляд"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
      {!isLoading && !children.length && (
        <p className="text-sm text-muted-foreground">
          {folderId ? "Підтек поки немає." : "Доступних тек поки немає."}
        </p>
      )}
      {accessFolder && (
        <FolderAccessDialog
          folder={folders.find((folder) => folder.id === accessFolder.id) ?? accessFolder}
          onClose={() => setAccessFolder(null)}
        />
      )}
      <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <form className="space-y-4" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>
                {dialog === "create"
                  ? "Створити теку"
                  : dialog === "rename"
                    ? "Перейменувати теку"
                    : dialog === "move"
                      ? "Перемістити теку"
                      : "Видалити порожню теку?"}
              </DialogTitle>
              <DialogDescription>
                {dialog === "delete"
                  ? "Видалити можна лише теку без файлів і підтек."
                  : dialog === "move"
                    ? "Успадковані права зміняться відповідно до нової батьківської теки."
                    : "Назва теки всередині поточного розділу."}
              </DialogDescription>
            </DialogHeader>
            {(dialog === "create" || dialog === "rename") && (
              <Input
                aria-label="Назва теки"
                required
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
            {dialog === "move" && current && (
              <FolderPicker value={target} onChange={setTarget} excludeId={current.id} />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Скасувати
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Збереження…" : dialog === "delete" ? "Видалити" : "Зберегти"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
