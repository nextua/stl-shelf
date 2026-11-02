import { env } from "@/lib/env";
import { storageService } from "@/server/services/storage";

export const MAX_CAD_PREVIEW_BYTES = 40 * 1024 * 1024;
const inFlight = new Map<string, Promise<string>>();

export type CadPreviewSource = {
  id: string;
  size: number;
  storageKey: string;
  organizationId: string;
  modelId: string;
  version: string;
};

export class CadPreviewError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function cadPreviewKey(file: CadPreviewSource): string {
  const root = storageService.getModelVersionRoot(file);
  return `${root}/artifacts/cad-preview-v1-${file.id}.stl`;
}

async function convert(file: CadPreviewSource): Promise<string> {
  const key = cadPreviewKey(file);
  if (await storageService.fileExists(key)) return key;

  const source = await storageService.getFile(file.storageKey);
  if (source.body.byteLength > MAX_CAD_PREVIEW_BYTES) {
    throw new CadPreviewError("CAD preview files must be smaller than 40 MiB.", 413);
  }
  let response: Response;
  try {
    response = await fetch(new URL("/convert", env.CAD_PREVIEW_URL), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: source.body as Uint8Array<ArrayBuffer>,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new CadPreviewError("CAD preview preparation is temporarily unavailable.", 503);
  }
  if (!response.ok) {
    if (response.status === 422) {
      throw new CadPreviewError(
        "This part has no supported saved display mesh. Attach an STL or OBJ exported from SolidWorks.",
        422,
      );
    }
    throw new CadPreviewError("CAD preview preparation is busy. Please try again shortly.", 503);
  }
  const preview = new Uint8Array(await response.arrayBuffer());
  if (preview.byteLength < 84 || preview.byteLength > MAX_CAD_PREVIEW_BYTES) {
    throw new CadPreviewError("The converted preview is too large or invalid.", 422);
  }
  const triangles = new DataView(preview.buffer).getUint32(80, true);
  if (triangles === 0 || preview.byteLength !== 84 + triangles * 50) {
    throw new CadPreviewError("The converted preview is not a valid binary STL.", 422);
  }
  await storageService.uploadFile({ key, file: preview, contentType: "model/stl" });
  return key;
}

export async function prepareCadPreview(file: CadPreviewSource): Promise<string> {
  if (!env.CAD_PREVIEW_URL) throw new CadPreviewError("CAD preview is not configured.", 503);
  if (file.size > MAX_CAD_PREVIEW_BYTES) {
    throw new CadPreviewError("CAD browser previews support source files up to 40 MiB.", 413);
  }
  const existing = inFlight.get(file.id);
  if (existing) return existing;
  const pending = convert(file);
  inFlight.set(file.id, pending);
  try {
    return await pending;
  } finally {
    inFlight.delete(file.id);
  }
}
