import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import { neon, Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL not set");
}

// ---------------------------------------------------------------------------
// HTTP client — used for all single-query routes.
// Faster cold starts; no persistent connection.
// Schema is passed so db.query.* (relational query API) is available.
// ---------------------------------------------------------------------------
const sql = neon(url);
export const db = drizzleHttp({ client: sql, schema });

// ---------------------------------------------------------------------------
// WebSocket pool client — used for routes that need transactions (.transaction()).
// The HTTP driver does not support Drizzle's .transaction() helper;
// this pool-backed client does.
// ---------------------------------------------------------------------------
const pool = new Pool({ connectionString: url });
export const dbPool = drizzlePool({ client: pool });
