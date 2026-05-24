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
import { relations, sql, desc } from "drizzle-orm";

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
// follows
// Composite PK on (follower_id, followee_id).
// Index on followee_id for the "who follows X?" query path.
// CHECK constraint prevents self-follow at the DB level (defense in depth;
// the API layer rejects it earlier).
// ---------------------------------------------------------------------------
export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index("follows_followee_id_idx").on(t.followeeId),
    check("follows_no_self_follow", sql`${t.followerId} <> ${t.followeeId}`),
  ]
);

// ---------------------------------------------------------------------------
// relations (for Drizzle joined queries)
// ---------------------------------------------------------------------------
export const usersRelations = relations(users, ({ many }) => ({
  worlds: many(worlds),
  likes: many(likes),
  // Slice 3 — follows
  // relationName disambiguates the two FKs from follows → users
  following: many(follows, { relationName: "follower" }), // rows where this user IS the follower
  followers: many(follows, { relationName: "followee" }), // rows where this user IS the followee
  // Slice 4 — engagement
  comments: many(comments),
  reposts: many(reposts),
}));

export const worldsRelations = relations(worlds, ({ one, many }) => ({
  user: one(users, { fields: [worlds.userId], references: [users.id] }),
  likes: many(likes),
  media: many(worldMedia),
  // Slice 4 — engagement
  comments: many(comments),
  reposts: many(reposts),
}));

export const worldMediaRelations = relations(worldMedia, ({ one }) => ({
  world: one(worlds, { fields: [worldMedia.worldId], references: [worlds.id] }),
}));

export const likesRelations = relations(likes, ({ one }) => ({
  user: one(users, { fields: [likes.userId], references: [users.id] }),
  world: one(worlds, { fields: [likes.worldId], references: [worlds.id] }),
}));

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(users, {
    fields: [follows.followerId],
    references: [users.id],
    relationName: "follower",
  }),
  followee: one(users, {
    fields: [follows.followeeId],
    references: [users.id],
    relationName: "followee",
  }),
}));

// ---------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("comments_world_id_created_at_idx").on(t.worldId, desc(t.createdAt)),
  ]
);

// ---------------------------------------------------------------------------
// reposts
// Composite PK on (userId, worldId) — a user can repost a world at most once.
// No self-repost CHECK: that's an API-layer concern, schema stays flexible.
// ---------------------------------------------------------------------------
export const reposts = pgTable(
  "reposts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.worldId] }),
    index("reposts_user_id_created_at_idx").on(t.userId, desc(t.createdAt)),
  ]
);

// ---------------------------------------------------------------------------
// relations (Slice 4 additions)
// ---------------------------------------------------------------------------
export const commentsRelations = relations(comments, ({ one }) => ({
  world: one(worlds, { fields: [comments.worldId], references: [worlds.id] }),
  user: one(users, { fields: [comments.userId], references: [users.id] }),
}));

export const repostsRelations = relations(reposts, ({ one }) => ({
  user: one(users, { fields: [reposts.userId], references: [users.id] }),
  world: one(worlds, { fields: [reposts.worldId], references: [worlds.id] }),
}));
