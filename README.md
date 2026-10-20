# Marketing A3

A self-hosted AI ad studio on **your own API keys** (OpenRouter + Higgsfield + anything else with an HTTP API). Every model shows its price when you pick it, and every charge is recorded, so you always know your spend.

Zero npm dependencies. Needs Node 20+.

```bash
node server.js            # http://127.0.0.1:3000
npm test
```

## First run: guided Setup

A new install opens on **Setup**, a short stepper that reads its status from the live app: add your keys (with a test), load OpenRouter models and import Higgsfield models with exact prices, choose default models (with the cost of a sample ad shown), optionally set a budget, and add a product and actor. Each step stays open after you act so you can see what it did. The sidebar shows progress until it is complete. The layout works on phones (menu drawer, stacked cards, no sideways scrolling).

## Quick Ad (the fast way)

Pick a product and an actor, optionally type an idea, and click **Write & render my ad**. The app writes the concept with your default writing model, then renders every scene with your default image/video models. The full price is shown first, and your monthly budget cap is checked for the whole run before anything is spent. Set the defaults once on the Models page (*Make default*). The first-run checklist on the Quick Ad screen shows what's left to set up.

## Quick start

1. **Settings**: paste your OpenRouter key (and Higgsfield key). Optionally set a monthly budget.
2. **Models**: press *Refresh OpenRouter list* to load every text and image model with its live price.
3. **Library**: add your products and actors (consented talent only).
4. **Ad Composer**: pick product, actor, platform, style, brief and a **writing model**. You get editable concepts (hook, script, per-scene image/motion prompts, caption, hashtags, CTA).
5. Pick image and video models for a concept, check the itemised price, and generate. Results land in the **Gallery**; charges land in **Spend**.

**Studio** is the manual route: write the prompts yourself for one scene.

## The ad writer (how it stays good, even on a free model)

Models are not trusted. Every ad goes through the same pipeline (`lib/composer.js`, `lib/prompts.js`, `lib/adcheck.js`):

1. **One focused call per version**, each with its own proven ad structure (UGC testimonial, problem→solution, demo, unboxing, day-in-the-life, offer, old-vs-new, sensory) and hook formula, so versions are genuinely different. Offer-led ads are only used if the product has an offer.
2. **Fenced, grounded prompts.** Your product facts, offer and price are the only things the ad may claim. Product text, briefs and imported web pages are fenced in tags with angle brackets neutralised, and the system prompt says never to follow instructions found inside them.
3. **Strict validation** of every reply: JSON shape, exact scene count, empty prompts, placeholders (`[product]`), voiceover that won't fit the scene, banned claims (guarantees, "clinically proven", fake urgency, fake social proof), numbers that are not in your product data, and your own forbidden words.
4. **Automatic repair.** If a rule is broken, the model is shown the exact problems and asked to fix them (up to 2 times, and never past your budget cap).
5. **Deterministic autofix.** `@actor`/`@product` tags, realism guards (correct hands, sharp label, no watermark, no morphing), the `#ad` disclosure.
6. **Optional polish pass** (a second editing call, priced in the quote).
7. Anything still wrong is shown in red on the concept ("Review before rendering"), never hidden. Every paid attempt is on the ledger.

Put your real facts in **Library → product → Facts**. Ads can only state what is listed there. Brand voice, banned words and default CTA are in **Settings → Brand**.

## Prompt Director (the text model writes the full image and motion prompts)

In **Studio**, the "Write with AI" panel takes a one-line idea and the writing model returns a complete image prompt and motion prompt for your product and actor, or upgrades the prompts you already wrote ("Improve what I wrote"). In **Ad Composer**, each concept has a **Polish prompts** tab that rewrites every scene's prompts in one call so the look stays consistent from scene to scene. Both have **Standard** and **Cinematic** detail, show the price before you run, are charged to the spend ledger (purpose `prompt`) and respect the monthly cap, and have Undo. Output is checked (length, @actor/@product tags, no readable text in the picture, no real people or brands) and repaired up to twice before you are charged for a failure.

