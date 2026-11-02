import { authorizeSessionResource } from "@/server/services/folder-access.service";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, modelFiles, modelVersions, models } from "@/lib/db";
import { CadPreviewError, prepareCadPreview } from "@/server/services/cad-preview.service";
import { storageService } from "@/server/services/storage";
import { getLiveSession } from "@/server/utils/live-session";
import { checkRateLimit } from "@/server/utils/rate-limit";
import { crossSiteBlockedResponse, isTrustedRequestOrigin } from "@/server/utils/request-security";

export const Route = createFileRoute("/api/cad-preview/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { fileId: string } }) => {
        if (!isTrustedRequestOrigin(request)) return crossSiteBlockedResponse();
        const session = await getLiveSession(request.headers);
        const organizationId = session?.session?.activeOrganizationId;
        if (!organizationId) return new Response("Unauthorized", { status: 401 });
        const folderDenial = await authorizeSessionResource(session, "file", params.fileId);
        if (folderDenial) return folderDenial;
        if (!z.uuid().safeParse(params.fileId).success) {
          return new Response("Invalid file ID", { status: 400 });
        }
        const rate = checkRateLimit(`cad-preview:${organizationId}`, { windowMs: 60_000, max: 30 });
        if (!rate.allowed) return new Response("Try again shortly", { status: 429 });
        const [file] = await db
          .select({
            id: modelFiles.id,
            size: modelFiles.size,
            storageKey: modelFiles.storageKey,
            extension: modelFiles.extension,
            organizationId: models.organizationId,
            modelId: models.id,
            version: modelVersions.version,
          })
          .from(modelFiles)
          .innerJoin(modelVersions, eq(modelFiles.versionId, modelVersions.id))
          .innerJoin(models, eq(models.id, modelVersions.modelId))
          .where(
            and(
              eq(modelFiles.id, params.fileId),
              eq(models.organizationId, organizationId),
              isNull(models.deletedAt),
            ),
          )
          .limit(1);
        if (!file || file.extension.toLowerCase() !== "sldprt") {
          return new Response("CAD source not found", { status: 404 });
        }
        try {
          const key = await prepareCadPreview(file);
          const stream = await storageService.getFileStream(key);
          return new Response(stream, {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": 'inline; filename="cad-preview.stl"',
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "private, no-store, max-age=0",
            },
          });
        } catch (error) {
          if (error instanceof CadPreviewError) {
            return Response.json({ error: error.message }, { status: error.status });
          }
          console.error("CAD preview preparation failed", { fileId: file.id });
          return new Response("Preview preparation failed", { status: 503 });
        }
      },
    },
  },
});
