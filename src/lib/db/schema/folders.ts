import {
  boolean,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization, user } from "./auth";

export const folderRole = pgEnum("folder_role", ["viewer", "editor", "manager"]);

export const libraryFolders = pgTable(
  "library_folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    inheritPermissions: boolean("inherit_permissions").notNull().default(true),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("library_folders_id_org_uidx").on(table.id, table.organizationId),
    uniqueIndex("library_folders_root_name_uidx")
      .on(table.organizationId, table.name)
      .where(sql`${table.parentId} IS NULL AND ${table.deletedAt} IS NULL`),
    uniqueIndex("library_folders_child_name_uidx")
      .on(table.organizationId, table.parentId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    index("library_folders_parent_idx").on(table.organizationId, table.parentId),
    foreignKey({
      name: "library_folders_parent_org_fk",
      columns: [table.parentId, table.organizationId],
      foreignColumns: [table.id, table.organizationId],
    }),
  ],
);

export const folderGrants = pgTable(
  "folder_grants",
  {
    folderId: uuid("folder_id")
      .notNull()
      .references(() => libraryFolders.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: folderRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.folderId, table.userId] }),
    index("folder_grants_user_idx").on(table.userId),
  ],
);
