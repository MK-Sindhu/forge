import { describe, it, expect } from "vitest";
import { users, worlds, likes, worldMedia, follows, comments, reposts, worldUpdates } from "./schema";

describe("db schema exports", () => {
  it("exports the eight MVP tables", () => {
    expect(users).toBeDefined();
    expect(worlds).toBeDefined();
    expect(likes).toBeDefined();
    expect(worldMedia).toBeDefined();
    expect(follows).toBeDefined();
    expect(comments).toBeDefined();
    expect(reposts).toBeDefined();
    expect(worldUpdates).toBeDefined();
  });
});
