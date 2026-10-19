# Marketing A3

A self-hosted AI ad studio on **your own API keys** (OpenRouter + Higgsfield + anything else with an HTTP API). Every model shows its price when you pick it, and every charge is recorded, so you always know your spend.

Zero npm dependencies. Needs Node 20+.

```bash
node server.js            # http://127.0.0.1:3000
npm test
```

## Quick start

1. **Settings**: paste your OpenRouter key (and Higgsfield key). Optionally set a monthly budget.
2. **Models**: press *Refresh OpenRouter list* to load every text and image model with its live price.
3. **Library**: add your products and actors (consented talent only).
4. **Ad Composer**: pick product, actor, platform, style, brief and a **writing model**. You get editable concepts (hook, script, per-scene image/motion prompts, caption, hashtags, CTA).
5. Pick image and video models for a concept, check the itemised price, and generate. Results land in the **Gallery**; charges land in **Spend**.

**Studio** is the manual route: write the prompts yourself for one scene.

## Pricing and spend

- **Text models** (OpenRouter): live USD per 1M tokens from OpenRouter's model list. The per-call price shown is an estimate from the token assumptions in Settings; the **actual** cost is recorded from OpenRouter's reported usage after each call.
- **OpenRouter image models**: billed as output tokens, so the price is marked *estimate* until a real run reports the actual cost.
- **Higgsfield / custom video and image models**: you enter the price from the provider's pricing page (per second, per video or per image). A model with no price is **refused** rather than guessed.
- Recording: the ledger stores *actual* when the provider reports a cost and *estimate* otherwise (Spend labels each row). Failed generations are not charged in the ledger, so check your provider dashboard for anything billed on failure.
- **Budget**: a monthly cap blocks jobs and composer runs that would pass it, counting work already queued. `0` = no cap.
- Export the full ledger from Spend as CSV.

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

## Notes

- Keys live in `data/db.json` (gitignored) and never go to the browser. If you bind to anything other than localhost, set `APP_PASSWORD`.
- Provider output URLs expire, so results are downloaded to `data/outputs/`. Jobs resume after a restart.
- Not built yet: voiceover/lip-sync, stitching scenes into one video, multiple users.
