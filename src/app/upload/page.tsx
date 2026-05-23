import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { UploadForm } from "./UploadForm";

export default async function UploadPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/upload");
  }
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Upload a world</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Share a 3D world you&apos;ve made. We accept .glb files up to 50 MB.
      </p>
      <UploadForm />
    </main>
  );
}
