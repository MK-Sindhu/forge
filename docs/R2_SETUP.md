# FORGE — Cloudflare R2 Setup Walkthrough

**Owner:** deploy-ops  
**Slice:** 1 (critical path)  
**Buckets to create:** `forge-glb`, `forge-media`  
**Estimated time:** 20–30 minutes  

---

## Before you start

You need:
- A Cloudflare account (free). If you don't have one, begin at Step 1. Otherwise skip to Step 2.
- A credit or debit card on file with Cloudflare. R2's free tier is genuinely free (10 GB storage, 1 M write ops/month, 10 M read ops/month) — the card is required only to unlock R2 at account level. **You will not be charged unless you exceed free-tier limits.** Do not upgrade to a paid Cloudflare plan.
- Your Vercel production domain (e.g. `forge.vercel.app` or a custom domain if you have one). You will paste it into CORS config.
- Your Vercel project's preview domain pattern. It looks like `https://*-<your-vercel-scope>.vercel.app`. Find it: in the Vercel dashboard open your project → Settings → Domains — the preview URL pattern is shown there.

---

## Step 1 — Create a Cloudflare account (skip if you already have one)

1. Go to `https://dash.cloudflare.com/sign-up`.
2. Enter your email and a password. Click **Create Account**.
3. Verify your email address via the link Cloudflare sends.
4. On the "Add a site" screen that appears, click **Skip** or scroll past it — you do not need to add a domain to use R2.

Expected outcome: you land on the Cloudflare dashboard home screen, showing a left sidebar with icons for Home, Websites, Workers & Pages, R2, etc.

> Dashboard layout note: the left sidebar may be icon-only or show full labels depending on your screen width. The R2 entry should be near the middle of the sidebar. If you do not see "R2" directly, look for a **Storage** section or use the search bar at the top of the dashboard and search "R2".

---

## Step 2 — Enable R2 and add a payment method

1. In the left sidebar, click **R2**.
2. You will land on the R2 overview page. If R2 is not yet enabled on your account, Cloudflare will show a prompt asking you to add a payment method before proceeding. This is a hold — not a charge.
3. Click **Enable R2** (button label may read "Get started" or "Add payment method").
4. Enter a credit or debit card. Cloudflare validates it with a $0 authorization.
5. After the card is accepted, you are returned to the R2 overview page with a **Create bucket** button visible.

Expected outcome: the R2 overview page shows "0 buckets" and a prominent **Create bucket** button.

> If you are prompted to upgrade to a paid plan at any point during R2 activation, close that modal and look for a "Continue with free plan" or "Skip" link. You do not need a paid plan for this project.

---

## Step 3 — Create bucket 1: `forge-glb`

This bucket stores `.glb` and `.gltf` world files.

1. On the R2 overview page, click **Create bucket**.
2. In the **Bucket name** field, type exactly: `forge-glb`  
   (Bucket names are globally unique across Cloudflare R2 — if this exact name is taken you will see an error. In that case use `forge-glb-<your-initials>` and update the env var `R2_BUCKET_GLB` accordingly.)
3. Under **Location**, choose **Automatic** unless you have a strong reason to pin a region. If you want to pin, select the option closest to your primary user base. The tracker notes a preference for **WNAM (Western North America / US West)** — if that option exists in the dropdown, select it; otherwise Automatic is fine.
4. Leave **Default storage class** set to **Standard**.
5. Click **Create bucket**.

Expected outcome: you are taken to the bucket detail page for `forge-glb`. The page shows tabs: Objects, Settings, CORS, Metrics.

> If you do not see a CORS tab, it may be under Settings → CORS. Dashboard layout note: Cloudflare has reorganized these tabs before — look inside Settings if CORS is not a top-level tab.

---

## Step 4 — Create bucket 2: `forge-media`

This bucket stores thumbnails, preview images, and (in a later slice) preview videos.

