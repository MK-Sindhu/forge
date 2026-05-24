import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  index,
  primaryKey,
  unique,
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
  isAdmin: boolean("is_admin").notNull().default(false),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
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
  // Slice 6 — moderation
  reports: many(reports, { relationName: "reporter" }), // reports filed by this user
  // Slice 7.5 — notifications
  receivedNotifications: many(notifications, { relationName: "notificationRecipient" }),
  actedNotifications: many(notifications, { relationName: "notificationActor" }),
}));

export const worldsRelations = relations(worlds, ({ one, many }) => ({
  user: one(users, { fields: [worlds.userId], references: [users.id] }),
  likes: many(likes),
  media: many(worldMedia),
  // Slice 4 — engagement
  comments: many(comments),
  reposts: many(reposts),
  // Slice 5 — world updates timeline
  updates: many(worldUpdates),
  // Slice 6 — moderation
  reports: many(reports),
  // Slice 7.1 — tags
  tags: many(worldTags),
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
// world_updates
// No user_id column — author is implicitly the world owner (worlds.userId).
// editedAt is nullable: null means never edited.
// ---------------------------------------------------------------------------
export const worldUpdates = pgTable(
  "world_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [
    index("world_updates_world_id_created_at_idx").on(t.worldId, desc(t.createdAt)),
  ]
);

// ---------------------------------------------------------------------------
// reports
// Slice 6 — moderation. One report per (reporter, world) pair (unique constraint).
// reason + status use CHECK constraints (same pattern as world_media.type).
// resolved_by_id uses ON DELETE SET NULL so deleting an admin does not cascade-
// destroy historical report records.
// ---------------------------------------------------------------------------
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    body: text("body"),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("reports_status_created_at_idx").on(t.status, desc(t.createdAt)),
    unique("reports_reporter_world_unique").on(t.reporterId, t.worldId),
    check("reports_reason_check", sql`${t.reason} IN ('copyright', 'nsfw', 'abusive', 'spam', 'other')`),
    check("reports_status_check", sql`${t.status} IN ('open', 'resolved', 'dismissed')`),
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

// ---------------------------------------------------------------------------
// relations (Slice 5 additions)
// ---------------------------------------------------------------------------
export const worldUpdatesRelations = relations(worldUpdates, ({ one }) => ({
  world: one(worlds, { fields: [worldUpdates.worldId], references: [worlds.id] }),
}));

// ---------------------------------------------------------------------------
// relations (Slice 6 additions)
// ---------------------------------------------------------------------------
export const reportsRelations = relations(reports, ({ one }) => ({
  reporter: one(users, { fields: [reports.reporterId], references: [users.id], relationName: "reporter" }),
  world: one(worlds, { fields: [reports.worldId], references: [worlds.id] }),
  resolvedBy: one(users, { fields: [reports.resolvedById], references: [users.id], relationName: "resolver" }),
}));

// ---------------------------------------------------------------------------
// tags
// Slice 7.1 — free-form creator tags. name is unique and must be lowercase
// (enforced by a named CHECK constraint). Max 32 chars. Max 5 per world is an
// API-layer concern; the DB allows more.
// ---------------------------------------------------------------------------
export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("tags_name_check",
    sql`length(${t.name}) BETWEEN 1 AND 32 AND ${t.name} = lower(${t.name})`),
]);

// ---------------------------------------------------------------------------
// world_tags
// Slice 7.1 — join table between worlds and tags.
// Composite PK on (world_id, tag_id). Both FKs CASCADE DELETE.
// Index on tag_id for "all worlds with tag X" queries.
// ---------------------------------------------------------------------------
export const worldTags = pgTable("world_tags", {
  worldId: uuid("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }),
  tagId:   uuid("tag_id").notNull().references(() => tags.id,   { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.worldId, t.tagId] }),
  index("world_tags_tag_id_idx").on(t.tagId),
]);

