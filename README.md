# Läsrum — Swedish reading room

A personal Swedish reading app with TXT/web imports, contextual translations, vocabulary cards and notes, Swedish speech, and account-scoped cloud synchronization.

## Cloud deployment

The production frontend is built for GitHub Pages. Google authentication, PostgreSQL records, Realtime updates, private audio caching, and AI/web-import functions use Supabase. See [cloud setup](docs/CLOUD-SETUP.md) for OAuth, owner allowlisting, function secrets, data migration, and recovery instructions.

```sh
npm ci
npm test
npm run check:publish
npm run build
```

The GitHub Actions workflow publishes `dist/` after tests pass. `public/project-config.json` contains only the public Supabase URL/publishable key. All private records are protected by RLS and the owner allowlist; OpenRouter credentials belong only in server secrets.

`npm run dev` starts the cloud-enabled frontend. `npm start` starts the original localhost server and data for backups; `npm run dev:local` watches that server. **Export complete backup** on localhost preserves articles, words, notes, AI answers, deleted-article state, settings, and reading positions. Import it only after signing into the hosted app.

Synchronization uses an atomic IndexedDB snapshot/journal, idempotent record writes, version checks, tombstones, and explicit conflict resolution. Reconnect/focus/polling reconcile missed Realtime notifications. Long speech requests are split into provider-sized cloud calls and combined into one seekable WAV.

The following notes describe the original local prototype and remain useful for local AI configuration.

A local Swedish reading prototype and OpenRouter voice evaluation workspace. The working interface name is Läsrum, meaning reading room. This is Phase 0, not the complete product.

## Run locally

Requires Node.js 22 or later. No dependency installation is necessary.

```powershell
cd F:\ReadLang-vibe
npm start
```

Open http://127.0.0.1:4317. Alternatively, run `start.ps1` from PowerShell. The server binds only to this computer.

## Configure OpenRouter

Copy `.env.example` to `.env` in this project and fill in `OPENROUTER_API_KEY` locally. If `.env` already exists, edit it rather than replacing it. Restart the server after changes. Never send the key in chat or commit it to source control.

The selected speech model is **google/gemini-2.5-flash-tts** through the OpenRouter speech endpoint. The initial voice comparison is **Kore vs Puck**; both are listed in the public model catalog. Change the voice IDs to compare other voices. The public catalog can be loaded without a key. Actual generation requires an OpenRouter key with credits.

The model returns raw 24 kHz mono 16-bit PCM. The backend adds a WAV header for browser playback and caches audio in `.cache/`. Cache identity includes model, voice, input text, format, and instructions. No browser speech synthesis fallback is used.

Translation and explanations use **nvidia/nemotron-3.5-lightning:free**, selected by the product owner. It is configured separately from the speech model using `OPENROUTER_TEXT_MODEL`. The public catalog does not advertise JSON response-format enforcement for this model, so the application requests JSON in the prompt and validates every returned field. Free-model availability and rate limits may change.

## Try the prototype

Open **Library** to import your own article. Choose **Paste text**, **TXT file**, or **Webpage link**. Web links first produce an editable title/body preview; select **Save and open** to add the article and read it. Public static webpages are supported; for sign-in pages, blocked sites, or JavaScript-only content, paste the article text. TXT files must use UTF-8 and be at most 512 KB; each article may contain up to 100,000 characters. The library supports title/content search and restores the last opened article after refresh.

Imported articles use the same word/phrase lookup, automatic Swedish pronunciation, vocabulary cards, and notes as the sample. Article playback splits long inputs into provider-sized requests and combines the PCM into a single seekable WAV; the audio becomes available once all segments finish generating. Longer articles take longer and use more OpenRouter credits.

1. In Read, click **stilla**, **morgon**, and **Göteborg**. Their translations coexist.
2. Switch to Phrase and click **tycker**, then **om**. You can also drag-select the expression.
3. Add a personal note. Open Words or refresh; the note remains.
4. Clear inline translations. Saved vocabulary remains.
5. Read lookups use English and OpenRouter AI directly; no language/source dropdowns are shown. The microphone icon beside the selected expression replays its Swedish pronunciation.
6. Open Words to expand a card, edit notes, or request another AI explanation. Each card has its own pronunciation button.
7. Open Voice studio. Generate the same passage for Kore and Puck, listen, score each sample, and export the evaluation.

New Read lookups require the configured OpenRouter key. Previously saved authored demo entries remain in Words with their original labels.

Each Library article has a delete icon. Deleting moves it out of the active list into **Recently deleted**, where **Restore article** makes it available again. Deleted articles are not reopened by refresh. Saved vocabulary, source sentences, and notes remain available.

## Validation

```powershell
npm test
```

Tests cover Swedish token offsets, phrase overlap, saved-note preservation, API errors, missing credentials, PCM-to-WAV conversion, audio caching, and contextual lookup cache separation. Provider tests use controlled responses and do not establish real voice quality or live API success.

## Scope and storage

Articles, the last opened article, vocabulary, notes, and evaluation scores are stored in this browser's localStorage. Audio is cached on the server's disk. Vocabulary/evaluation JSON exports are available. Browser storage limits apply; a failed article save leaves the draft available to copy or shorten.

The prototype now includes the original sample, a personal article Library, word/phrase interactions, expandable vocabulary cards, article playback, real API adapters, and a voice evaluation UI. EPUB parsing, saved scroll positions, synchronized highlighting, flashcard scheduling, and user accounts remain future work.

See `docs/PRD.md` for the product specification and `docs/PHASE0.md` for evaluation status and the remaining exit criteria.

