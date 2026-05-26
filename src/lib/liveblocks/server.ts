import "server-only"; // Throws if accidentally imported in client code
import { Liveblocks } from "@liveblocks/node";

// Lazy single instance — same pattern as r2.ts
let _client: Liveblocks | null = null;

export function getLiveblocksClient(): Liveblocks {
  if (_client) return _client;
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) {
    throw new Error("LIVEBLOCKS_SECRET_KEY env var is required");
  }
  _client = new Liveblocks({ secret });
  return _client;
}
