# Cloud setup

The production frontend uses GitHub Pages. PostgreSQL, Google login, Realtime, private audio cache, and backend functions use Supabase. The local Node server remains available for backup and development.

## Public and private configuration

`public/project-config.json` contains a project URL and a **publishable** key, which are intended for browser use. RLS and the owner allowlist protect all personal data. Never put an OpenRouter key, Supabase secret/service key, personal email, backup, or audio file in a public repository.

Apply migrations in order. Add the sole allowed owner's Google email privately to `public.allowed_emails` in Supabase SQL Editor. A confirmed Google login for that address automatically creates its `app_members` entry. Other accounts cannot read learning records, write through the sync RPC, or invoke paid AI functions. Direct client table writes are deliberately revoked.

## Google login

Create an OAuth web client in Google Cloud using only basic profile/email scopes. Set its authorized redirect URI to `https://PROJECT-REF.supabase.co/auth/v1/callback`. Configure the client ID and secret in Supabase Authentication → Sign In / Providers → Google. In Supabase URL configuration, set Site URL and the allowed redirect URL to the exact GitHub Pages application URL, including the repository path and trailing slash. Allow `http://127.0.0.1:5173/` for local cloud development if needed. Login returns to the existing index page using PKCE; no server callback route is required on Pages.

## Functions

Deploy `app-config`, `lookup`, `speech`, `models`, and `import-url`. The platform JWT gateway is disabled because **every function independently verifies the user's JWT with Supabase Auth and checks `app_members` before processing data or calling OpenRouter**. Missing authentication and non-member requests fail closed.

Set the following in Supabase Edge Function secrets:

- `OPENROUTER_API_KEY`: the existing private OpenRouter key.
- `APP_ORIGINS`: comma-separated exact origins, e.g. `https://YOUR-USERNAME.github.io,http://127.0.0.1:5173`. Repository paths are not origins.

Do not replace the built-in Supabase server secrets. The private `speech-cache` bucket uses owner-scoped paths. Audio is disposable: 7-day TTL and 200 MB owner quota are enforced lazily during cache writes. Cached learning text and notes are separate and are never evicted with audio.

## GitHub Pages

Publish only the output of `npm run package:publish`. The reviewed source allowlist excludes local private artifacts. Enable Pages with source **GitHub Actions**. The supplied workflow tests, builds, and publishes `dist/`. Relative asset URLs support `/REPOSITORY/` hosting. Google login and CORS must reference the final Pages address before sign-in is tested.

## Back up and migrate

On the original localhost app, select **Export complete backup**. Keep that file. Sign in to the hosted app, select **Import backup**, review the article/word counts, then confirm the import. The website cannot read another origin's localStorage. Existing cloud records are preserved, repeated imports are deduplicated, different article bodies with colliding IDs receive new IDs, and differing notes are appended rather than erased. Deleted article state, source contexts, settings, AI answers, and reading positions are included. Original localStorage is not cleared.

## Test and recovery

`npm test` exercises real local PostgreSQL via PGlite, IndexedDB via fake-indexeddb, the two-device synchronization engine, backup merging, and both local/cloud API helpers. `npm run build` checks the production bundle. A real Google sign-in plus phone/iPad/desktop checks are still required after external configuration.

Local first writes go to the account's IndexedDB snapshot and journal in one transaction. Cloud retries use idempotency receipts and record versions. Conflicting notes preserve both drafts until explicitly resolved. Deleted lookups retain tombstones. Realtime is a notification; focus/reconnect and periodic version checks recover missed changes. Export a complete backup before account changes or manual database work. Never clear browser data while changes remain pending.

## Long text imports and page speech

UTF-8 TXT imports allow 20 MB files and up to 5 million normalized characters. Long texts split into approximately 12,000-character chapter records, preserving explicit chapter headings where present. Chapter records remain below the existing cloud per-record limit, so no schema migration is needed. Library groups chapter records by bookId. Delete/restore applies to the entire book. Chapter selection, previous/next page controls, and reading progress work across devices. Each page contains complete sentences, normally up to 700 characters; an individual long sentence can occupy a larger page up to the lookup-context limit. Speech requests are capped at 700 characters to reduce provider timeout risk. Read page sends only those sentences to speech, and changing pages stops earlier playback.

Local device mode stores snapshots in IndexedDB and preserves its original localStorage snapshot for recovery. Existing short articles and their vocabulary IDs remain intact. Backups include chapter metadata and per-chapter reading progress.
