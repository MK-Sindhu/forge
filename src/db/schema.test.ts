import { describe, it, expect } from "vitest";
import { users, worlds, likes, worldMedia, follows, comments, reposts } from "./schema";

describe("db schema exports", () => {
  it("exports the seven MVP tables", () => {
    expect(users).toBeDefined();
    expect(worlds).toBeDefined();
    expect(likes).toBeDefined();
    expect(worldMedia).toBeDefined();
    expect(follows).toBeDefined();
    expect(comments).toBeDefined();
    expect(reposts).toBeDefined();
  });
});
