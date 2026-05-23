import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  // Dynamic imports run after dotenv.config(), ensuring DATABASE_URL is set
  const { db } = await import("../src/db");
  const { users, worlds, likes } = await import("../src/db/schema");

  const u = await db.select().from(users).limit(1);
  const w = await db.select().from(worlds).limit(1);
  const l = await db.select().from(likes).limit(1);
  console.log(JSON.stringify({
    ok: true,
    users_rows: u.length,
    worlds_rows: w.length,
    likes_rows: l.length,
  }));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err) }));
  process.exit(1);
});
