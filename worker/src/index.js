/**
 * Turns a pack submitted from the Aloud app into a pull request.
 *
 * This exists so a reader never has to own a GitHub account to contribute a
 * pronunciation. It holds the only credential in the system, which is why it
 * validates everything itself rather than trusting the app: the app is on a
 * phone somebody else owns, and anything it enforces can be bypassed by not
 * using the app.
 *
 * It opens pull requests. It never merges. Nothing reaches another reader until
 * a human has looked at it, which is what keeps moderation a review step rather
 * than an incident response.
 */

const SCHEMA_VERSION = 1;

const LIMITS = {
  rules: 500,
  name: 60,
  description: 240,
  ruleChars: 120,
  bodyBytes: 256 * 1024,
};

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LINKISH = /https?:\/\/|www\./i;

/** Submissions per IP per day. Generous for a person, useless for a script. */
const DAILY_LIMIT = 5;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (request.method !== "POST") return fail(405, "Send a POST");

    const url = new URL(request.url);
    if (url.pathname !== "/submit") return fail(404, "Unknown endpoint");

    // Content-Length can lie, so the body is also capped when it is read.
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > LIMITS.bodyBytes) return fail(413, "That pack is too large");

    if (!request.body) return fail(400, "There was no pack in that request");

    let body;
    try {
      body = await readCapped(request, LIMITS.bodyBytes);
    } catch {
      return fail(413, "That pack is too large");
    }

    let pack;
    try {
      pack = JSON.parse(body);
    } catch {
      return fail(400, "That wasn't valid JSON");
    }

    const problems = validate(pack);
    if (problems.length) return fail(400, problems[0]);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (await isRateLimited(env, ip)) {
      return fail(429, "That's a few packs today already — try again tomorrow");
    }

    try {
      const prUrl = await openPullRequest(env, normalise(pack));
      return cors(Response.json({ ok: true, url: prUrl }));
    } catch (e) {
      // The GitHub error is for the logs, not for the phone: it can carry
      // repository detail that is none of a submitter's business.
      console.error("submission failed", e);
      return fail(502, "The workshop couldn't take that just now");
    }
  },
};

/**
 * True if any character is a control code.
 *
 * Compared by code point rather than matched with a regex: writing the range
 * as a character class means putting escape sequences in the source, and every
 * tool between here and the file has an opinion about those.
 */
