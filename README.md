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
```

That's the whole thing. There is no server: the app fetches these two paths over
HTTPS and everything else happens on the phone.

## Adding a pack

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: make the pack in the app,
save it to a file, open a pull request adding that file to `packs/` and a row to
`index.json`. A check runs on the pull request and tells you if anything is off.

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
