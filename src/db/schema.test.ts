import { describe, it, expect } from "vitest";
import { users, worlds, likes, worldMedia, follows, comments, reposts, worldUpdates, reports, tags, worldTags } from "./schema";

describe("db schema exports", () => {
  it("exports the nine MVP tables", () => {
    expect(users).toBeDefined();
    expect(worlds).toBeDefined();
    expect(likes).toBeDefined();
    expect(worldMedia).toBeDefined();
    expect(follows).toBeDefined();
    expect(comments).toBeDefined();
    expect(reposts).toBeDefined();
    expect(worldUpdates).toBeDefined();
    expect(reports).toBeDefined();
  });

  it("exports the tags table with expected column shape", () => {
    expect(tags).toBeDefined();
    // Drizzle table objects expose their columns via the internal symbol key.
    // Assert the column names exist on the table's columns map.
    expect(tags.id).toBeDefined();
    expect(tags.name).toBeDefined();
    expect(tags.createdAt).toBeDefined();
  });

  it("exports the worldTags table with expected column shape", () => {
    expect(worldTags).toBeDefined();
    expect(worldTags.worldId).toBeDefined();
    expect(worldTags.tagId).toBeDefined();
    expect(worldTags.createdAt).toBeDefined();
  });
});