### Real-ad realism (why the video should not look like AI slop)
Every prompt the app writes follows one rule set (`lib/realism.js`): a named lens, camera height and light source; ordinary real places with a few props; honest imperfections instead of "flawless" skin; one slow camera move plus one small human action per clip; physics that holds (gravity, contact, liquids, hair and fabric trailing, a rigid product that never changes shape). Quality buzzwords (masterpiece, 8k, hyper-realistic...) are removed automatically, and motion that image-to-video models cannot do (floating, morphing, spinning, splashes, talking to camera, fast pans) is sent back to the writer with the exact words named. The **Prompt Director** setting in Ad Composer (and Quick Ad, always on) runs a second pass that rewrites every scene into a shot note.

Tips that matter as much as the prompt: keep clips to 3-5 seconds and cut between them like a real ad; use a strong image-to-video model; generate two takes of important shots and keep the better one.

## Import from a link

Library → *Import from a link*. The page is fetched safely (public addresses only, DNS pinned, redirects re-checked, size and time limits), the writing model organises it, and **every fact must quote the page verbatim or it is dropped**. You review the draft before saving.

## Tools (everything else a model can do)

The **Tools** page runs any model you register on the Models page: image edit / product placement, upscale, lip-sync / talking avatar, audio, video transforms. Each model declares its inputs (prompt, image, video, audio, length), you supply them from your Library, Gallery or an upload, and you get a price first, a Gallery result, and a ledger entry. Use *Use in Tools* on any result to chain it into the next step. Inputs are sent as base64 data URIs, so the provider must accept those (25 MB limit per file here).

`docs/higgsfield-research-brief.md` lists exactly what to look up in Higgsfield's docs to turn their models into working configs.

## Keys, model lists and spend accuracy

- **Test key** (Settings): OpenRouter shows the key's label, usage and balance. Higgsfield has no documented account endpoint, so its key is tested with the documented estimate call (import its models first). A rejected key is reported, not thrown.
- **Reconcile** (Spend → Check against OpenRouter): OpenRouter's own usage figure beside what this app recorded. They can differ if the same key is used elsewhere, so the difference is shown, not "fixed".
- **Model lists stay current.** Sync now (Models) and a background pass (every 12 hours by default, Settings) re-read OpenRouter's list and the saved Higgsfield spec and re-fetch exact Higgsfield prices. New endpoints are added, changed ones updated, and ones the provider dropped are flagged *removed by provider* (your history and prices are kept). The background pass only runs while the server is running.
- **Price changes are tracked.** Every refresh compares prices; moves show as a banner on Models, with a note when it is a model you use.
- **Learned costs.** After 3 real runs where OpenRouter reported what it actually charged, quotes for that model use the real average (tagged *learned*) instead of the token-based guess. Each purpose learns separately (full ads, hooks, link import, images). A price you typed always wins; turn it off in Settings.
- **Favorites and hidden models** are saved on the server. Transient errors are retried (OpenRouter 429/5xx on reads, 429/503 on paid calls only, since those mean "not processed"); an auth failure is never retried.
- `data/db.json` holds your API keys and is created owner-only (mode 600). Keep `data/` out of git and backups you share.
- **Higgsfield spend is estimate-based:** its status response documents no charged amount, so those ledger rows are marked *estimate*. Compare with the Higgsfield console now and then.

## Pricing and spend

- **Text models** (OpenRouter): live USD per 1M tokens from OpenRouter's model list. The per-call price shown is an estimate from the token assumptions in Settings; the **actual** cost is recorded from OpenRouter's reported usage after each call.
- **OpenRouter image models**: billed as output tokens, so the price is marked *estimate* until a real run reports the actual cost.
- **Higgsfield / custom video and image models**: you enter the price from the provider's pricing page (per second, per video or per image). A model with no price is **refused** rather than guessed.
- Recording: the ledger stores *actual* when the provider reports a cost and *estimate* otherwise (Spend labels each row). Failed generations are not charged in the ledger, so check your provider dashboard for anything billed on failure.
- **Budget**: a monthly cap blocks jobs and composer runs that would pass it, counting work already queued. `0` = no cap.
- Export the full ledger from Spend as CSV.

## Higgsfield (facts confirmed from its docs, 2026-01-19)

Copied from docs.higgsfield.ai: base URL `https://api.higgsfield.ai`; `Authorization: Key <key id>:<secret>` (check the exact format on their Authentication page; legacy `hf-api-key` / `hf-secret` headers also work); one asynchronous lifecycle: submit, then poll the returned `status_url` until `completed` (statuses: `queued`, `in_progress`, `completed`, `failed`, `nsfw`, `canceled`); the finished video is at `video.url`; successful requests are charged in credits, **failed and `nsfw` requests are not charged**; output is kept for at least 7 days (this app saves your own copy). Each model has its own submit path and body, so copy those from the model's page and use **Test**. Submits send an `Idempotency-Key` when your config includes `"Idempotency-Key": "{{idempotencyKey}}"`, so a retried submit is not billed twice.

