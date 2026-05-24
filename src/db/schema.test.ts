import { describe, it, expect } from "vitest";
import { users, worlds, likes, worldMedia, follows, comments, reposts, worldUpdates, reports, tags, worldTags, worldViews, notifications } from "./schema";

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

  it("exports the worldViews table with expected column shape", () => {
    expect(worldViews).toBeDefined();
    expect(worldViews.viewerId).toBeDefined();
    expect(worldViews.worldId).toBeDefined();
    expect(worldViews.day).toBeDefined();
    expect(worldViews.createdAt).toBeDefined();
  });

  it("exports the notifications table with expected column shape", () => {
    expect(notifications).toBeDefined();
    expect(notifications.id).toBeDefined();
    expect(notifications.userId).toBeDefined();
    expect(notifications.type).toBeDefined();
    expect(notifications.actorId).toBeDefined();
    expect(notifications.worldId).toBeDefined();
    expect(notifications.commentId).toBeDefined();
    expect(notifications.createdAt).toBeDefined();
    expect(notifications.readAt).toBeDefined();
  });
});
