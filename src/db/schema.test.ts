import { describe, it, expect } from "vitest";
import { users, worlds, likes } from "./schema";

describe("db schema exports", () => {
  it("exports the three MVP tables", () => {
    expect(users).toBeDefined();
    expect(worlds).toBeDefined();
    expect(likes).toBeDefined();
  });
});
