import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting
//
// vi.hoisted() runs synchronously before any import resolves. Every value
// referenced inside a vi.mock() factory must come from here.
// ---------------------------------------------------------------------------

const {
  // Spy on the terminal .values() call in the insert chain.
  // db.insert(notifications).values(input) is the only DB write notify() / notifyMany()
  // performs. We intercept .values() to:
  //   1. Verify the correct data was passed (happy path)
  //   2. Simulate a DB throw (error-swallowing tests)
  //   3. Assert it was NOT called (self-notification suppression tests)
  mockDbInsertValues,
} = vi.hoisted(() => ({
  mockDbInsertValues: vi.fn(),
}));

// Mock @/db — real DB connections require DATABASE_URL + a live Neon instance.
//
// notify() / notifyMany() each call: db.insert(notifications).values(...)
// We mock the full builder chain so the terminal .values() call is
// interceptable via mockDbInsertValues.
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (...args: unknown[]) => mockDbInsertValues(...args),
    }),
  },
}));

// Import helpers AFTER mocks are registered.
import { notify, notifyMany } from "./notifications";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";
const USER_C = "cccccccc-0000-0000-0000-000000000003";
const WORLD_ID = "dddddddd-0000-0000-0000-000000000004";
const COMMENT_ID = "eeeeeeee-0000-0000-0000-000000000005";

// ============================================================================
// notify() — basic insert
// ============================================================================

describe("notify() — inserts a row with correct fields", () => {
  beforeEach(() => vi.resetAllMocks());

  it("inserts the correct userId, type, actorId, worldId, commentId", async () => {
    mockDbInsertValues.mockResolvedValue(undefined);

    await notify({
      userId: USER_A,
      type: "like",
      actorId: USER_B,
      worldId: WORLD_ID,
      commentId: null,
    });

    expect(mockDbInsertValues).toHaveBeenCalledOnce();
    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_A,
        type: "like",
        actorId: USER_B,
        worldId: WORLD_ID,
        commentId: null,
      })
    );
  });

  it("sends null for omitted optional fields (actorId, worldId, commentId)", async () => {
    mockDbInsertValues.mockResolvedValue(undefined);

    await notify({ userId: USER_A, type: "follow" });

    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_A,
        type: "follow",
        actorId: null,
        worldId: null,
        commentId: null,
      })
    );
  });
});

// ============================================================================
// notify() — self-notification suppression
// ============================================================================

describe("notify() — suppresses self-notifications", () => {
  beforeEach(() => vi.resetAllMocks());

  it("does not call db.insert when userId === actorId", async () => {
    await notify({ userId: USER_A, type: "like", actorId: USER_A, worldId: WORLD_ID });

    // No insert should happen — self-notifications are suppressed
    expect(mockDbInsertValues).not.toHaveBeenCalled();
  });

  it("does call db.insert when userId differs from actorId", async () => {
    mockDbInsertValues.mockResolvedValue(undefined);

    await notify({ userId: USER_A, type: "like", actorId: USER_B, worldId: WORLD_ID });

    expect(mockDbInsertValues).toHaveBeenCalledOnce();
  });

  it("calls db.insert when actorId is null (no actor — not a self-notification)", async () => {
    mockDbInsertValues.mockResolvedValue(undefined);

    await notify({ userId: USER_A, type: "follow", actorId: null });

    expect(mockDbInsertValues).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// notify() — error swallowing
// ============================================================================

describe("notify() — swallows DB errors", () => {
  beforeEach(() => vi.resetAllMocks());

  it("does not throw when the DB insert fails", async () => {
    mockDbInsertValues.mockRejectedValue(new Error("DB offline"));

    // Must not throw
    await expect(
      notify({ userId: USER_A, type: "like", actorId: USER_B })
    ).resolves.toBeUndefined();
  });

  it("logs the error to console.error when the DB insert fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDbInsertValues.mockRejectedValue(new Error("Connection timeout"));

    await notify({ userId: USER_A, type: "comment", actorId: USER_B });

    expect(consoleSpy).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});

// ============================================================================
// notifyMany() — bulk insert
// ============================================================================

describe("notifyMany() — inserts multiple rows in a single call", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls db.insert once with all input rows", async () => {
    mockDbInsertValues.mockResolvedValue(undefined);

    await notifyMany([
      { userId: USER_A, type: "like", actorId: USER_B, worldId: WORLD_ID },
      { userId: USER_B, type: "comment", actorId: USER_C, worldId: WORLD_ID, commentId: COMMENT_ID },
      { userId: USER_C, type: "follow", actorId: USER_A },
    ]);

    // One bulk insert, not three individual inserts
    expect(mockDbInsertValues).toHaveBeenCalledOnce();
    // The values array should have 3 entries
    const insertedRows = mockDbInsertValues.mock.calls[0][0];
    expect(Array.isArray(insertedRows)).toBe(true);
    expect(insertedRows).toHaveLength(3);
  });
});

// ============================================================================
// notifyMany() — self-actor filtering
// ============================================================================

describe("notifyMany() — filters self-actor entries before inserting", () => {
  beforeEach(() => vi.resetAllMocks());

  it("filters out the self-actor entry and inserts only 2 of 3 rows", async () => {
    mockDbInsertValues.mockResolvedValue(undefined);

    await notifyMany([
      { userId: USER_A, type: "like", actorId: USER_B },          // valid
      { userId: USER_C, type: "follow", actorId: USER_C },         // self → filtered
      { userId: USER_B, type: "comment", actorId: USER_A },        // valid
    ]);

    expect(mockDbInsertValues).toHaveBeenCalledOnce();
    const insertedRows = mockDbInsertValues.mock.calls[0][0];
    expect(insertedRows).toHaveLength(2);
  });

  it("does not call db.insert at all when every input is a self-actor entry", async () => {
    await notifyMany([
      { userId: USER_A, type: "like", actorId: USER_A },
      { userId: USER_B, type: "follow", actorId: USER_B },
      { userId: USER_C, type: "comment", actorId: USER_C },
    ]);

    expect(mockDbInsertValues).not.toHaveBeenCalled();
  });

  it("does not call db.insert on empty input array", async () => {
    await notifyMany([]);

    expect(mockDbInsertValues).not.toHaveBeenCalled();
  });
});

// ============================================================================
// notifyMany() — error swallowing
// ============================================================================

describe("notifyMany() — swallows bulk insert errors", () => {
  beforeEach(() => vi.resetAllMocks());

  it("does not throw when the bulk insert fails", async () => {
    mockDbInsertValues.mockRejectedValue(new Error("Bulk insert failed"));

    await expect(
      notifyMany([
        { userId: USER_A, type: "like", actorId: USER_B },
        { userId: USER_C, type: "follow", actorId: USER_A },
      ])
    ).resolves.toBeUndefined();
  });

  it("logs the error to console.error when the bulk insert fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDbInsertValues.mockRejectedValue(new Error("Timeout"));

    await notifyMany([
      { userId: USER_A, type: "new_world", actorId: USER_B, worldId: WORLD_ID },
    ]);

    expect(consoleSpy).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});
