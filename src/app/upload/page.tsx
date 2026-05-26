import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { UploadForm } from "./UploadForm";

export const metadata: Metadata = {
  title: "Upload a world",
  description: "Upload a .glb to publish your world — a space others can enter and explore.",
};

export default async function UploadPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/upload");
  }
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Upload a world</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Upload a .glb to publish your world — a space others can enter and explore. Maximum 50 MB.
      </p>
      <UploadForm />
    </main>
  );
}
