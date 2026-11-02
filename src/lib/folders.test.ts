import { describe, expect, it } from "vitest";
import {
  resolveFolderLevels,
  wouldCreateFolderCycle,
  type FolderActor,
  type FolderNode,
} from "./folders";

const actor: FolderActor = { organizationId: "org", userId: "reader", memberRole: "member" };
const tree: FolderNode[] = [
  { id: "project", parentId: null, inheritPermissions: true },
  { id: "parts", parentId: "project", inheritPermissions: true },
  { id: "private", parentId: "parts", inheritPermissions: false },
  { id: "private-child", parentId: "private", inheritPermissions: true },
];
describe("nested folder authorization", () => {
  it("inherits a project grant through descendants and stops at an independent subtree", () => {
    const levels = resolveFolderLevels(
      tree,
      [{ folderId: "project", userId: "reader", role: "editor" }],
      actor,
    );
    expect([...levels.values()]).toEqual([2, 2, 0, 0]);
  });
  it("allows a direct grant on a private subtree without revealing its parent", () => {
    const levels = resolveFolderLevels(
      tree,
      [{ folderId: "private", userId: "reader", role: "viewer" }],
      actor,
    );
    expect([...levels.values()]).toEqual([0, 0, 1, 1]);
  });
  it("does not downgrade inherited access when a lower direct role is added", () => {
    const levels = resolveFolderLevels(
      tree,
      [
        { folderId: "project", userId: "reader", role: "manager" },
        { folderId: "parts", userId: "reader", role: "viewer" },
      ],
      actor,
    );
    expect(levels.get("parts")).toBe(3);
  });
  it("ignores other users' grants", () => {
    expect(
      resolveFolderLevels(
        tree,
        [{ folderId: "project", userId: "someone-else", role: "manager" }],
        actor,
      ).get("parts"),
    ).toBe(0);
  });
  it("keeps the organization's owner in control of independent subfolders", () => {
    expect([...resolveFolderLevels(tree, [], { ...actor, memberRole: "owner" }).values()]).toEqual([
      3, 3, 3, 3,
    ]);
  });
  it("handles ten thousand levels without recursion or a configured depth cap", () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => ({
      id: String(index),
      parentId: index ? String(index - 1) : null,
      inheritPermissions: true,
    }));
    const levels = resolveFolderLevels(
      nodes.reverse(),
      [{ folderId: "0", userId: "reader", role: "viewer" }],
      actor,
    );
    expect(levels.size).toBe(10_000);
    expect(levels.get("9999")).toBe(1);
  });
  it("rejects moves into the same folder or a descendant", () => {
    expect(wouldCreateFolderCycle(tree, "project", "private-child")).toBe(true);
    expect(wouldCreateFolderCycle(tree, "parts", "parts")).toBe(true);
    expect(wouldCreateFolderCycle(tree, "private", "project")).toBe(false);
    expect(wouldCreateFolderCycle(tree, "parts", null)).toBe(false);
  });
  it("fails closed if malformed data contains a cycle", () => {
    expect(() =>
      resolveFolderLevels(
        [
          { id: "a", parentId: "b", inheritPermissions: true },
          { id: "b", parentId: "a", inheritPermissions: true },
        ],
        [],
        actor,
      ),
    ).toThrow("cycle");
  });
});
