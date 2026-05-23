import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock hoisting: these refs must be available before any import resolves.
const { mockAuth, mockCurrentUser, mockSelectLimit, mockInsertReturning } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockCurrentUser: vi.fn(),
    mockSelectLimit: vi.fn(),
    mockInsertReturning: vi.fn(),
  }));

// Mock @clerk/nextjs/server — external boundary; we never want real Clerk calls.
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

// Mock @/db — external boundary (real DB connection would require Neon credentials
// and a running database; both are unavailable in the test environment).
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockSelectLimit(...args),
        }),
      }),
    }),
    insert: () => ({
      values: (payload: unknown) => ({
        returning: (...args: unknown[]) => mockInsertReturning(payload, ...args),
      }),
    }),
  },
}));

// Import the handler AFTER mocks are registered so it receives the mocked deps.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const EXISTING_USER_ROW = {
  id: "uuid-existing",
  clerkId: "clerk_existing_001",
  username: "alice",
  email: "alice@example.com",
  avatarUrl: "https://example.com/alice.png",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const CLERK_USER_FULL = {
  id: "clerk_new_002",
  username: "bob",
  emailAddresses: [{ emailAddress: "bob@example.com" }],
  imageUrl: "https://example.com/bob.png",
};

const INSERTED_USER_ROW = {
  id: "uuid-new",
  clerkId: "clerk_new_002",
  username: "bob",
  email: "bob@example.com",
  avatarUrl: "https://example.com/bob.png",
  createdAt: new Date("2026-05-23T00:00:00Z"),
};

// ---------------------------------------------------------------------------
describe("GET /api/me", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Scenario 1 ----------------------------------------------------------------
  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  // Scenario 2 ----------------------------------------------------------------
  it("returns 200 with the existing row when the user already exists in the DB", async () => {
    mockAuth.mockResolvedValue({ userId: EXISTING_USER_ROW.clerkId });
    // currentUser() is called by the refactored route before delegating to the helper.
    mockCurrentUser.mockResolvedValue({
      id: EXISTING_USER_ROW.clerkId,
      username: EXISTING_USER_ROW.username,
      emailAddresses: [{ emailAddress: EXISTING_USER_ROW.email }],
      imageUrl: EXISTING_USER_ROW.avatarUrl,
    });
    // SELECT returns the pre-existing row.
    mockSelectLimit.mockResolvedValue([EXISTING_USER_ROW]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    // The response must include at minimum the identifying fields.
    expect(body.clerkId).toBe(EXISTING_USER_ROW.clerkId);
    expect(body.email).toBe(EXISTING_USER_ROW.email);
    expect(body.username).toBe(EXISTING_USER_ROW.username);
  });

  // Scenario 3 ----------------------------------------------------------------
  it("inserts a new row and returns 200 when no DB row exists yet", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_FULL.id });
    // SELECT finds nothing.
    mockSelectLimit.mockResolvedValue([]);
    mockCurrentUser.mockResolvedValue(CLERK_USER_FULL);
    // INSERT returns the new row wrapped in an array (Drizzle .returning() shape).
    mockInsertReturning.mockResolvedValue([INSERTED_USER_ROW]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.clerkId).toBe(INSERTED_USER_ROW.clerkId);
    expect(body.email).toBe(INSERTED_USER_ROW.email);
    expect(body.username).toBe(INSERTED_USER_ROW.username);

    // The INSERT must have been called with the correct payload derived from
    // the Clerk user — this is the contract between /api/me and the DB.
    expect(mockInsertReturning).toHaveBeenCalledOnce();
    const [insertedPayload] = mockInsertReturning.mock.calls[0];
    expect(insertedPayload).toMatchObject({
      clerkId: CLERK_USER_FULL.id,
      email: CLERK_USER_FULL.emailAddresses[0].emailAddress,
      avatarUrl: CLERK_USER_FULL.imageUrl,
    });
    // username must be present (derived from Clerk username or email prefix).
    expect(typeof insertedPayload.username).toBe("string");
    expect(insertedPayload.username.length).toBeGreaterThan(0);
  });

  // Scenario 4 ----------------------------------------------------------------
  it("does not call DB insert on second call when user already exists (idempotent)", async () => {
    mockAuth.mockResolvedValue({ userId: EXISTING_USER_ROW.clerkId });
    // currentUser() is called by the refactored route before delegating to the helper.
    mockCurrentUser.mockResolvedValue({
      id: EXISTING_USER_ROW.clerkId,
      username: EXISTING_USER_ROW.username,
      emailAddresses: [{ emailAddress: EXISTING_USER_ROW.email }],
      imageUrl: EXISTING_USER_ROW.avatarUrl,
    });
    // Both calls return the existing row.
    mockSelectLimit.mockResolvedValue([EXISTING_USER_ROW]);

    await GET();
    await GET();

    // INSERT must never have been called.
    expect(mockInsertReturning).not.toHaveBeenCalled();
    // SELECT was called once per GET invocation.
    expect(mockSelectLimit).toHaveBeenCalledTimes(2);
  });

  // Scenario 5 ----------------------------------------------------------------
  it("returns 400 when the Clerk user has no email addresses, and does not insert", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_no_email_003" });
    // SELECT finds nothing — user does not exist in DB yet.
    mockSelectLimit.mockResolvedValue([]);
    // Clerk user exists but has an empty emailAddresses array.
    mockCurrentUser.mockResolvedValue({
      id: "clerk_no_email_003",
      username: null,
      emailAddresses: [],
      imageUrl: null,
    });

    const response = await GET();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No email on Clerk user" });
    // The spec explicitly requires that INSERT is NOT called in this case.
    expect(mockInsertReturning).not.toHaveBeenCalled();
  });
});
