import { describe, it, expect } from "vitest";
import { users, worlds, likes, worldMedia } from "./schema";

describe("db schema exports", () => {
  it("exports the four MVP tables", () => {
    expect(users).toBeDefined();
    expect(worlds).toBeDefined();
    expect(likes).toBeDefined();
    expect(worldMedia).toBeDefined();
  });
});
