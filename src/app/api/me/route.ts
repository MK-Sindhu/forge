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
    // Any other error is assumed to be a DB/infrastructure failure.
    // We log it server-side but never expose the raw message to the client
    // (it could leak schema details or connection strings).
    console.error("[/api/me] unexpected error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 },
    );
  }
}
