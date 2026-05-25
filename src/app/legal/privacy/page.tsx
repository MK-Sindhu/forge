import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "FORGE Privacy Policy — how we collect, use, and protect your data.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      {/* DRAFT banner */}
      <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 dark:border-amber-700 dark:bg-amber-950">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          ⚠️ DRAFT — under review.
        </p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          This Privacy Policy is a starting draft and has not been reviewed by
          an attorney. Do not rely on it for production use. The founder will
          publish a finalized version before public launch.
        </p>
      </div>

      <h1 className="mb-2 text-3xl font-bold text-neutral-900 dark:text-neutral-100">
        Privacy Policy
      </h1>
      <p className="mb-10 text-sm text-neutral-500 dark:text-neutral-500">
        Last updated: 2026-05-25 (draft).
      </p>

      {/* 1. What This Covers */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          1. What This Covers
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          This Privacy Policy explains what information FORGE collects, why we
          collect it, how it is stored and used, and what rights you have over
          your data. It applies to all users of the FORGE platform, whether you
          browse anonymously or hold a registered account.
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          Using FORGE means you accept the practices described here. This policy
          should be read alongside our{" "}
          <Link
            href="/legal/terms"
            className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Terms of Service
          </Link>
          .
        </p>
      </section>

      {/* 2. Information We Collect */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          2. Information We Collect
        </h2>

        <h3 className="mb-2 text-base font-semibold text-neutral-800 dark:text-neutral-200">
          From you directly
        </h3>
        <ul className="mb-4 list-disc space-y-2 pl-6 text-neutral-700 dark:text-neutral-300">
          <li>
            <strong>Account information</strong> — your email address and OAuth
            profile data (name, avatar) provided when you sign up via Clerk
            (Google, GitHub, or email/password, depending on which options are
            enabled). Clerk handles the authentication flow and receives this
            data first; see Section 4 for what Clerk does with it.
          </li>
          <li>
            <strong>Username</strong> — the public handle you choose. Stored in
            FORGE&rsquo;s own database and shown on your profile and any content you
            publish.
          </li>
          <li>
            <strong>Uploaded content</strong> — 3D world files (<code>.glb</code>
            ), thumbnail images, optional preview videos, and optional gallery
            images. All uploaded content is stored on Cloudflare R2 and is
            public by design (see Section 5).
          </li>
          <li>
            <strong>Text you write</strong> — world titles, descriptions, tags,
            comments, world update posts, and any notes submitted in a content
            report.
          </li>
        </ul>

        <h3 className="mb-2 text-base font-semibold text-neutral-800 dark:text-neutral-200">
          From your device (automatically)
        </h3>
        <ul className="mb-4 list-disc space-y-2 pl-6 text-neutral-700 dark:text-neutral-300">
          <li>
            <strong>IP address</strong> — recorded in Vercel&rsquo;s request logs with
            each HTTP request. FORGE does not currently use these logs for
            analytics or behavioral profiling; they exist for operational
            purposes (debugging, abuse prevention).
          </li>
          <li>
            <strong>User-agent string</strong> — your browser and OS, also
            present in Vercel request logs for the same operational reasons.
          </li>
          <li>
            <strong>Session cookies</strong> — Clerk sets cookies that are
            strictly necessary to keep you signed in. FORGE does not set any
            marketing or behavioral-tracking cookies (see Section 6).
          </li>
        </ul>

        <h3 className="mb-2 text-base font-semibold text-neutral-800 dark:text-neutral-200">
          Behavioral data (signed-in users only)
        </h3>
        <ul className="list-disc space-y-2 pl-6 text-neutral-700 dark:text-neutral-300">
          <li>
            <strong>Likes, follows, reposts</strong> — recorded in the database
            when you perform these actions.
          </li>
          <li>
            <strong>Comments and world updates</strong> — text and timestamps
            stored in the database and displayed publicly.
          </li>
          <li>
            <strong>View counts</strong> — FORGE records one view per signed-in
            user per world per calendar day. This data is stored as a
            <code>(viewer_id, world_id, day)</code> row in the
            <code>world_views</code> table. Anonymous visitors (not signed in)
            are NOT individually tracked — no IP-based or session-cookie-based
            view tracking exists.
          </li>
          <li>
            <strong>In-app notifications</strong> — records of events (likes,
            comments, follows, new worlds from people you follow) stored in the
            database and visible only to you.
          </li>
          <li>
            <strong>Moderation data</strong> — if you file a report or if your
            account is subject to a moderation action (suspension), that record
            is stored in the database.
          </li>
        </ul>
      </section>

      {/* 3. How We Use Your Information */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          3. How We Use Your Information
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          We use the data described above for the following purposes:
        </p>
        <ul className="mb-3 list-disc space-y-2 pl-6 text-neutral-700 dark:text-neutral-300">
          <li>
            <strong>Operating the platform</strong> — rendering your profile,
            serving your uploaded worlds, showing the feed, running search and
            discovery features.
          </li>
          <li>
            <strong>Authentication</strong> — verifying your identity on each
            request via Clerk session cookies.
          </li>
          <li>
            <strong>Serving content publicly</strong> — worlds, comments, world
            updates, and your username and avatar are public by design. Other
            users and search engines can see them.
          </li>
          <li>
            <strong>Moderation and safety</strong> — investigating reports,
            enforcing the{" "}
            <Link
              href="/legal/terms"
              className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Terms of Service
            </Link>
            , and applying suspensions when required.
          </li>
          <li>
            <strong>In-product communication</strong> — delivering in-app
            notifications (likes, comments, follows, new worlds from followed
            creators). No email or push notifications in the current version.
          </li>
          <li>
            <strong>Platform improvement</strong> — understanding aggregate
            usage patterns to improve features. We do not currently run a
            dedicated analytics product; this will be updated when one is added
            (see Section 4).
          </li>
        </ul>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          <strong>We do not use your data to train AI models.</strong>
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          <strong>We do not sell your data.</strong> We do not share your data
          with advertisers or data brokers.
        </p>
      </section>

      {/* 4. Third Parties We Use */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          4. Third Parties We Use
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          FORGE relies on a small set of infrastructure providers. Each receives
          only the data necessary for its function.
        </p>
        <ul className="mb-3 list-disc space-y-2 pl-6 text-neutral-700 dark:text-neutral-300">
          <li>
            <strong>Clerk</strong> (authentication provider) — handles sign-up,
            sign-in, and session management. Clerk receives your email address
            and any OAuth profile data (Google, GitHub, etc.) you use to
            authenticate. Clerk is a separate data processor; its practices are
            governed by the{" "}
            <a
              href="https://clerk.com/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Clerk Privacy Policy
            </a>
            .
          </li>
          <li>
            <strong>Vercel</strong> (hosting, CDN, and analytics) — serves every
            request to the FORGE web application and provides Vercel Web
            Analytics: cookieless pageview tracking (pageviews, referrer,
            page-load metrics, and country derived from your IP address — the IP
            itself is then discarded and never stored). Vercel logs request IP
            addresses, paths, and response codes for operational purposes. No
            cookies are set by the analytics component; no cross-site tracking
            occurs; no personal data is retained by the analytics product.
            Vercel&rsquo;s practices are governed by the{" "}
            <a
              href="https://vercel.com/legal/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Vercel Privacy Policy
            </a>
            .
          </li>
          <li>
            <strong>Neon</strong> (database hosting) — hosts the Postgres
            database that stores all structured FORGE data (users, worlds,
            comments, likes, follows, etc.). Data is stored in the US. Neon&rsquo;s
            practices are governed by the{" "}
            <a
              href="https://neon.tech/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Neon Privacy Policy
            </a>
            .
          </li>
          <li>
            <strong>Cloudflare R2</strong> (object storage) — stores all
            uploaded files (3D world files, thumbnails, videos, images). Content
            is publicly accessible by design. Cloudflare&rsquo;s practices are
            governed by the{" "}
            <a
              href="https://www.cloudflare.com/privacypolicy/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Cloudflare Privacy Policy
            </a>
            .
          </li>
        </ul>
        <p className="text-neutral-700 dark:text-neutral-300">
          No other third parties receive personal data. FORGE does not share
          data with advertising networks, data brokers, or any party for
          commercial purposes outside of the operational providers listed above.
        </p>
      </section>

      {/* 5. Public Content */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          5. Public Content
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          FORGE is a public platform. The following content is visible to
          anyone, including people who are not signed in, search engines, and
          archival crawlers:
        </p>
        <ul className="mb-3 list-disc space-y-2 pl-6 text-neutral-700 dark:text-neutral-300">
          <li>Your username and avatar</li>
          <li>All worlds you publish (3D files, thumbnails, videos, images)</li>
          <li>World titles, descriptions, and tags</li>
          <li>Comments you post on any world</li>
          <li>World update posts you write as a world owner</li>
          <li>Reposts you make</li>
        </ul>
        <p className="text-neutral-700 dark:text-neutral-300">
          <strong>Do not upload content you do not want to be public.</strong>{" "}
          Even after deletion, content may persist briefly in CDN caches or in
          third-party archives that crawled the page before deletion.
        </p>
      </section>

      {/* 6. Cookies */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          6. Cookies
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          FORGE uses only the cookies that Clerk sets in order to maintain your
          authenticated session. These are strictly necessary cookies — without
          them, you cannot remain signed in.
        </p>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          FORGE does not set advertising cookies, tracking cookies, or any
          cookies for behavioral profiling.
        </p>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          Because the only cookies in use are strictly necessary for the service
          to function, a cookie-consent banner is not required under most
          consent-banner regulations (such as the EU Cookie Directive).
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          Our analytics provider (Vercel Web Analytics) is cookieless by design
          — see §4 for details.
        </p>
      </section>

      {/* 7. Data Retention & Deletion */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          7. Data Retention &amp; Deletion
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          We retain your data for as long as your account is active or as needed
          to provide the service.
        </p>
        <ul className="mb-3 list-disc space-y-2 pl-6 text-neutral-700 dark:text-neutral-300">
          <li>
            <strong>Account closure</strong> — when you close your account,
            your profile, uploaded worlds, and associated content are removed
            from the public platform. Some data may persist briefly in database
            backups before being purged in accordance with the backup rotation
            schedule.
          </li>
          <li>
            <strong>Content deletion</strong> — when you delete an individual
            world or comment, it is removed from the public platform immediately.
            CDN-cached copies may linger for a short period.
          </li>
          <li>
            <strong>Suspended accounts</strong> — suspended accounts retain
            their data in the database until the account is either reinstated by
            an admin or closed by the user. Suspended users can still close their
            own account.
          </li>
          <li>
            <strong>View and engagement data</strong> — like counts, view
            records, and follow relationships are stored as long as the
            associated account and world records exist. Deleting the world or
            closing the account triggers cascading deletes on related rows.
          </li>
        </ul>
        <p className="text-neutral-700 dark:text-neutral-300">
          If you want to request deletion of data that the in-product UI does
          not surface, contact us using the email in Section 8.
        </p>
      </section>

      {/* 8. Your Rights */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          8. Your Rights
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          Depending on where you are located, you may have some or all of the
          following rights with respect to your personal data:
        </p>
        <ul className="mb-3 list-disc space-y-2 pl-6 text-neutral-700 dark:text-neutral-300">
          <li>
            <strong>Access</strong> — request a copy of the personal data FORGE
            holds about you.
          </li>
          <li>
            <strong>Correction</strong> — request that inaccurate data be
            corrected. For most profile data, you can do this directly in the
            app via your account settings in Clerk.
          </li>
          <li>
            <strong>Deletion</strong> — request deletion of your data. You can
            delete individual worlds and comments from within the platform. To
            close your account entirely, use the account-settings interface or
            contact us.
          </li>
          <li>
            <strong>Portability</strong> — request a machine-readable export of
            your data. Contact us for this; automated export tooling does not
            currently exist in-product.
          </li>
          <li>
            <strong>Objection / Restriction</strong> — object to, or request
            restriction of, certain processing of your data. Contact us to
            discuss.
          </li>
        </ul>
        <p className="text-neutral-700 dark:text-neutral-300">
          For any privacy request, contact:{" "}
          <a
            href="mailto:privacy@forge.example"
            className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            privacy@forge.example
          </a>{" "}
          <em>
            {/* FOUNDER: Replace privacy@forge.example with your real contact
                email before public launch. */}
            (placeholder — to be replaced before public launch)
          </em>
          . We will respond within 30 days.
        </p>
      </section>

      {/* 9. Children's Privacy */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          9. Children&rsquo;s Privacy
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          FORGE is not directed at children under the age of 13 and we do not
          knowingly collect personal data from anyone under 13. If you believe a
          child under 13 has provided us with personal data, please contact us
          immediately using the email in Section 8 and we will take steps to
          delete that data.
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          Our minimum-age policy is described further in the{" "}
          <Link
            href="/legal/terms"
            className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Terms of Service, Section 2 (Eligibility)
          </Link>
          .
        </p>
      </section>

      {/* 10. Changes to this Policy */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          10. Changes to This Policy
        </h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          We may update this Privacy Policy from time to time. When we make
          material changes — for example, adding a new analytics provider or
          changing how we retain data — we will notify you through the platform
          (for example, via an in-product banner or notification). The &ldquo;Last
          updated&rdquo; date at the top of this page will always reflect the most
          recent revision.
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          Continued use of FORGE after a policy update constitutes acceptance of
          the revised policy. If you do not agree with the changes, you should
          stop using the service and may close your account.
        </p>
      </section>

      {/* Contact */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Contact
        </h2>
        <p className="text-neutral-700 dark:text-neutral-300">
          For privacy questions or data requests, contact:{" "}
          <a
            href="mailto:privacy@forge.example"
            className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            privacy@forge.example
          </a>{" "}
          <em>
            {/* FOUNDER: Replace privacy@forge.example with your real contact
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