1. In the left sidebar, click **R2** to return to the overview.
2. Click **Create bucket**.
3. In the **Bucket name** field, type exactly: `forge-media`
4. Set Location to the same choice you made for `forge-glb` (Automatic or WNAM).
5. Leave storage class as **Standard**.
6. Click **Create bucket**.

Expected outcome: you are taken to the bucket detail page for `forge-media`.

---

## Step 5 — Configure CORS for `forge-glb`

CORS is required so that browsers running on your Vercel domains can issue `PUT` requests (presigned upload) and `GET` requests (file serving) directly to R2.

1. On the `forge-glb` bucket detail page, click the **Settings** tab (or **CORS** tab if it is shown separately).
2. Locate the **CORS Policy** section. Click **Add CORS policy** or **Edit CORS policy** — the label depends on whether a policy already exists.
3. Cloudflare's R2 CORS editor accepts a JSON array. Clear any existing content and paste the following exactly:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://<YOUR_VERCEL_PRODUCTION_DOMAIN>",
      "https://*-<YOUR_VERCEL_SCOPE>.vercel.app"
    ],
    "AllowedMethods": [
      "GET",
      "PUT",
      "HEAD"
    ],
    "AllowedHeaders": [
      "Content-Type",
      "Content-Length"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

**Before saving**, replace:
- `<YOUR_VERCEL_PRODUCTION_DOMAIN>` with your actual production domain, e.g. `forge.vercel.app`
- `<YOUR_VERCEL_SCOPE>` with your Vercel team/personal scope slug, e.g. if your preview URLs look like `https://forge-abc123-mk-sindhu.vercel.app` then the scope is `mk-sindhu`

4. Click **Save** (or **Apply** — the button label may vary).

Expected outcome: the CORS policy is saved without errors. The policy editor shows your three origins.

> Dashboard layout note: Some Cloudflare R2 dashboard versions show a visual rule builder rather than a raw JSON editor. If you see a visual builder, add one rule with the three origins, all three methods, the two headers, and max age 3600. The underlying JSON format is the same.

---

## Step 6 — Configure CORS for `forge-media`

1. In the left sidebar, click **R2** and open the `forge-media` bucket.
2. Repeat Steps 5.1–5.4 exactly — paste the same JSON, same substitutions.

Expected outcome: `forge-media` has an identical CORS policy to `forge-glb`.

---

## Step 7 — Enable public read access on `forge-glb`

Without public access, GLB file URLs stored in your database will return 403 errors in the browser. Both buckets must be publicly readable.

1. On the `forge-glb` bucket detail page, click the **Settings** tab.
2. Scroll to the **Public access** section (may also be labeled **R2.dev subdomain** or **Allow Access**).
3. Click **Allow Access** (or toggle the switch to enabled).
4. Cloudflare will show a confirmation warning that states: "Enabling public access will allow anyone with the URL to access objects in this bucket." Click **Allow** to confirm.
5. After enabling, Cloudflare assigns a public URL in the form:  
   `https://pub-<random-hex>.r2.dev`  
   Copy this URL and save it — you will put it in `R2_PUBLIC_URL_GLB` in your `.env.local`.

**Trade-off: `pub-xxx.r2.dev` default vs. custom domain**

| Option | Setup effort | HTTPS | CDN | MVP appropriate? |
|---|---|---|---|---|
| `pub-xxx.r2.dev` (Cloudflare default) | Zero — enabled above | Yes, automatic | Cloudflare edge | Yes — use this for MVP |
| Custom domain (e.g. `files.forge.dev`) | Requires a domain on Cloudflare, DNS record, Workers Route or R2 custom domain config | Yes | Cloudflare edge | Post-launch polish |

For MVP, use the `pub-xxx.r2.dev` URL. You can attach a custom domain later without touching any application code — only the env var changes.

Expected outcome: the public access section shows a `pub-xxx.r2.dev` URL with a green "Enabled" indicator.

---

## Step 8 — Enable public read access on `forge-media`

1. Open the `forge-media` bucket, click **Settings**.
2. Repeat Step 7 steps 2–5.
3. Copy the `pub-xxx.r2.dev` URL assigned to `forge-media` — this is a **different URL** from the one assigned to `forge-glb`. Save it for `R2_PUBLIC_URL_MEDIA`.

Expected outcome: `forge-media` has its own distinct `pub-xxx.r2.dev` URL.

---

## Step 9 — Generate an R2 API token

This token gives the backend write access to both buckets. It will never be used for reads (reads use the public URLs from Steps 7–8).

1. In the Cloudflare dashboard, click **R2** in the left sidebar to return to the overview.
2. In the top-right area of the R2 overview page, click **Manage R2 API Tokens** (may also appear as **API Tokens** or an icon of a key).

   > Dashboard layout note: as of mid-2025, this button lives in the top-right corner of the R2 overview page, not under the main Cloudflare account API Tokens page. If you do not see it, look under the R2 overview page's action menu or search "R2 API tokens" in the Cloudflare dashboard search bar.

3. Click **Create API Token**.
4. Fill in the form:
   - **Token name:** `forge-r2-write` (any memorable name is fine)
   - **Permissions:** select **Object Read & Write** (not Admin). This grants read and write on objects but not the ability to create or delete buckets.
   - **Bucket access:** choose **Specific buckets**, then add `forge-glb` and `forge-media`. Do NOT select "All buckets" — least-privilege principle.
   - **TTL / expiry:** leave as No expiry for now. (You can rotate later.)
   - **Client IP filtering:** leave blank unless you know your Vercel outbound IP range.
5. Click **Create API Token**.
6. Cloudflare shows the token credentials **exactly once**. You must copy them now before closing this page.

Expected outcome: a modal or confirmation page showing three values:
- **Access Key ID** — a long alphanumeric string
- **Secret Access Key** — a longer alphanumeric string (shown once)
- **S3 endpoint URL** — in the form `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

---

## Step 10 — Capture credentials and identify env var mappings

Copy each value from the token page into your notes:

| What Cloudflare calls it | Your `.env.local` var | Notes |
|---|---|---|
| Access Key ID | `R2_ACCESS_KEY_ID` | |
| Secret Access Key | `R2_SECRET_ACCESS_KEY` | Shown once — do not lose this |
| Account ID (from the S3 endpoint URL, the segment before `.r2.cloudflare`) | `R2_ACCOUNT_ID` | Also visible on your Cloudflare dashboard home page under "Account ID" in the right sidebar |
| `forge-glb` (literal string) | `R2_BUCKET_GLB` | Already set in `.env.example` |
| `forge-media` (literal string) | `R2_BUCKET_MEDIA` | Already set in `.env.example` |
| `pub-xxx.r2.dev` URL for `forge-glb` | `R2_PUBLIC_URL_GLB` | Copied in Step 7 |
| `pub-xxx.r2.dev` URL for `forge-media` | `R2_PUBLIC_URL_MEDIA` | Copied in Step 8 |

**Where to find Account ID if you missed it:**  
On any Cloudflare dashboard page, look at the right-hand sidebar — there is a section labeled "Account ID" with a copy button.

---

## Step 11 — Update `.env.local`

Open `/Users/mk_sindhu/dev/forge/.env.local` and fill in the R2 section:

```
R2_ACCOUNT_ID=<YOUR_ACCOUNT_ID>
R2_ACCESS_KEY_ID=<YOUR_ACCESS_KEY_ID>
R2_SECRET_ACCESS_KEY=<YOUR_SECRET_ACCESS_KEY>
R2_BUCKET_GLB=forge-glb
R2_BUCKET_MEDIA=forge-media
R2_PUBLIC_URL_GLB=https://pub-xxxxxxxxxxxx.r2.dev
R2_PUBLIC_URL_MEDIA=https://pub-yyyyyyyyyy.r2.dev
```

Replace placeholders with your actual values. Do not commit this file — it is gitignored.

Also add these vars to Vercel:
1. Go to your Vercel project → **Settings** → **Environment Variables**.
2. Add each of the seven R2 vars above.
3. For `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: set scope to **Production**, **Preview**, and **Development**.
4. For `R2_BUCKET_GLB`, `R2_BUCKET_MEDIA`, `R2_PUBLIC_URL_GLB`, `R2_PUBLIC_URL_MEDIA`: same three scopes.
5. Click **Save**.
6. Vercel will prompt you to redeploy for the vars to take effect — do that after all seven are entered.

---

## Step 12 — Verify the credentials work

This is a manual curl-based smoke test. It uses the S3-compatible API directly — no SDK, no code changes needed.

### 12a — Test write (upload a tiny text file)

Open your terminal and run the following. Fill in the bracketed values from Step 10.

```bash
curl -X PUT \
  "https://<YOUR_ACCOUNT_ID>.r2.cloudflarestorage.com/forge-glb/_smoke-test.txt" \
  --aws-sigv4 "aws:amz:auto:s3" \
  --user "<YOUR_ACCESS_KEY_ID>:<YOUR_SECRET_ACCESS_KEY>" \
  -H "Content-Type: text/plain" \
  -d "forge smoke test"
```

Expected outcome: HTTP 200 with an empty body (no error message). If you get 403, the credentials are wrong or the bucket name does not match. If you get 404, the account ID in the URL is wrong.

> `--aws-sigv4` requires curl 7.75 or later. Run `curl --version` to confirm. On macOS with Homebrew: `brew install curl` if needed.

### 12b — Test public read

After the PUT succeeds:

```bash
curl "https://pub-<YOUR_GLB_HEX>.r2.dev/_smoke-test.txt"
```

Expected outcome: the response body is `forge smoke test`. If you get 403, public access was not enabled correctly on `forge-glb` — return to Step 7.

### 12c — Clean up the test object

```bash
curl -X DELETE \
  "https://<YOUR_ACCOUNT_ID>.r2.cloudflarestorage.com/forge-glb/_smoke-test.txt" \
  --aws-sigv4 "aws:amz:auto:s3" \
  --user "<YOUR_ACCESS_KEY_ID>:<YOUR_SECRET_ACCESS_KEY>"
```

Expected outcome: HTTP 204. The test file is gone.

---

## What to tell the team when this is done

Once all 12 steps complete without errors, post the following to the build log (do not include actual credential values):

> "R2 done. Both buckets created and public. GLB URL: `https://pub-xxx.r2.dev`, Media URL: `https://pub-yyy.r2.dev`. Creds in `.env.local` and Vercel. Smoke test passed."

That triggers Task 4: backend-dev wires the `@aws-sdk/client-s3` + presigned PUT URL handler.

---

## Flags and uncertainties to verify in the dashboard

1. **CORS tab location** — Cloudflare has moved CORS config between the top-level bucket tabs and Settings → CORS in different dashboard versions. If you don't see a "CORS" tab, look inside the Settings tab.
2. **"Manage R2 API Tokens" button placement** — this button has appeared in different places across dashboard releases (top-right of R2 overview, inside a "..." menu, or under account-level API Tokens). If it is not visible in the R2 overview, go to `https://dash.cloudflare.com/profile/api-tokens` and look for an R2-specific token option there.
3. **Public access toggle label** — has been labeled "Allow Access", "R2.dev subdomain", and "Public access" across different releases. Look for any option under Settings that references `r2.dev` or "public".
4. **Location/region options** — the WNAM region option in the tracker may show as "Western North America", "US West", or may not be available if Cloudflare has changed their region list. Automatic is always safe.
5. **Payment method requirement** — as of early 2026 Cloudflare still requires a card to unlock R2 even for the free tier. If this has changed (card no longer required), you can skip that part of Step 2.
