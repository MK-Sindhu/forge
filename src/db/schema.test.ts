import { describe, it, expect } from "vitest";
import { users, worlds, likes, worldMedia, follows } from "./schema";

describe("db schema exports", () => {
  it("exports the five MVP tables", () => {
    expect(users).toBeDefined();
    expect(worlds).toBeDefined();
    expect(likes).toBeDefined();
    expect(worldMedia).toBeDefined();
    expect(follows).toBeDefined();
  });
});
