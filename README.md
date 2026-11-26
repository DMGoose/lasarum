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

Open **Library** to import your own article. Choose **Paste text**, **TXT file**, or **Webpage link**. Web links first produce an editable title/body preview; select **Save and open** to add the article and read it. Public static webpages are supported; for sign-in pages, blocked sites, or JavaScript-only content, paste the article text. TXT files must use UTF-8 and be at most 20 MB. Imports accept up to 5 million characters and are saved as chapter records, grouped as one book in the Library. Chapter headings are recognized where present; long sections split at paragraph or sentence boundaries. Each chapter has fixed reading pages, and Read page sends only the current page to speech. The library supports title/content search and restores the last opened article after refresh.

Imported articles use the same automatic word/phrase lookup, automatic Swedish pronunciation, vocabulary cards, and notes as the sample. Article playback splits long inputs into provider-sized requests and combines the PCM into a single seekable WAV; the audio becomes available once all segments finish generating. Longer articles take longer and use more OpenRouter credits.

1. In Read, click **stilla**, **morgon**, and **Göteborg**. Their translations coexist.
2. Quickly tap **tycker**, then **om** to look up one phrase. You can also drag-select the expression.
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

Articles, chapters, reading pages, vocabulary, notes, and evaluation scores are stored in IndexedDB. Local device mode migrates the existing localStorage snapshot into IndexedDB while leaving the original snapshot untouched. Audio is cached on the server's disk. Vocabulary/evaluation JSON exports are available. Browser storage limits apply; a failed article save leaves the draft available to copy or shorten.

The prototype now includes the original sample, a personal article Library, word/phrase interactions, expandable vocabulary cards, article playback, real API adapters, and a voice evaluation UI. EPUB parsing, saved scroll positions, synchronized highlighting, flashcard scheduling, and user accounts remain future work.

See `docs/PRD.md` for the product specification and `docs/PHASE0.md` for evaluation status and the remaining exit criteria.


## Local Swedish–English dictionary

Word lookup first uses the bundled Folkets lexikon dataset: 39,207 translated senses and 70,784 indexed Swedish words and inflected forms. Its first download is about 4 MB, then IndexedDB retains it on this device. Dictionary hits make no text-model request. Multiple senses are displayed as dictionary meanings; **Ask AI** explicitly requests an explanation for the current sentence. Missing entries use the configured text model and are cached locally for 30 days, scoped by account, sentence, and explanation language (maximum 2,000 cached results). A dictionary download failure is reported rather than silently making an AI request.

Single-word pronunciation uses only a compact speaker button at normal speed. The reading-page player retains seeking, skip controls, and speed selection. Pronunciation still uses the configured speech service and its audio cache; dictionary lookup does not replace speech generation.

Dictionary data source: [Folkets lexikon, hosted by KTH](https://folkets-lexikon.csc.kth.se/folkets/om.en.html), based on Lexin from the Swedish Language Council, developed by Viggo Kann and Joachim Hollman / Algoritmica HB. The compact derivative retains [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/). Full attribution, source version/hash, and conversion changes are in `public/dictionary-meta.json`; `scripts/build_dictionary.py` reproduces the dataset from the official downloadable XML. No remote dictionary audio is bundled.

## Requested-audio cache

All successfully requested reader/word/voice-studio audio is now saved in a separate on-device IndexedDB database. Replaying the same Swedish text, sentence context, model, and voice under the same account bypasses both the backend and OpenRouter, including after reload. Nothing is generated or fetched in advance. The existing server/cloud audio cache continues to help when an audio clip is first requested from another device. Device clips have no time-based expiry; the 200 MB device budget evicts older clips when full, and clearing browser storage removes them. A failed persistent save falls back to a bounded session cache and never blocks playback. Invalid, failed, or cancelled responses are not saved. Bump the audio cache's pronunciation version if speech instructions or output semantics change.

Word and reader playback show no loading, playing, paused, or finished status text. Only failures show a recoverable error. Swedish pronunciation instructions are shared between local and cloud servers, with targeted guidance for reported words and versioned device caches to avoid reusing earlier pronunciation.

## Practice

Practice presents a daily deck from saved vocabulary, defaulting to 10 words (configurable). Tap or keyboard-activate a word to reveal its saved meanings, grammar, original reading sentence/source, examples, saved AI explanation, and editable note. No AI request occurs on flipping a card. Pronunciation uses the existing requested-audio cache. Rate each card difficult, medium, or easy. Each rating completes that word for today and assigns its group. Each daily deck selects hard words first, then medium, then easy, prioritizing less recently reviewed words within each group with stable daily sampling for ties. New words default to medium; older Again records map to hard. The previous spaced-interval eligibility rule is replaced by daily group sampling. Daily limits and each word's progress use separate existing user_settings sync records; local persistence, backup and the established conflict handling apply. Vocabulary deletion excludes the word from practice.

Reader Previous/Next aligns the new page at its article title, with a 16 px margin, rather than the website header. Reading progress still saves. Article frames follow their content naturally; no minimum page height or blank filler is added. Background synchronization preserves the active reading position without retaining frame heights. Opening another article from Library still restores its reading position.

## Automatic phrase taps

Read has one selection behavior and no Words/Phrase switch. A single tap looks up one word after a 450 ms gesture window. Rapid taps in the same sentence expand one contiguous selection, in either direction; intervening words are included. Only the completed selection is looked up, pronounced, and saved. A later tap on an existing translation undoes it after the same gesture window; a rapid next-word tap instead turns that selection into a phrase without deleting earlier saved vocabulary. Different sentences dispatch separate selections. Repeated taps cancel a pending gesture. Drag selection remains available; changing page/view, clearing translations, signing out or pressing Escape cancels the pending gesture.
## Article-title pagination

The authored sample now contains 28 sentences across four reading pages. Original s1–s8 lookup identities are retained. Previous and Next, including chapter-boundary page turns, move to the article title rather than to the website navigation/header. The article title starts 16 px below the viewport edge. Short final pages keep their natural content height; title scrolling uses the available document space. Background sync still preserves the active viewport. Voice studio evaluation passages remain unchanged and Read page still sends only the current page to speech.