// ---------------------------------------------------------------------------
// relations (Slice 7.1 additions)
// ---------------------------------------------------------------------------
export const tagsRelations = relations(tags, ({ many }) => ({
  worlds: many(worldTags),
}));

export const worldTagsRelations = relations(worldTags, ({ one }) => ({
  world: one(worlds, { fields: [worldTags.worldId], references: [worlds.id] }),
  tag:   one(tags,   { fields: [worldTags.tagId],   references: [tags.id] }),
}));

// ---------------------------------------------------------------------------
// world_views
// Slice 7.3 — per-user-per-day view deduplication.
// Composite PK on (viewer_id, world_id, day) makes every (user, world, day)
// combination unique — onConflictDoNothing() is used on insert so repeated
// visits on the same day are silently dropped.
// After each successful insert, the transaction recounts all rows for the
// world and writes the total to worlds.views (recount-from-source pattern).
// Anonymous views are intentionally ignored (locked decision, PROJECT.md §7).
// No Drizzle relations are defined — this table is internal and never queried
// via db.query relational helpers.
// ---------------------------------------------------------------------------
export const worldViews = pgTable("world_views", {
  viewerId:  uuid("viewer_id").notNull().references(() => users.id,  { onDelete: "cascade" }),
  worldId:   uuid("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }),
  day:       date("day").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.viewerId, t.worldId, t.day] }),
  index("world_views_world_id_idx").on(t.worldId),
]);

// ---------------------------------------------------------------------------
// notifications
// Slice 7.5 — in-app notifications for like / comment / follow / new_world.
//
// type is validated at the DB level via a named CHECK constraint (same
// pattern as world_media.type, reports.reason). The four allowed values are:
//   'like'      — someone liked the recipient's world
//   'comment'   — someone commented on the recipient's world
//   'follow'    — someone followed the recipient
//   'new_world' — someone the recipient follows published a new world
//
// actorId, worldId, commentId are nullable FKs (CASCADE DELETE) — present
// depending on the notification type.
//
// readAt is null until the notification is marked read.
//
// Two indexes:
//   notifications_user_id_created_at_idx  — (user_id, created_at DESC) for the feed query
//   notifications_user_id_unread_idx      — PARTIAL (user_id) WHERE read_at IS NULL
//                                           for the cheap unread-count badge query
//
// Self-notifications (userId === actorId) are suppressed in the notify()
// helper, not at the DB level — no DB CHECK is added for this.
// ---------------------------------------------------------------------------
export const notifications = pgTable("notifications", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type:      text("type").notNull(),
  actorId:   uuid("actor_id").references(() => users.id,         { onDelete: "cascade" }),
  worldId:   uuid("world_id").references(() => worlds.id,         { onDelete: "cascade" }),
  commentId: uuid("comment_id").references(() => comments.id,     { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt:    timestamp("read_at",    { withTimezone: true }),
}, (t) => [
  index("notifications_user_id_created_at_idx").on(t.userId, desc(t.createdAt)),
  index("notifications_user_id_unread_idx").on(t.userId).where(sql`${t.readAt} IS NULL`),
  check("notifications_type_check", sql`${t.type} IN ('like', 'comment', 'follow', 'new_world')`),
]);

// ---------------------------------------------------------------------------
// relations (Slice 7.5 additions)
// Two FKs from notifications → users (recipient + actor) require relationName
// disambiguation, following the same pattern used for follows → users.
// ---------------------------------------------------------------------------
export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, {
    fields: [notifications.userId],
    references: [users.id],
    relationName: "notificationRecipient",
  }),
  actor: one(users, {
    fields: [notifications.actorId],
    references: [users.id],
    relationName: "notificationActor",
  }),
  world: one(worlds, {
    fields: [notifications.worldId],
    references: [worlds.id],
  }),
  comment: one(comments, {
    fields: [notifications.commentId],
    references: [comments.id],
  }),
}));
