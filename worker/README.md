# Submission relay

A single Cloudflare Worker that turns a pack sent from the Aloud app into a pull
request on this repository, so a contributor never needs a GitHub account.

It opens pull requests. **It never merges.** Nothing reaches a reader until
someone has looked at it.

## What it needs

A GitHub token with write access to this repository and nothing else. Make a
**fine-grained personal access token**:

github.com → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token

- **Repository access:** Only select repositories → `workshop-repo`
- **Permissions:** Contents → *Read and write*, Pull requests → *Read and write*
- **Expiry:** whatever you'll remember to renew. The relay stops working when it
  lapses, and the app falls back to telling people to use GitHub directly.

Copy the token. You cannot see it again.

## Deploying without installing anything

Easiest if you don't have Node.

1. dash.cloudflare.com → Compute (Workers) → **Create** → **Start with Hello
   World** → name it `aloud-workshop-relay` → Deploy.
2. **Edit code**, select everything in the editor, paste in the whole of
   [src/index.js](src/index.js), Deploy.
3. Settings → **Variables and Secrets**:
   - `GITHUB_OWNER` = `MichealFinnerty` (type: Text)
   - `GITHUB_REPO` = `workshop-repo` (type: Text)
   - `GITHUB_TOKEN` = the token (type: **Secret**)
4. Deploy again so the variables take effect.

## Deploying with wrangler

Needs [Node](https://nodejs.org) installed.

```bash
cd worker
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN
```

## Pointing the app at it

Both routes print a URL like
`https://aloud-workshop-relay.<your-subdomain>.workers.dev`.

**The easy way — no app release.** Add it to `index.json` in this repository, at
the top level beside `packs`, **with `/submit` on the end**:

```json
{
  "schemaVersion": 1,
  "submitUrl": "https://aloud-workshop-relay.your-subdomain.workers.dev/submit",
  "packs": [ ... ]
}
```

Every copy of the app picks it up the next time the workshop tab loads, and the
publish button turns on. The app only accepts an `https` URL on a `.workers.dev`
host with no query or credentials in it, so a tampered index can misdirect a
submission to another worker but not to anywhere else — and only ever after
somebody has read the pack on screen and pressed Publish.

**The other way — compiled in.** Set `WorkshopSource.SubmitUrl` in the app:

```kotlin
const val SubmitUrl = "https://aloud-workshop-relay.your-subdomain.workers.dev/submit"
```

That wins over the index when both are set, and is not held to the `.workers.dev`
rule, because a value compiled into the app is one its author chose rather than
one it was told about.

Until one of the two is set, the app disables the publish button and says the
workshop isn't taking submissions yet. It never sends anybody to a browser —
publishing exists so that a reader never has to leave the app or own a GitHub
account.

## Checking it works

```bash
curl -X POST https://YOUR-WORKER-URL/submit \
  -H "Content-Type: application/json" \
  -d '{"schemaVersion":1,"name":"Relay test","author":"You","description":"Checking the relay","rules":[{"word":"Siobhan","say":"Shiv-awn"}]}'
```

A working relay replies `{"ok":true,"url":"https://github.com/.../pull/1"}` and a
pull request appears. Close it afterwards.

Common replies:

| Reply | Meaning |
| --- | --- |
| `The workshop couldn't take that just now` | GitHub rejected it — token missing, expired, or short a permission. Check the worker's logs in the dashboard. |
| `Pack format is not supported` | `schemaVersion` isn't 1 |
| `... may not contain a link` | The spam guard; packs carry words, not URLs |
| 429 | The per-IP daily cap, if you bound the KV namespace |

## Rate limiting (optional)

```bash
npx wrangler kv namespace create SUBMISSIONS
```

Put the printed id in `wrangler.toml` under the commented-out `kv_namespaces`
block and deploy again. Five submissions per IP per day. Without it the worker
runs fine and the only cost of a flood is pull requests to close.
