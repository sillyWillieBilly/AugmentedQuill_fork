# Copy-based manuscript import

The V1 import path creates a new, isolated AugmentedQuill **novel** from an
explicit ordered list of UTF-8 Markdown or text files. It does not scan a book
directory, infer chapters, read planning notes, or write to the source tree.

Run it from the AugmentedQuill checkout with the project virtual environment:

```bash
venv/bin/python tools/import_manuscript.py \
  --source /path/to/a/book-copy \
  --destination /path/to/runtime/projects/book-1-import \
  --title "Book 1 import" \
  --file manuscript/chapter-01.md \
  --file manuscript/chapter-02.md
```

Each `--file` is relative to `--source` unless it is absolute. The order of
the flags is the chapter order. Every selected file must be a regular `.md` or
`.txt` UTF-8 file inside the source tree. The importer stores the content as
`chapters/0001.txt`, `chapters/0002.txt`, and so on because the existing novel
chapter scanner uses four-digit text filenames. The extension change does not
change the bytes: Markdown remains Markdown content, including Unicode,
CRLF line endings, scene markers, and annotation markers.

The destination directory must be new and outside the source tree. Existing
destinations, broken destination symlinks, source-file symlink escapes, source
files with unsupported extensions, duplicate selections, and invalid UTF-8 are
refused before publication. Files are hashed during preflight and again while
copying. A source change during the copy aborts the staged import. A failed or
interrupted copy leaves no published project.

The published project contains `.aq_import/manuscript-import.json`. The
manifest records the canonical source root, source-relative path, target path,
ordered chapter number, byte length, and SHA-256 hash for every copied file.
It is an audit record; it is not used to rewrite the source manuscript.

To make the new project the current project in an existing registry, pass the
registry path explicitly after checking that it is outside both source and
destination trees:

```bash
venv/bin/python tools/import_manuscript.py \
  --source /path/to/a/book-copy \
  --destination /path/to/runtime/projects/book-1-import \
  --registry /path/to/runtime/config/projects.json \
  --file manuscript/chapter-01.md \
  --file manuscript/chapter-02.md
```

The registry is updated only after the complete project is published with an
atomic replacement. If that update fails, the newly published project is
removed and the prior registry remains the active record. Omitting
`--registry` leaves the project discoverable under the destination's projects
root and makes it selectable through the existing project list without
changing a registry.

The importer accepts only manuscript files supplied by the caller. Keep
planning, analysis, private notes, exports, and alternate drafts out of the
`--file` list unless they are intentionally selected as manuscript chapters.
