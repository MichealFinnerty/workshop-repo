# Aloud Workshop

Shared pronunciation packs for Aloud, an offline text-to-speech reader for
Android.

A pack is a small list of words the narrator gets wrong and how to say them
instead — names, places, jargon, anything a text-to-speech voice guesses at.
Install one from the app: **Settings → Pronunciations → Workshop**.

## What's here

```
index.json          the catalogue the app reads
packs/*.json        one file per pack
worker/             the relay that turns an in-app submission into a pull request
validate.py         the format check, run on every pull request
```

Reading is server-free: the app fetches `index.json` and a pack file over HTTPS
and everything else happens on the phone. The only moving part is `worker/`,
which exists so that contributing doesn't require a GitHub account.

## Adding a pack

In the app: **Settings → Pronunciations → Workshop → Publish these words as a
pack**. That opens a pull request here. You don't need a GitHub account.

By hand, or to see what the app sends: [CONTRIBUTING.md](CONTRIBUTING.md).

Either way a check runs on the pull request and says if anything is off, and a
person reads the words before it merges.

## Rules for what gets merged

- **Real pronunciations only.** A pack that makes the narrator say something rude
  instead of the word on the page isn't a pronunciation pack.
- **Nothing but words.** No URLs, no messages to the reader, no advertising in
  the name or description.
- **Yours to submit.** Don't copy a pack from somewhere with a licence that
  doesn't allow it.
- **One subject per pack.** "Irish names" and "Norse mythology" are two packs,
  not one; readers install what they need and a pack that mixes them can't be
  half-installed.

Packs here are published under [CC0](LICENSE) — public domain. By opening a pull
request you agree to that, which is what lets the app redistribute the file to
everybody who installs it.
