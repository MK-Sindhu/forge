import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").notNull().unique(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  tosAcceptedAt: timestamp("tos_accepted_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// worlds
// ---------------------------------------------------------------------------
export const worlds = pgTable(
  "worlds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    glbUrl: text("glb_url").notNull(),
    glbSizeBytes: integer("glb_size_bytes").notNull(),
    likesCount: integer("likes_count").notNull().default(0),
    views: integer("views").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("worlds_user_id_idx").on(t.userId),
    index("worlds_created_at_idx").on(t.createdAt),
  ]
);

// ---------------------------------------------------------------------------
// world_media
// Decision: Using a text column with a named Postgres CHECK constraint via
// Drizzle's check() helper (from drizzle-orm/pg-core) + sql template tag
// (from drizzle-orm). This avoids creating a pg_type enum object and keeps
// the allowed values clearly documented in the schema. The CHECK is enforced
// at the DB level.
// ---------------------------------------------------------------------------
export const worldMedia = pgTable(
  "world_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    url: text("url").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("world_media_world_id_position_idx").on(t.worldId, t.position),
    check("world_media_type_check", sql`${t.type} IN ('thumbnail', 'image', 'video')`),
  ]
);

// ---------------------------------------------------------------------------
// likes
// ---------------------------------------------------------------------------
export const likes = pgTable(
  "likes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.worldId] })]
);

// ---------------------------------------------------------------------------
// relations (for Drizzle joined queries)
// ---------------------------------------------------------------------------
export const usersRelations = relations(users, ({ many }) => ({
  worlds: many(worlds),
  likes: many(likes),
}));

export const worldsRelations = relations(worlds, ({ one, many }) => ({
  user: one(users, { fields: [worlds.userId], references: [users.id] }),
  likes: many(likes),
  media: many(worldMedia),
}));

export const worldMediaRelations = relations(worldMedia, ({ one }) => ({
  world: one(worlds, { fields: [worldMedia.worldId], references: [worlds.id] }),
}));

export const likesRelations = relations(likes, ({ one }) => ({
  user: one(users, { fields: [likes.userId], references: [users.id] }),
  world: one(worlds, { fields: [likes.worldId], references: [worlds.id] }),
}));
