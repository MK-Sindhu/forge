import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
    sceneJson: jsonb("scene_json").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    likes: integer("likes").notNull().default(0),
    views: integer("views").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("worlds_user_id_idx").on(t.userId),
    index("worlds_created_at_idx").on(t.createdAt),
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
}));

export const likesRelations = relations(likes, ({ one }) => ({
  user: one(users, { fields: [likes.userId], references: [users.id] }),
  world: one(worlds, { fields: [likes.worldId], references: [worlds.id] }),
}));