### Import every Higgsfield model from its OpenAPI spec

Models → **Import from OpenAPI**. The app reads the spec from your computer (Higgsfield documents `https://docs.higgsfield.ai/docs/openapi.json`; use the JSON link, not the docs page), builds one model per endpoint using the spec's own field names, and shows a review table with notes (fixed values it had to choose, allowed durations and ratios, anything it could not classify). Requests are later snapped to the allowed ratios and durations in the spec instead of failing.

### Exact prices

Higgsfield documents `POST /estimate/{model-path}`, which takes the same body as a real request and returns the cost (`{"credits": "1.500", "usd": "0.094"}`). **Get exact prices** (or *Get price* on a row) calls it with realistic sample values and stores the result, tagged *from provider*. For models with a length input it asks for two lengths: if cost scales with length it becomes a per-second price, otherwise a flat price for the shorter length. Models that need a real video or audio file cannot be estimated automatically; set those by hand. Assumption to check on your account: the docs describe estimating as a pre-submit step, but do not say whether calls are rate-limited.

## Adding Higgsfield and other models

Models page → *Add Higgsfield / custom model*. Each model is a name, a price and a JSON call config:

```json
{
  "submit": { "url": "https://…/<model-path>", "headers": { "Authorization": "Key {{apiKey}}" },
              "body": { "prompt": "{{prompt}}", "image_url": "{{image}}", "duration": "{{duration}}" } },
  "poll":   { "url": "{{submit.status_url}}", "statusPath": "status", "resultUrl": "{{submit.response_url}}" },
  "resultPath": "video.url"
}
```

- Placeholders: `{{prompt}} {{ratio}} {{width}} {{height}} {{duration}} {{image}}` (keyframe as a data URI), `{{images}}` (actor + product), `{{actorImage}} {{productImage}}`, `{{apiKey}}`, `{{submit.<field>}}` (from the submit response). A value that is exactly one placeholder keeps its type; `{{duration|string}}` forces text.
- Omit `poll` for synchronous APIs. `poll.resultUrl` is fetched after the status turns done. `resultPath` is a dotted path (comma-separated fallbacks) to the output URL.
- Use **Test** on a model to submit one real request and see the raw response (it may be billed).

**The Higgsfield and OpenRouter-video templates are starting points, not verified configs.** They were written without access to those providers' docs, so check the model path, auth header format, request fields and result path against Higgsfield's API documentation and use Test before relying on them.

Keys: `OPENROUTER_API_KEY`, `HIGGSFIELD_KEY`, `CUSTOM_API_KEY` override the Settings page. See `.env.example`.

## Login and hosting

- **Local use:** no login is needed; the app listens on `127.0.0.1` only.
- **Hosted use:** set `APP_USERNAME` and `APP_PASSWORD`. The browser shows a login prompt; repeated wrong guesses lock that IP out for 5 minutes. With `HOST=0.0.0.0` and no `APP_PASSWORD`, the app **refuses to start**, because it spends money on your keys.
- Set the credentials as **environment variables on the host**, never in the repo. If your password contains `$`, wrap it in single quotes in a shell (`'pa$$word'`); host dashboards take it as typed.
- A `Dockerfile` is included. Mount a persistent volume at `/data` (database, photos, results live there), expose port 3000, and use `/healthz` for health checks. Always serve over HTTPS (Railway, Render and Fly.io do this for you); basic auth is only safe over HTTPS.

## Starter research packs

`knowledge/*.json` ships rules that carry a quote and URL from the page they came from (Knowledge → Starter packs). Always press **Verify sources** after loading: it re-checks every quote against the live page from your computer and holds back anything it cannot confirm.

## Notes

- Keys live in `data/db.json` (gitignored) and never go to the browser. If you bind to anything other than localhost, set `APP_PASSWORD`.
- Provider output URLs expire, so results are downloaded to `data/outputs/`. Jobs resume after a restart.
- Not built yet: voiceover/lip-sync, stitching scenes into one video, multiple users.
