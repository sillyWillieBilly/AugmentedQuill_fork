#!/usr/bin/env python3
# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Import explicitly selected Markdown/text files into a fresh AQ novel.

Example:

    python tools/import_manuscript.py \
      --source /path/to/book-copy \
      --destination /path/to/projects/book-1-import \
      --file manuscript/chapter-01.md \
      --file manuscript/chapter-02.md
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from augmentedquill.services.projects.manuscript_import import (
    ManuscriptImportError,
    import_manuscript,
)


def build_parser() -> argparse.ArgumentParser:
    """Build the import command parser."""
    parser = argparse.ArgumentParser(
        description=(
            "Copy explicitly selected UTF-8 .md/.txt files into a fresh "
            "AugmentedQuill novel project."
        )
    )
    parser.add_argument(
        "--source",
        required=True,
        type=Path,
        help="Protected source directory; selected --file paths are relative to it.",
    )
    parser.add_argument(
        "--destination",
        required=True,
        type=Path,
        help="New project directory; it must not already exist or be inside --source.",
    )
    parser.add_argument(
        "--file",
        action="append",
        dest="source_files",
        required=True,
        help="One explicit source .md/.txt file; repeat to control chapter order.",
    )
    parser.add_argument(
        "--title",
        default=None,
        help="Project title (defaults to the destination directory name).",
    )
    parser.add_argument(
        "--language",
        default="en",
        help="Story language code stored in the new project (default: en).",
    )
    parser.add_argument(
        "--registry",
        type=Path,
        default=None,
        help="Optional projects.json path to update after the complete project is published.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run the copy-based import and print its audit paths."""
    args = build_parser().parse_args(argv)
    try:
        result = import_manuscript(
            args.source,
            args.destination,
            args.source_files,
            project_title=args.title,
            language=args.language,
            registry_path=args.registry,
        )
    except ManuscriptImportError as exc:
        print(f"Import refused: {exc}", file=sys.stderr)
        return 2
    print(f"Imported project: {result.project_path}")
    print(f"Manifest: {result.manifest_path}")
    print(f"Chapters copied: {len(result.files)}")
    if result.registered:
        print(f"Registry updated: {args.registry}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
