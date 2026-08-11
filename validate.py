#!/usr/bin/env python3
"""Checks the workshop is internally consistent, and matches what the app expects.

Run locally with `python validate.py`; the same script runs on every pull
request. Every rule here mirrors one in the app's own parser — anything this
script passes will install, and anything it fails would have been silently
dropped on somebody's phone instead.
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
PACKS_DIR = ROOT / "packs"
SCHEMA_VERSION = 1

ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]{0,63}$")
LINKISH = re.compile(r"https?://|www\.", re.IGNORECASE)

MAX_RULES = 500
MAX_NAME = 60
MAX_DESCRIPTION = 240
MAX_RULE_CHARS = 120
MAX_PACK_BYTES = 256 * 1024

problems: list[str] = []


def fail(where: str, message: str) -> None:
    problems.append(f"{where}: {message}")


def check_text(where: str, field: str, value, limit: int, required: bool = True) -> None:
    if not isinstance(value, str):
        fail(where, f"{field} must be a string")
        return
    stripped = value.strip()
    if required and not stripped:
        fail(where, f"{field} is empty")
    if len(stripped) > limit:
        fail(where, f"{field} is {len(stripped)} characters, the limit is {limit}")
    if any(ch != "\n" and ord(ch) < 32 for ch in stripped):
        fail(where, f"{field} contains control characters")
    if LINKISH.search(stripped):
        fail(where, f"{field} looks like it contains a link, which packs may not carry")


def load(path: pathlib.Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        fail(path.name, f"is not valid JSON — {e}")
    except OSError as e:
        fail(path.name, f"could not be read — {e}")
    return None


def check_pack(path: pathlib.Path, row: dict) -> None:
    where = path.name
    size = path.stat().st_size
    if size > MAX_PACK_BYTES:
        fail(where, f"is {size // 1024}KB, the limit is {MAX_PACK_BYTES // 1024}KB")

    pack = load(path)
    if pack is None:
        return
    if not isinstance(pack, dict):
        fail(where, "must be a JSON object")
        return

    if pack.get("schemaVersion") != SCHEMA_VERSION:
        fail(where, f"schemaVersion must be {SCHEMA_VERSION}")

    pack_id = pack.get("id")
    if pack_id != row["id"]:
        fail(where, f"id is {pack_id!r} but index.json says {row['id']!r}")
    if path.stem != row["id"]:
        fail(where, f"filename should be {row['id']}.json")

    check_text(where, "name", pack.get("name"), MAX_NAME)
    check_text(where, "author", pack.get("author"), MAX_NAME)
    check_text(where, "description", pack.get("description", ""), MAX_DESCRIPTION, required=False)

    if pack.get("version") != row["version"]:
        fail(where, f"version {pack.get('version')} does not match index.json ({row['version']})")
    if not isinstance(pack.get("version"), int) or pack.get("version", 0) < 1:
        fail(where, "version must be a whole number of 1 or more")

    rules = pack.get("rules")
    if not isinstance(rules, list) or not rules:
        fail(where, "needs at least one rule")
        return
    if len(rules) > MAX_RULES:
        fail(where, f"has {len(rules)} rules, the limit is {MAX_RULES}")

    seen = set()
    for i, rule in enumerate(rules):
        at = f"{where} rule {i + 1}"
        if not isinstance(rule, dict):
            fail(at, "must be an object with word and say")
            continue
        check_text(at, "word", rule.get("word"), MAX_RULE_CHARS)
        check_text(at, "say", rule.get("say"), MAX_RULE_CHARS)
        word = str(rule.get("word", "")).strip().lower()
        if word in seen:
            fail(at, f"{rule.get('word')!r} appears twice — only the first would be used")
        seen.add(word)

    if row["wordCount"] != len(rules):
        fail(where, f"has {len(rules)} rules but index.json says wordCount {row['wordCount']}")


def main() -> int:
    index = load(ROOT / "index.json")
    if index is None:
        print_report()
        return 1
    if index.get("schemaVersion") != SCHEMA_VERSION:
        fail("index.json", f"schemaVersion must be {SCHEMA_VERSION}")

    packs = index.get("packs")
    if not isinstance(packs, list):
        fail("index.json", "packs must be a list")
        print_report()
        return 1

    listed_paths = set()
    seen_ids = set()
    for i, row in enumerate(packs):
        where = f"index.json entry {i + 1}"
        if not isinstance(row, dict):
            fail(where, "must be an object")
            continue

        pack_id = row.get("id", "")
        if not isinstance(pack_id, str) or not ID_PATTERN.match(pack_id):
            fail(where, f"id {pack_id!r} must be lowercase letters, digits and hyphens")
            continue
        if pack_id in seen_ids:
            fail(where, f"id {pack_id!r} is already used by another pack")
        seen_ids.add(pack_id)

        check_text(where, "name", row.get("name"), MAX_NAME)
        check_text(where, "author", row.get("author"), MAX_NAME)
        check_text(where, "description", row.get("description", ""), MAX_DESCRIPTION, required=False)

        for field in ("wordCount", "version"):
            if not isinstance(row.get(field), int):
                fail(where, f"{field} must be a whole number")

        path = row.get("path", f"packs/{pack_id}.json")
        if not isinstance(path, str) or not path.startswith("packs/") \
                or ".." in path or not path.endswith(".json"):
            fail(where, f"path {path!r} must be packs/<id>.json")
            continue

        listed_paths.add(path)
        pack_file = ROOT / path
        if not pack_file.is_file():
            fail(where, f"{path} does not exist")
            continue
        if isinstance(row.get("version"), int) and isinstance(row.get("wordCount"), int):
            check_pack(pack_file, row)

    for orphan in sorted(PACKS_DIR.glob("*.json")):
        relative = f"packs/{orphan.name}"
        if relative not in listed_paths:
            fail(relative, "is not listed in index.json, so the app will never see it")

    print_report()
    return 1 if problems else 0


def print_report() -> None:
    # ASCII only: a Windows console defaults to cp1252 and a tick mark takes the
    # script down with a UnicodeEncodeError before it can report anything.
    if problems:
        print(f"{len(problems)} problem(s):\n")
        for problem in problems:
            print(f"  FAIL  {problem}")
        print("\nSee CONTRIBUTING.md for the format.")
    else:
        print("OK - workshop is valid")


if __name__ == "__main__":
    sys.exit(main())
