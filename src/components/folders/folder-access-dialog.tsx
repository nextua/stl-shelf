import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LibraryFolder } from "@/hooks/use-library-folders";
import type { FolderRole } from "@/lib/folders";
import {
  createLibraryUser,
  getFolderAccess,
  setFolderGrant,
  updateFolder,
} from "@/server/functions/folders";

export function FolderAccessDialog({
  folder,
  onClose,
}: {
  folder: LibraryFolder;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["folder-access", folder.id],
    queryFn: () => getFolderAccess({ data: { id: folder.id } }),
  });
  const [pending, setPending] = useState(false);
  const [createUser, setCreateUser] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["folder-access", folder.id] }),
      client.invalidateQueries({ queryKey: ["library-folders"] }),
      client.invalidateQueries({ queryKey: ["models"] }),
      client.invalidateQueries({ queryKey: ["model"] }),
    ]);
  };
  const perform = async (action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Не вдалося змінити доступ");
    } finally {
      setPending(false);
    }
  };
  const provision = async (event: React.FormEvent) => {
    event.preventDefault();
    await perform(async () => {
      const created = await createLibraryUser({ data: { name, email, password } });
      await setFolderGrant({ data: { id: folder.id, userId: created.userId, role: "viewer" } });
      setName("");
      setEmail("");
      setPassword("");
      setCreateUser(false);
      toast.success(
        created.existing
          ? "Доступ надано; пароль існуючого користувача не змінено"
          : "Користувача створено з доступом на перегляд",
      );
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Доступ до «{folder.name}»</DialogTitle>
          <DialogDescription>
            Перегляд дозволяє читати й скачувати; редагування — додавати файли та версії; керування
            — також змінювати доступ і переміщувати вміст.
          </DialogDescription>
        </DialogHeader>
        {folder.parentId && (
          <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              disabled={pending}
              checked={folder.inheritPermissions}
              onChange={(event) =>
                perform(() =>
                  updateFolder({
                    data: { id: folder.id, inheritPermissions: event.target.checked },
                  }),
                )
              }
            />
            <span>
              Успадковувати доступ батьківської теки
              <span className="mt-1 block text-xs text-muted-foreground">
                Якщо вимкнути, діятимуть лише окремі дозволи цієї теки. Адміністратори зберігають
                повний доступ.
              </span>
            </span>
          </label>
        )}
        {error && <p className="text-destructive">{error.message}</p>}
        {!data && !error && <p>Завантаження…</p>}
        <div className="space-y-2">
          {data?.members.map((person) => {
            const admin = ["owner", "admin"].includes(person.organizationRole);
            const grant = data.grants.find((item) => item.userId === person.userId);
            return (
              <div
                key={person.userId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{person.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{person.email}</p>
                </div>
                {admin ? (
                  <span className="text-xs text-muted-foreground">
                    Повний доступ адміністратора
                  </span>
                ) : (
                  <select
                    aria-label={"Доступ для " + person.email}
                    className="rounded-md border bg-background p-2 text-sm"
                    value={grant?.role ?? "none"}
                    disabled={pending}
                    onChange={(event) =>
                      perform(() =>
                        setFolderGrant({
                          data: {
                            id: folder.id,
                            userId: person.userId,
                            role:
                              event.target.value === "none"
                                ? null
                                : (event.target.value as FolderRole),
                          },
                        }),
                      )
                    }
                  >
                    <option value="none">Немає окремого дозволу</option>
                    <option value="viewer">Перегляд</option>
                    <option value="editor">Редагування</option>
                    <option value="manager">Керування</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Успадковані права додаються до окремих дозволів. Щоб обмежити доступ до підтеки, вимкніть
          успадкування.
        </p>
        {data?.canCreateUsers && (
          <div className="border-t pt-4">
            {!createUser ? (
              <Button variant="outline" onClick={() => setCreateUser(true)}>
                Створити користувача
              </Button>
            ) : (
              <form className="space-y-3" onSubmit={provision}>
                <p className="text-sm font-medium">Новий користувач</p>
                <Input
                  aria-label="Ім’я користувача"
                  placeholder="Ім’я"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={160}
                />
                <Input
                  aria-label="Email користувача"
                  placeholder="Email для входу"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                <Input
                  aria-label="Пароль користувача"
                  placeholder="Пароль: щонайменше 12 символів"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Передайте користувачу логін і пароль самостійно. Лист не надсилається.
                </p>
                <div className="flex gap-2">
                  <Button disabled={pending} type="submit">
                    Створити з доступом на перегляд
                  </Button>
                  <Button variant="outline" type="button" onClick={() => setCreateUser(false)}>
                    Скасувати
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
