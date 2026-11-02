import { createServerFn } from "@tanstack/react-start";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { account, db, member, user, organization } from "@/lib/db";
import { isLibraryAdmin } from "@/lib/folders";
import { authMiddleware, type AuthenticatedContext } from "@/server/middleware/auth";
import {
  createLibraryFolder,
  deleteEmptyLibraryFolder,
  getLibraryFolderAccess,
  listLibraryFolders,
  moveLibraryModel,
  setLibraryFolderGrant,
  updateLibraryFolder,
} from "@/server/services/folders.service";

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (name) =>
      name !== "." &&
      name !== ".." &&
      !/[\\/]/.test(name) &&
      !Array.from(name).some((character) => character.charCodeAt(0) < 32),
    "Некоректна назва теки",
  );
export const listFolders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }: { context: AuthenticatedContext }) => listLibraryFolders(context));
export const createFolder = createServerFn({ method: "POST" })
  .inputValidator(z.object({ name: nameSchema, parentId: z.uuid().nullable() }))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => createLibraryFolder(context, data.name, data.parentId));
export const updateFolder = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.uuid(),
      name: nameSchema.optional(),
      parentId: z.uuid().nullable().optional(),
      inheritPermissions: z.boolean().optional(),
    }),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => updateLibraryFolder(context, data));
export const deleteFolder = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.uuid() }))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => deleteEmptyLibraryFolder(context, data.id));
export const getFolderAccess = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.uuid() }))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => getLibraryFolderAccess(context, data.id));
export const setFolderGrant = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.uuid(),
      userId: z.string().min(1),
      role: z.enum(["viewer", "editor", "manager"]).nullable(),
    }),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }) =>
    setLibraryFolderGrant(context, data.id, data.userId, data.role),
  );
export const moveModelToFolder = createServerFn({ method: "POST" })
  .inputValidator(z.object({ modelId: z.uuid(), folderId: z.uuid().nullable() }))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => moveLibraryModel(context, data.modelId, data.folderId));

/** Controlled self-hosted provisioning, since public signup and email delivery are disabled. */
export const createLibraryUser = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().trim().min(1).max(160),
      email: z
        .email()
        .max(255)
        .transform((email) => email.toLowerCase()),
      password: z.string().min(12).max(128),
    }),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    if (!isLibraryAdmin(context))
      throw new Error("Створювати користувачів може лише адміністратор");
    const password = await hashPassword(data.password);
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, data.email))
        .limit(1);
      if (existing) {
        const [membership] = await tx
          .select({ id: member.id })
          .from(member)
          .where(
            and(eq(member.userId, existing.id), eq(member.organizationId, context.organizationId)),
          )
          .limit(1);
        if (membership) return { userId: existing.id, existing: true };
        throw new Error("Цю адресу вже використано іншим обліковим записом");
      }
      const userId = crypto.randomUUID();
      await tx
        .insert(user)
        .values({ id: userId, name: data.name, email: data.email, emailVerified: true });
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await tx.insert(member).values({
        id: crypto.randomUUID(),
        userId,
        organizationId: context.organizationId,
        role: "member",
        createdAt: new Date(),
      });
      await tx
        .update(organization)
        .set({
          currentMemberCount: sql`(SELECT count(*)::int FROM member WHERE organization_id = ${context.organizationId})`,
        })
        .where(eq(organization.id, context.organizationId));
      return { userId, existing: false };
    });
  });
