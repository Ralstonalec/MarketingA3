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

Open **Settings**, choose **Runway**, and paste your key from <https://dev.runwayml.com> (or set `RUNWAY_API_KEY`; see `.env.example`). Until then the **Demo** provider produces free placeholder images so you can try the workflow.

## How a generation works

| Stage | What happens | Runway model |
|---|---|---|
| Concept | Claude writes the scene prompt, motion prompt and a spoken line (optional; template fallback without a key) | – |
| Keyframe | Actor and product photos are sent as tagged references (`@actor`, `@product`) | `gen4_image` |
| Video | Keyframe is animated, 5 or 10 s | `gen4_turbo` |

Results are downloaded to `data/outputs/` because provider URLs expire. Jobs persist and resume after a restart.

## Adding another provider

Implement `startImage`, `startVideo`, `poll` in `lib/providers/<name>.js` (see `runway.js`), register it in `lib/providers/index.js`, and add its name to the allow-list in `lib/settings.js`.

## Notes

- Cost figures are **estimates** from the rates in Settings; check your provider's pricing.
- Keys live in `data/db.json` (gitignored) and are never sent to the browser. If you bind to anything other than localhost, set `APP_PASSWORD`.
- Not built yet: voiceover/lip-sync, multi-scene storyboards, batch variants, auth for multiple users.
