# Adding a pack

## 1. Make the pack in the app

**Settings → Pronunciations → My words.** Add the words you want in the pack,
listening to each one with the preview button until it sounds right.

Respellings are ordinary text, not phonetic notation. Hyphens are the trick that
makes them work — each part is looked up separately, so `Shiv-awn` is read as two
bits the voice already knows. `Siobhán` on its own gets guessed letter by letter.

When it's ready: **Save as pack…**, give it a name and your name, and save the
file somewhere you can find it.

## 2. Check the file

It should look like this:

```json
{
  "schemaVersion": 1,
  "id": "irish-names",
  "name": "Irish names",
  "author": "Your Name",
  "description": "Given names and surnames, as they are actually said",
  "version": 1,
  "rules": [
    { "word": "Siobhán", "say": "Shiv-awn" }
  ]
}
```

| Field | Rules |
| --- | --- |
| `id` | lowercase letters, digits and hyphens only; must match the filename |
| `name` | up to 60 characters |
| `author` | up to 60 characters; a display name, not an email address |
| `description` | up to 240 characters, one line |
| `version` | whole number, starting at 1. **Raise it every time you change the pack** — that is how installed copies find out there's an update |
| `rules` | 1 to 500 entries, each `word` and `say` up to 120 characters |

## 3. Open a pull request

1. Fork this repository.
2. Put your file in `packs/` named `<id>.json` — so `packs/irish-names.json`.
3. Add a row to `index.json`:

```json
{
  "id": "irish-names",
  "name": "Irish names",
  "author": "Your Name",
  "description": "Given names and surnames, as they are actually said",
  "wordCount": 24,
  "version": 1,
  "path": "packs/irish-names.json"
}
```

4. Open the pull request. A check runs automatically and comments if the JSON is
   malformed, the id doesn't match the filename, the index and the pack disagree,
   or a limit is exceeded.

Don't have a GitHub account and don't want one? Open an issue with the file
attached instead and somebody will do the above for you.

## Updating a pack you already published

Change the file, raise `version` in **both** the pack and its `index.json` row,
open a pull request. Anyone with it installed sees an **Update** button the next
time they open the Workshop tab.

## What gets rejected

Packs that don't actually change pronunciation — joke packs that make the
narrator say something else instead of the word on the page. Packs with links or
promotional text in the name or description. Packs copied from a source whose
licence doesn't allow it. See the README for the full list.
