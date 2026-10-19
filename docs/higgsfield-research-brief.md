# Research brief: Higgsfield API surface

**Goal.** Marketing A3 (this repo) is a self-hosted ad studio that calls image/video/audio models over HTTP. It can already run *any* model you describe with a JSON call config (see "Adding Higgsfield and other models" in the README and `lib/engines.js`). What is missing is verified, current information about Higgsfield's API so the starting-point templates in `public/views-models.js` (`TEMPLATES.higgsfield`) can be replaced with configs known to work.

**Ground rules for the researcher**
- Use only Higgsfield's official documentation and API responses. Quote the source URL for every answer. If something cannot be verified, say "unverified" instead of guessing.
- Do not paste real API keys into any document.
- Prices must come from Higgsfield's own pricing page or an API response, with the date checked.

## 1. Authentication and base URLs
- Base URL(s) for the API; any separate hosts for submit, status and result.
- Exact auth header format (for example `Authorization: Key ...` or `Bearer ...`), and whether the key is one value or `KEY_ID:KEY_SECRET`.
- Rate limits and concurrency limits.

## 2. The request lifecycle
- Submit endpoint shape. Is the model chosen in the URL path or in the body?
- How to check status: URL, response fields, the exact list of status strings (queued / in_progress / completed / failed / nsfw / cancelled ...).
- Where the finished file URL lives in the response (field path), and how long it stays valid.
- Is there a webhook option? Can a request be cancelled? Are failed jobs refunded?

## 3. Model catalogue (the most important part)
For **every** model available through the API, record:
| model id / path | type (text-to-image, image-to-video, edit, upscale, lip-sync, audio, ...) | inputs it accepts (prompt, image, images[], video, audio, duration, aspect ratio, resolution, seed, style/preset id) | allowed values (durations, ratios, resolutions) | price and unit | max input file size |

Specifically confirm whether these exist and how they are called:
- Image models and reference-image handling (how to pass the actor and product photos; how many references; how the prompt refers to them).
- Image-to-video models, including start/end frame support.
- Camera-motion controls: are they presets passed by id, or free-text only?
- Character consistency (Soul ID or similar): how a character is created/trained, how it is referenced afterwards, cost, and API availability.
- Product placement / image editing / inpainting.
- Upscale and enhance (image and video).
- Lip-sync and talking-avatar models (inputs: image or video + audio or script/voice?).
- Text-to-speech, voice, music, sound effects.
- Video-to-video / recast / character swap.
- Effects and style presets (list of ids) and whether they are API-accessible.
- Storyboard / multi-shot generation.
- Anything called "click to ad", URL-to-ad or ad generation in the API.

## 4. Input file handling
- Does the API accept base64 `data:` URIs, or only public URLs? If URLs only: is there an upload endpoint (and its limits)?
- Max sizes and accepted formats for image, video and audio inputs.

## 5. Pricing model
- Credits vs dollars. Dollar value of one credit on the API plan.
- Per-model price table with units (per image, per second, per video, per run), by resolution/duration where it varies.
- Whether the response reports the cost actually charged (so the app can record exact spend).

## 6. Deliverable
A single markdown file with sections 1-5, each answer cited, plus for each model that supports ad work a **ready-to-paste call config** in this format (placeholders: `{{prompt}} {{image}} {{images}} {{video}} {{audio}} {{duration}} {{ratio}} {{apiKey}} {{submit.<field>}}`):

```json
{
  "submit": { "url": "...", "headers": { "Authorization": "..." }, "body": { } },
  "poll":   { "url": "{{submit.status_url}}", "statusPath": "status", "doneValues": ["..."], "resultUrl": "{{submit.response_url}}" },
  "resultPath": "..."
}
```
Test each config with the **Test** button on the Models page and note the real response.

## Also worth researching (OpenRouter)
- Whether OpenRouter's video generation endpoint is available, its exact request/poll/result fields, and how it reports price. The OpenRouter video template in `views-models.js` is unverified.
- Which free OpenRouter models follow JSON instructions reliably (the writing engine validates and repairs, but a model that returns clean JSON first try costs fewer retries).
