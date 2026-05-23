import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrCreateDbUser } from "@/lib/users";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const row = await getOrCreateDbUser(clerkUser);
    return NextResponse.json(row);
  } catch (err) {
    if (err instanceof Error && err.message.includes("no email")) {
      return NextResponse.json(
        { error: "No email on Clerk user" },
        { status: 400 },
      );
    }
    throw err;
  }
}
