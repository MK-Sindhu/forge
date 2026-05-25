import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "FORGE Terms of Service — the rules governing use of the platform.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      {/* DRAFT banner */}
      <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 dark:border-amber-700 dark:bg-amber-950">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          ⚠️ DRAFT — under review.
        </p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          This Terms of Service is a starting draft and has not been reviewed by
          an attorney. Do not rely on it for production use. The founder will
          publish a finalized version before public launch.
        </p>
      </div>

      <h1 className="mb-2 text-3xl font-bold text-neutral-900 dark:text-neutral-100">
        Terms of Service
      </h1>
      <p className="mb-10 text-sm text-neutral-500 dark:text-neutral-500">
        Last updated: 2026-05-25 (draft).
      </p>

      {/* 1. Acceptance */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          1. Acceptance of Terms
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          By accessing or using FORGE — including browsing the feed, viewing
          worlds, creating an account, or uploading content — you agree to be
          bound by these Terms of Service (&ldquo;Terms&rdquo;). These Terms form a
          legally binding agreement between you and FORGE.
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          If you do not agree to these Terms, do not use the service.
        </p>
      </section>

      {/* 2. Eligibility */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          2. Eligibility
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          You must be at least 13 years of age to create an account on FORGE. If
          you are under 18, you must have the consent of a parent or legal
          guardian to use the service, as required by the laws of your
          jurisdiction.
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          By creating an account you represent that you meet these age
          requirements and, where applicable, that a parent or guardian has
          reviewed and consented to these Terms on your behalf.
        </p>
      </section>

      {/* 3. Your Account */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          3. Your Account
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          You are responsible for maintaining the confidentiality of your account
          credentials and for all activity that occurs under your account. If you
          believe your account has been compromised, notify us immediately.
        </p>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          You agree to provide accurate, current, and complete information when
          registering. Account registration and authentication is handled by
          Clerk; you are also bound by Clerk&rsquo;s applicable terms and policies with
          respect to your credentials.
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          Each person may hold only one account. Creating multiple accounts to
          circumvent suspension or other restrictions is a violation of these
          Terms.
        </p>
      </section>

      {/* 4. User Content & Ownership */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          4. User Content &amp; Ownership
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          <strong>You own your content.</strong> When you upload a 3D world or
          any other content to FORGE, you retain full ownership of that content.
          FORGE does not claim intellectual-property rights over what you create.
        </p>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          By uploading content, you grant FORGE a worldwide, non-exclusive,
          royalty-free license to host, display, serve, distribute, and reproduce
          your content solely as necessary to operate and improve the platform.
          This license does not give FORGE the right to sell your content, license
          it to third parties for commercial purposes, or use it outside the
          context of the platform&rsquo;s normal operation.
        </p>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          You retain the right to delete your content at any time. When you
          delete a world or close your account, FORGE will remove your content
          from the public platform. Please note that cached copies in CDN edge
          nodes or content that others have legitimately shared may persist for a
          brief period after deletion.
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          You represent and warrant that you own or have the necessary rights,
          licenses, and permissions to upload and license your content as
          described above, and that doing so does not infringe any third-party
          rights.
        </p>
      </section>

      {/* 5. Content Standards & Acceptable Use */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          5. Content Standards &amp; Acceptable Use
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          You are solely responsible for the content you upload or otherwise make
          available on FORGE. The following content is prohibited:
        </p>
        <ul className="mb-3 list-disc space-y-2 pl-6 text-neutral-700 dark:text-neutral-300">
          <li>
            Content that infringes any copyright, trademark, or other
            intellectual-property right of a third party.
          </li>
          <li>
            Content that is illegal under applicable law or that facilitates
            illegal activity.
          </li>
          <li>
            Any content that sexually depicts, exploits, or endangers minors.
            Such content will be removed immediately and reported to appropriate
            authorities.
          </li>
          <li>
            Content that promotes, glorifies, or incites violence or hatred
            against individuals or groups based on race, ethnicity, national
            origin, religion, gender, gender identity, sexual orientation,
            disability, or other protected characteristics.
          </li>
          <li>
            Malware, malicious code, or content designed to harm, surveil, or
            deceive users or third parties.
          </li>
          <li>
            Unsolicited bulk messages, spam, or other manipulative distribution
            tactics.
          </li>
          <li>
            Harassment, stalking, threats, or intimidation of any individual.
          </li>
          <li>
            Impersonation of another person, organization, or entity in a manner
            that is misleading or deceptive.
          </li>
        </ul>
        <p className="text-neutral-700 dark:text-neutral-300">
          FORGE reserves the right to remove any content that violates these
          standards and to suspend or terminate the accounts of users who
          repeatedly or egregiously violate them. Removal of content does not
          require prior notice.
        </p>
      </section>

      {/* 6. Reporting & Moderation */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          6. Reporting &amp; Moderation
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          Anyone may report content that appears to violate these Terms using the
          Report button on any world page. All reports are reviewed by the FORGE
          moderation team.
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          Users whose accounts have been suspended may still submit reports. The
          ability to flag harmful content is preserved regardless of account
          status — this is intentional.
        </p>
      </section>

      {/* 7. DMCA */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          7. DMCA &amp; Copyright Claims
        </h2>
        <p className="text-neutral-700 dark:text-neutral-300">
          FORGE respects intellectual-property rights and responds to valid
          copyright takedown notices under the U.S. Digital Millennium Copyright
          Act (DMCA). For the full takedown procedure, required notice elements,
          and the counter-notice process, see our{" "}
          <a
            href="/legal/dmca"
            className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            DMCA Policy
          </a>
          .
        </p>
      </section>

      {/* 8. Termination */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          8. Termination
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          FORGE may suspend or terminate your account at any time, with or
          without notice, if you violate these Terms or for any other reason at
          our discretion. Suspended users may still submit reports (see
          Section 6).
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          You may close your account at any time. Upon closure, your uploaded
          content will be removed from the public platform, subject to the
          caching caveat in Section 4. Termination does not affect any rights or
          obligations that arose before the termination date.
        </p>
      </section>

      {/* 9. No Crypto */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          9. No Cryptocurrency, Tokens, or NFTs
        </h2>
        <p className="text-neutral-700 dark:text-neutral-300">
          FORGE does not issue, sell, accept, or otherwise facilitate
          cryptocurrency, blockchain tokens, non-fungible tokens (NFTs), or any
          similar instrument of any kind. This is a permanent platform policy.
          Any third-party claims that FORGE is associated with such instruments
          are false.
        </p>
      </section>

      {/* 10. Disclaimers & Liability */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          10. Disclaimers &amp; Limitation of Liability
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTY
          OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES
          OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
          NON-INFRINGEMENT. FORGE DOES NOT WARRANT THAT THE SERVICE WILL BE
          UNINTERRUPTED, ERROR-FREE, OR FREE OF HARMFUL COMPONENTS.
        </p>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, FORGE SHALL NOT BE
          LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
          PUNITIVE DAMAGES, OR ANY LOSS OF DATA, PROFITS, GOODWILL, OR OTHER
          INTANGIBLE LOSSES, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE
          SERVICE.
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          IN NO EVENT SHALL FORGE&rsquo;S TOTAL LIABILITY TO YOU FOR ALL CLAIMS
          EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID TO USE THE SERVICE IN THE
          TWELVE MONTHS PRECEDING THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS
          ($100). BECAUSE FORGE IS CURRENTLY FREE TO USE, THIS EFFECTIVELY MEANS
          ZERO MONETARY LIABILITY IN MOST CASES.
        </p>
      </section>

      {/* 11. Changes */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          11. Changes to These Terms
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          FORGE may update these Terms from time to time. When we make material
          changes, we will notify you through the platform (for example, via an
          in-product banner or notification). The &ldquo;Last updated&rdquo; date at the top
          of this page will always reflect the most recent revision.
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          Continued use of FORGE after an update constitutes your acceptance of
          the revised Terms. If you do not agree with the changes, you should
          stop using the service and may close your account.
        </p>
      </section>

      {/* Contact */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Contact
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          For information about how FORGE collects and handles your personal
          data, see our{" "}
          <Link
            href="/legal/privacy"
            className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Privacy Policy
          </Link>
          .
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          For questions or concerns about these Terms, contact:{" "}
          <a
            href="mailto:legal@forge.example"
            className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            legal@forge.example
          </a>{" "}
          <em>
            {/* FOUNDER: Replace legal@forge.example with your real contact
                email before public launch. */}
            (placeholder — to be replaced before public launch)
          </em>
          .
        </p>
      </section>

      {/* Governing Law */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Governing Law
        </h2>
        <p className="text-neutral-700 dark:text-neutral-300">
          [Jurisdiction TBD — the founder must specify the governing jurisdiction
          before public launch.]
        </p>
      </section>

      <p className="text-sm text-neutral-500 dark:text-neutral-500">
        Last updated: 2026-05-25 (draft).
      </p>
    </main>
  );
}
