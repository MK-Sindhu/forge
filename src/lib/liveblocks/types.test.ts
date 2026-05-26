/**
 * types.test.ts — unit tests for liveblocks/types.ts
 *
 * worldRoomId is a pure function — no mocks needed.
 */

import { describe, it, expect } from "vitest";
import { worldRoomId } from "./types";

describe("worldRoomId", () => {
  it("returns world:<uuid> for the given worldId", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(worldRoomId(uuid)).toBe(`world:${uuid}`);
  });

  it("works for any arbitrary string worldId (not just uuids)", () => {
    expect(worldRoomId("abc")).toBe("world:abc");
    expect(worldRoomId("")).toBe("world:");
  });
});
