import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  if (existing[0]) {
    return NextResponse.json(existing[0]);
  }

  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) {
    return NextResponse.json(
      { error: "No email on Clerk user" },
      { status: 400 }
    );
  }

  const username =
    clerkUser.username ??
    email.split("@")[0] ??
    `user_${userId.slice(-8)}`;

  const [created] = await db
    .insert(users)
    .values({
      clerkId: userId,
      username,
      email,
      avatarUrl: clerkUser.imageUrl,
    })
    .returning();

  return NextResponse.json(created);
}
