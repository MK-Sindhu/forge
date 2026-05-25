import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DMCA Policy",
  description: "How to report copyright infringement on FORGE.",
};

export default function DmcaPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold text-neutral-900 dark:text-neutral-100">
        DMCA Policy
      </h1>

      <p className="mb-4 text-neutral-700 dark:text-neutral-300">
        FORGE respects the intellectual property rights of others and expects
        users to do the same. We respond to clear notices of alleged copyright
        infringement under the U.S. Digital Millennium Copyright Act (DMCA).
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        How to file a notice
      </h2>

      <p className="mb-4 text-neutral-700 dark:text-neutral-300">
        If you believe a world hosted on FORGE infringes your copyright, send a
        notice including the following information to{" "}
        <a
          href="mailto:dmca@forge.example"
          className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          dmca@forge.example
        </a>
        {" "}
        <em>
          {/* FOUNDER: Replace dmca@forge.example with your real DMCA contact
              email before public launch. */}
          (placeholder — to be replaced before public launch)
        </em>
        :
      </p>

      <ul className="mb-4 list-disc space-y-2 pl-6 text-neutral-700 dark:text-neutral-300">
        <li>Your physical or electronic signature.</li>
        <li>Identification of the copyrighted work claimed to be infringed.</li>
        <li>
          Identification of the FORGE URL (e.g.{" "}
          <code className="rounded bg-neutral-100 px-1 text-sm dark:bg-neutral-800">
            https://forge.example/world/&lt;world-id&gt;
          </code>
          ) you claim is infringing.
        </li>
        <li>Your contact information (address, phone, email).</li>
        <li>
          A statement that you have a good-faith belief that the use is not
          authorized by the copyright owner, its agent, or the law.
        </li>
        <li>
          A statement, under penalty of perjury, that the information in the
          notice is accurate and that you are the copyright owner or authorized
          to act on the owner&#39;s behalf.
        </li>
      </ul>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        What happens next
      </h2>

      <p className="mb-4 text-neutral-700 dark:text-neutral-300">
        Once we receive a complete notice, we will remove or disable access to
        the allegedly infringing content and notify the uploader. We may also
        suspend repeat infringers.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        Counter-notice
      </h2>

      <p className="mb-4 text-neutral-700 dark:text-neutral-300">
        If you believe your content was removed in error, you may file a
        counter-notice. Contact us at the email above; the process for
        counter-notices is currently handled manually. A formal counter-notice
        flow is coming.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        Reports outside of copyright
      </h2>

      <p className="mb-4 text-neutral-700 dark:text-neutral-300">
        For non-copyright concerns (NSFW, abusive, spam, other), use the{" "}
        <strong>Report</strong> button on any world page. Our team reviews every
        report.
      </p>

      <p className="mt-10 text-sm text-neutral-500 dark:text-neutral-500">
        For the broader rules governing use of FORGE, see our{" "}
        <a
          href="/legal/terms"
          className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          Terms of Service
        </a>
        .
      </p>

      <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-500">
        Last updated: {new Date().toISOString().slice(0, 10)}
      </p>
    </main>
  );
}
