// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fileExists: vi.fn(),
  getFile: vi.fn(),
  uploadFile: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: { CAD_PREVIEW_URL: "http://converter:8080" } }));
vi.mock("@/server/services/storage", () => ({
  storageService: {
    ...mocks,
    getModelVersionRoot: (file: { organizationId: string; modelId: string; version: string }) =>
      [file.organizationId, file.modelId, file.version].join("/"),
  },
}));

import { cadPreviewKey, MAX_CAD_PREVIEW_BYTES, prepareCadPreview } from "./cad-preview.service";

const source = {
  id: "file-id",
  size: 100,
  storageKey: "org/model/v1/sources/original.sldprt",
  organizationId: "org",
  modelId: "model",
  version: "v1",
};
function stl() {
  const buffer = new ArrayBuffer(134);
  new DataView(buffer).setUint32(80, 1, true);
  return buffer;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fileExists.mockResolvedValue(false);
  mocks.getFile.mockResolvedValue({ body: new Uint8Array([1, 2, 3]) });
  mocks.uploadFile.mockResolvedValue({});
});

describe("CAD preview preparation", () => {
  it("serves the cached derivative without rereading or converting the original", async () => {
    mocks.fileExists.mockResolvedValue(true);
    expect(await prepareCadPreview(source)).toBe(cadPreviewKey(source));
    expect(mocks.getFile).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("stores the STL separately and leaves the source bytes unchanged", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    mocks.getFile.mockResolvedValue({ body: bytes });
    mocks.fetch.mockResolvedValue(new Response(stl()));
    const key = await prepareCadPreview(source);
    expect(key).toContain("/artifacts/cad-preview-v1-");
    expect(key).not.toBe(source.storageKey);
    expect(mocks.uploadFile).toHaveBeenCalledWith({
      key,
      file: expect.any(Uint8Array),
      contentType: "model/stl",
    });
    expect(Array.from(bytes)).toEqual([4, 5, 6]);
  });

  it("reports an unsupported source without writing an output and allows a later retry", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("unsupported", { status: 422 }));
    await expect(prepareCadPreview(source)).rejects.toMatchObject({ status: 422 });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValueOnce(new Response(stl()));
    await expect(prepareCadPreview(source)).resolves.toBe(cadPreviewKey(source));
  });

  it("deduplicates concurrent requests for the same source", async () => {
    let resolve!: (response: Response) => void;
    mocks.fetch.mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const first = prepareCadPreview(source);
    const second = prepareCadPreview(source);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    resolve(new Response(stl()));
    expect(await first).toBe(await second);
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid converted STL instead of caching it", async () => {
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array(90)));
    await expect(prepareCadPreview(source)).rejects.toMatchObject({ status: 422 });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("refuses an oversized source before reading storage", async () => {
    await expect(
      prepareCadPreview({ ...source, size: MAX_CAD_PREVIEW_BYTES + 1 }),
    ).rejects.toMatchObject({ status: 413 });
    expect(mocks.getFile).not.toHaveBeenCalled();
  });
});