function hasControlChars(text) {
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Mirrors validate.py, which mirrors the app's parser. */
function validate(pack) {
  const problems = [];
  const text = (value, field, limit, required = true) => {
    if (typeof value !== "string") return problems.push(`${field} must be text`);
    const trimmed = value.trim();
    if (required && !trimmed) return problems.push(`${field} is empty`);
    if (trimmed.length > limit) problems.push(`${field} is longer than ${limit} characters`);
    if (LINKISH.test(trimmed)) problems.push(`${field} may not contain a link`);
    if (hasControlChars(trimmed)) problems.push(`${field} contains control characters`);
  };

  if (!pack || typeof pack !== "object") return ["That wasn't a pack"];
  if (pack.schemaVersion !== SCHEMA_VERSION) problems.push("Pack format is not supported");

  text(pack.name, "The pack name", LIMITS.name);
  text(pack.author, "Your name", LIMITS.name);
  text(pack.description ?? "", "The description", LIMITS.description, false);

  if (!Array.isArray(pack.rules) || pack.rules.length === 0) {
    problems.push("The pack has no words in it");
  } else if (pack.rules.length > LIMITS.rules) {
    problems.push(`A pack can hold ${LIMITS.rules} words at most`);
  } else {
    for (const rule of pack.rules) {
      if (!rule || typeof rule !== "object") {
        problems.push("A word is malformed");
        break;
      }
      text(rule.word, "A word", LIMITS.ruleChars);
      text(rule.say, "A respelling", LIMITS.ruleChars);
      if (problems.length) break;
    }
  }
  return problems;
}

/** The pack as it will be committed: trimmed, deduplicated, id derived here. */
function normalise(pack) {
  const seen = new Set();
  const rules = [];
  for (const rule of pack.rules) {
    const word = rule.word.trim();
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({ word, say: rule.say.trim() });
  }

  const name = pack.name.trim();
  const id = slug(name);
  return {
    id,
    name,
    author: pack.author.trim(),
    description: (pack.description ?? "").trim(),
    rules,
  };
}

function slug(name) {
  const out = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return ID_PATTERN.test(out) ? out : `pack-${Date.now().toString(36)}`;
}

async function readCapped(request, maxBytes) {
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("too large");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(joined);
}

/**
 * Counts submissions per IP per day, if a KV namespace is bound.
 *
 * Optional on purpose: the worker is useful without it, and the real defence is
 * that nothing merges itself. Without KV this is a no-op and spam costs you
 * closing pull requests rather than anything reaching a reader.
 */
async function isRateLimited(env, ip) {
  if (!env.SUBMISSIONS) return false;
  const key = `${new Date().toISOString().slice(0, 10)}:${ip}`;
  const used = Number((await env.SUBMISSIONS.get(key)) || 0);
  if (used >= DAILY_LIMIT) return true;
  await env.SUBMISSIONS.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  return false;
}

// ---- GitHub ---------------------------------------------------------------

async function openPullRequest(env, pack) {
  const repo = `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
  const branch = `submit/${pack.id}-${Date.now().toString(36)}`;
  const path = `packs/${pack.id}.json`;

  const main = await gh(env, `GET /repos/${repo}/git/ref/heads/main`);
  await gh(env, `POST /repos/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: main.object.sha,
  });

  // The id comes from the pack's name, so a submission can collide with a pack
  // that already exists. That is left as a version bump on a pull request rather
  // than rejected here: sometimes it is the original author sending an update,
  // and sometimes it is somebody proposing to replace another person's work. The
  // difference is visible in the diff and invisible from in here, which is
  // precisely the kind of call a review step is for.
  const existing = await ghMaybe(env, `GET /repos/${repo}/contents/${path}?ref=${branch}`);
  const version = existing ? nextVersion(existing) : 1;

  const file = {
    schemaVersion: SCHEMA_VERSION,
    id: pack.id,
    name: pack.name,
    author: pack.author,
    description: pack.description,
    version,
    rules: pack.rules,
  };

  await gh(env, `PUT /repos/${repo}/contents/${path}`, {
    message: `Add pack: ${pack.name}`,
    content: base64(JSON.stringify(file, null, 2) + "\n"),
    branch,
    ...(existing ? { sha: existing.sha } : {}),
  });

  const indexFile = await gh(env, `GET /repos/${repo}/contents/index.json?ref=${branch}`);
  const index = JSON.parse(decodeBase64(indexFile.content));
  const row = {
    id: pack.id,
    name: pack.name,
    author: pack.author,
    description: pack.description,
    wordCount: pack.rules.length,
    version,
    path,
  };
  const at = index.packs.findIndex((p) => p.id === pack.id);
  if (at >= 0) index.packs[at] = row;
  else index.packs.push(row);

  await gh(env, `PUT /repos/${repo}/contents/index.json`, {
    message: `List pack: ${pack.name}`,
    content: base64(JSON.stringify(index, null, 2) + "\n"),
    branch,
    sha: indexFile.sha,
  });

  const pr = await gh(env, `POST /repos/${repo}/pulls`, {
    title: `Pack: ${pack.name}`,
    head: branch,
    base: "main",
    body: [
      `Submitted from the Aloud app.`,
      ``,
      `- **Pack:** ${pack.name}`,
      `- **By:** ${pack.author}`,
      `- **Words:** ${pack.rules.length}`,
      ``,
      `Check the respellings read as the words they claim to, then merge.`,
      `The format is checked automatically by the Validate packs action.`,
    ].join("\n"),
  });
  return pr.html_url;
}

function nextVersion(existing) {
  try {
    return (JSON.parse(decodeBase64(existing.content)).version || 1) + 1;
  } catch {
    return 1;
  }
}

async function gh(env, route, body) {
  const result = await ghRaw(env, route, body);
  if (!result.ok) throw new Error(`${route} -> ${result.status} ${await result.text()}`);
  return result.json();
}

/** Null on 404, for the "does this file exist yet" questions. */
async function ghMaybe(env, route) {
  const result = await ghRaw(env, route);
  if (result.status === 404) return null;
  if (!result.ok) throw new Error(`${route} -> ${result.status}`);
  return result.json();
}

function ghRaw(env, route, body) {
  const [method, path] = route.split(" ");
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // GitHub rejects API calls with no user agent.
      "User-Agent": "aloud-workshop-relay",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/**
 * UTF-8 safe base64.
 *
 * `btoa` works a character at a time and throws on anything above U+00FF, so
 * encoding the string directly would fail on exactly the names a pronunciation
 * pack exists for — Siobhán, Dún Laoghaire, jalapeño.
 */
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(content) {
  const binary = atob(content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---- replies --------------------------------------------------------------

function fail(status, error) {
  return cors(Response.json({ ok: false, error }, { status }));
}

function cors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}
