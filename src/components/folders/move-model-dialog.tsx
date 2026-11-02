import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { moveModelToFolder } from "@/server/functions/folders";
import { FolderPicker } from "./folder-picker";

export function MoveModelDialog({
  modelId,
  currentFolderId,
  open,
  onOpenChange,
}: {
  modelId: string;
  currentFolderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [target, setTarget] = useState(currentFolderId ?? "");
  const [pending, setPending] = useState(false);
  const client = useQueryClient();
  const move = async () => {
    setPending(true);
    try {
      await moveModelToFolder({ data: { modelId, folderId: target || null } });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["models"] }),
        client.invalidateQueries({ queryKey: ["model", modelId] }),
      ]);
      toast.success("Переміщено");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не вдалося перемістити");
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Перемістити до теки</DialogTitle>
          <DialogDescription>
            Після переміщення діятимуть права доступу нової теки.
          </DialogDescription>
        </DialogHeader>
        <FolderPicker value={target} onChange={setTarget} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Скасувати
          </Button>
          <Button disabled={pending} onClick={move}>
            {pending ? "Переміщення…" : "Перемістити"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
