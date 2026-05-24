import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  // Dynamic imports run after dotenv.config(), ensuring DATABASE_URL is set
  const { db } = await import("../src/db");
  const { users, worlds, likes, worldMedia, follows, comments, reposts, worldUpdates } = await import("../src/db/schema");

  const u = await db.select().from(users).limit(1);
  const w = await db.select().from(worlds).limit(1);
  const l = await db.select().from(likes).limit(1);
  const m = await db.select().from(worldMedia).limit(1);
  const f = await db.select().from(follows).limit(1);
  const c = await db.select().from(comments).limit(1);
  const r = await db.select().from(reposts).limit(1);
  const wu = await db.select().from(worldUpdates).limit(1);
  console.log(JSON.stringify({
    ok: true,
    users_rows: u.length,
    worlds_rows: w.length,
    likes_rows: l.length,
    world_media_rows: m.length,
    follows_rows: f.length,
    comments_rows: c.length,
    reposts_rows: r.length,
    world_updates_rows: wu.length,
  }));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err) }));
  process.exit(1);
});
