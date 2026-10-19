# Marketing A3

A self-hosted AI ad studio in the spirit of Higgsfield and Runway's agent tools, running on **your own API keys** so you pay provider rates instead of app subscriptions.

1. Upload your **products** and your **actors** (consented talent only).
2. Pick a style, add a brief, optionally preview the AI-written concept.
3. Generate a keyframe of the actor with the product, then animate it into a video.

Zero npm dependencies. Needs Node 20+.

```bash
node server.js            # http://127.0.0.1:3000
npm test
```

Open **Settings** and pick a provider: **Custom models** (your own endpoints, recommended), **Runway**, or **Demo** (free placeholder images, the default).

## How a generation works

| Stage | What happens | Runway model |
|---|---|---|
| Concept | Claude writes the scene prompt, motion prompt and a spoken line (optional; template fallback without a key) | – |
| Keyframe | Actor and product photos are sent as tagged references (`@actor`, `@product`) | `gen4_image` |
| Video | Keyframe is animated, 5 or 10 s | `gen4_turbo` |

Results are downloaded to `data/outputs/` because provider URLs expire. Jobs persist and resume after a restart.

## Bring your own models (Custom provider)

Settings → Custom models takes two JSON configs, one per stage:

- **image**: actor + product references → keyframe. Placeholders: `{{prompt}} {{ratio}} {{width}} {{height}} {{actorImage}} {{productImage}} {{images}}` (both as an array).
- **video**: keyframe → video. Placeholders: `{{prompt}} {{ratio}} {{width}} {{height}} {{duration}} {{image}}` (data URI).

Common to both: `{{apiKey}}` (from the key field or `CUSTOM_API_KEY`) and `{{submit.<field>}}` (fields from the submit response). A value that is exactly one placeholder keeps its type; `{{duration|string}}` forces text.

```json
{
  "submit": { "url": "https://queue.fal.run/<model>", "headers": { "Authorization": "Key {{apiKey}}" },
              "body": { "prompt": "{{prompt}}", "image_url": "{{image}}", "duration": "{{duration|string}}" } },
  "poll":   { "url": "{{submit.status_url}}", "statusPath": "status", "resultUrl": "{{submit.response_url}}" },
  "resultPath": "video.url"
}
```

- Omit `poll` for synchronous APIs: the result is read straight from the submit response.
- `poll.resultUrl` (optional) is fetched after the status turns done, for APIs that serve results from a second URL.
- `resultPath` is a dotted path (comma-separated fallbacks allowed) to the output URL; an array uses its first item.
- Status values: done = `completed/succeeded/success/done/finished` (override with `poll.doneValues`); failed = `failed/error/canceled`.
- Self-hosting (ComfyUI, Wan, LTX, Hunyuan, …): put a small HTTP wrapper in front of the model that accepts the JSON above and returns a result URL. Output URLs are downloaded to `data/outputs/`.

**Load fal.ai example** in Settings fills in a starting point. Model slugs and field names change, so check the provider's docs before relying on it.

## Adding a built-in provider

Implement `startImage`, `startVideo`, `poll` in `lib/providers/<name>.js` (see `runway.js`), register it in `lib/providers/index.js`, and add its name to the allow-list in `lib/settings.js`.

## Notes

- Cost figures are **estimates** from the rates in Settings; check your provider's pricing.
- Keys live in `data/db.json` (gitignored) and are never sent to the browser. If you bind to anything other than localhost, set `APP_PASSWORD`.
- Not built yet: voiceover/lip-sync, multi-scene storyboards, batch variants, auth for multiple users.
