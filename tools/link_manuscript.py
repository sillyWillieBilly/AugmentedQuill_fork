#!/usr/bin/env python3
# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Create an app project that points at explicitly selected Markdown files.

The command records a capability manifest and never copies, renames, or edits
the selected source files.  It is intentionally explicit: no globbing is
provided because alternate drafts in an author's tree must not become active
chapters by filename accident.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from augmentedquill.core.config import load_story_config, save_story_config
from augmentedquill.services.projects.manuscript_link import (
    ManuscriptLinkError,
    create_link_manifest,
)
from augmentedquill.services.projects.project_lifecycle_ops import (
    initialize_project_dir_data,
)


def build_parser() -> argparse.ArgumentParser:
    """Build the link command parser."""
    parser = argparse.ArgumentParser(
        description="Link an app project to explicitly selected external Markdown files."
    )
    parser.add_argument(
        "--source", required=True, type=Path, help="External manuscript root."
    )
    parser.add_argument(
        "--destination",
        required=True,
        type=Path,
        help="App project directory; created if absent and never used as source.",
    )
    parser.add_argument(
        "--file",
        action="append",
        dest="source_files",
        required=True,
        help="Explicit source-relative .md/.txt file; repeat to set chapter order.",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Explicit source-relative file retained as reference provenance.",
    )
    parser.add_argument("--title", default=None, help="App project title.")
    parser.add_argument(
        "--language", default="en", help="Story language (default: en)."
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Create the linked project and print its manifest path."""
    args = build_parser().parse_args(argv)
    source = args.source.expanduser().resolve()
    destination = args.destination.expanduser().resolve()
    if destination == source or destination.is_relative_to(source):
        print(
            "Link refused: destination must not be inside the source root.",
            file=sys.stderr,
        )
        return 2
    if destination.exists() and not (destination / "story.json").is_file():
        print("Link refused: destination exists without story.json.", file=sys.stderr)
        return 2
    created = not destination.exists()
    try:
        if created:
            initialize_project_dir_data(
                destination,
                args.title or destination.name,
                "novel",
                datetime.now(UTC).isoformat(),
                args.language,
            )
        elif any((destination / "chapters").glob("*")):
            raise ManuscriptLinkError(
                "Destination already contains local chapter files; create a fresh app project first."
            )

        excluded = [
            {"source": value, "status": "reference", "role": "reference"}
            for value in args.exclude
        ]
        manifest = create_link_manifest(
            destination,
            source_root=source,
            files=args.source_files,
            excluded=excluded,
        )
        story_path = destination / "story.json"
        story = load_story_config(story_path) or {}
        story["project_title"] = (
            args.title or story.get("project_title") or destination.name
        )
        story["project_type"] = "novel"
        # Chapter metadata remains app-local.  The manifest alone owns source
        # identity and paths, so renaming metadata cannot alter the originals.
        story["chapters"] = [
            {"title": entry.get("title") or Path(entry["source"]).stem}
            for entry in manifest["entries"]
        ]
        save_story_config(story_path, story)
    except (ManuscriptLinkError, OSError, ValueError) as exc:
        if created:
            shutil.rmtree(destination, ignore_errors=True)
        print(f"Link refused: {exc}", file=sys.stderr)
        return 2

    print(f"Linked project: {destination}")
    print(f"Manifest: {destination / '.aq_import' / 'manuscript-link.json'}")
    print(f"Active source files: {len(manifest['entries'])}")
    print(f"Reference files: {len(manifest['excluded'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
