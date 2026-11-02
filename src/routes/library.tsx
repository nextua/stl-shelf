import { FolderBrowser } from "@/components/folders/folder-browser";
import { infiniteQueryOptions } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { listModels, type ModelListCursor } from "@/server/functions/models";
import { isConsentRequiredError } from "@/lib/consent-errors";
import { ModelGrid } from "@/components/models/model-grid";
import { SearchFilterBar } from "@/components/models/search-filter-bar";
import { useHasModels, hasModelsQueryOptions } from "@/hooks/use-has-models";
import { MODELS_QUERY_KEY } from "@/hooks/use-delete-model";
import { tagsQueryOptions } from "@/hooks/use-all-tags";
import { foldersQueryOptions, useLibraryFolders } from "@/hooks/use-library-folders";

// Search params schema for URL state
// Handle both string and array inputs (TanStack Router may parse [] as array)
export const librarySearchSchema = z.object({
  folder: z.uuid().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  // Handle both ?tags=a,b,c (string) and ?tags=a&tags=b (array) formats
  tags: z
    .union([
      z.array(z.string()).transform((arr) => arr.filter(Boolean).join(",") || undefined),
      z.string().transform((val) => val || undefined),
    ])
    .optional()
    .catch(undefined),
});

export type LibrarySearch = z.infer<typeof librarySearchSchema>;

// Parse tags string to array (handles comma-separated values)
const parseTags = (tagsString?: string): string[] | undefined => {
  if (!tagsString) return undefined;
  const tags = tagsString.split(",").filter(Boolean);
  return tags.length > 0 ? tags : undefined;
};

// Query options for models - used in both loader and hooks
export const modelsQueryOptions = (
  search?: string,
  tagsString?: string,
  folderId: string | null = null,
) => {
  const tags = parseTags(tagsString);
  return infiniteQueryOptions({
    queryKey: [...MODELS_QUERY_KEY, "infinite", { search, tags, limit: 12, folderId }],
    queryFn: ({ pageParam }) =>
      listModels({
        data: {
          cursor: pageParam,
          limit: 12,
          search: search || undefined,
          tags,
          folderId,
        },
      }),
    initialPageParam: undefined as ModelListCursor | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
};

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  validateSearch: librarySearchSchema,
  // Extract search params as loader dependencies
  loaderDeps: ({ search }) => ({
    q: search.q,
    folder: search.folder,
    tags: search.tags,
  }),
  loader: async ({ context, deps }) => {
    // Prefetch all queries for SSR - no loading states on initial render
    try {
      const directory = await context.queryClient.ensureQueryData(foldersQueryOptions());
      const canOpenFolder =
        !deps.folder || directory.folders.some((folder) => folder.id === deps.folder);
      await Promise.all([
        canOpenFolder &&
          context.queryClient.ensureInfiniteQueryData(
            modelsQueryOptions(deps.q, deps.tags, deps.folder ?? null),
          ),
        context.queryClient.ensureQueryData(tagsQueryOptions()),
        context.queryClient.ensureQueryData(hasModelsQueryOptions()),
      ]);
    } catch (error) {
      if (isConsentRequiredError(error)) {
        console.warn("Skipping /library SSR prefetch due to missing consent");
        return;
      }
      throw error;
    }
  },
  component: LibraryPage,
});

function LibraryPage() {
  const search = Route.useSearch();
  const { hasModels, isLoading } = useHasModels();
  const { data: directory } = useLibraryFolders();
  const canOpenFolder =
    !search.folder || directory?.folders.some((folder) => folder.id === search.folder);

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6">
        <h1 className="mb-2 font-bold text-3xl">Бібліотека</h1>
        <p className="text-muted-foreground">Проєкти, вкладені теки, файли та версії моделей.</p>
      </div>

      <div className="space-y-6">
        <FolderBrowser folderId={search.folder ?? null} />
        {canOpenFolder && !isLoading && hasModels && <SearchFilterBar />}
        {canOpenFolder && <ModelGrid />}
      </div>
    </div>
  );
}
