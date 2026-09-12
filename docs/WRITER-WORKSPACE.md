# Using the writing workspace

Start with `make run` in this checkout, then open http://127.0.0.1:28000.
`make dev` is available for development at http://127.0.0.1:28001.
Both use the same ignored `.local-data/` directory. See
[development commands](DEVELOPMENT.md) for setup and validation.

## Find a chapter or scene

Open the left sidebar with **Menu**. Put the pointer over the chapter cards and
use the mouse wheel or a two-finger scroll; the chapter list has its own scrollbar.
Click a chapter card to open that file. The diagonal-arrows button beside
**Chapters** gives the list the full sidebar; click it again to restore the other
sections. Story, Chapters and Sourcebook fit the window even if a previous session
saved larger preferred panel heights.

For a linked Markdown book, **Show scenes view** beside the chapter-list heading
opens **Scenes and sections** alongside the manuscript. **Scenes** at the top
shows the outline across the workspace, **Split** shows both, and **Page** or
**Back to page** returns to the manuscript. Click an entry to place the caret at
its displayed line. Full Scenes returns to Page after a jump.

The outline reads the current editor text, including unsaved wording, and lists
existing Markdown headings, scene markers and dividers such as `***`. An initial
chapter heading and a final export-only page break do not create extra scenes.
A chapter without internal divisions has one **Chapter opening** entry and an
explanation. These controls navigate existing structure; adding or rearranging
scenes still requires an explicit manuscript edit. **Refresh outline** rereads
the live text. If the text changes before a click, the outline refreshes and asks
you to choose again so it cannot jump using an obsolete position.

The outline keeps the same editor buffer and Undo history through Page, Scenes
and Split. It does not save prose, create scenes or change lore.

## Work on a sentence

1. Open a chapter and leave the caret inside the sentence, or select an exact
   passage. Move to **Workshop** and write “I don't like this line; let's workshop
   it.” The first send captures and displays the target. **Use current passage**
   lets you inspect it first; **Use paragraph** gives an explicit broader target.
2. Review the reply and alternative comparisons. Continue the conversation to
   refine an alternative. Discussion, regeneration and cancellation do not write
   manuscript text or lore; the Workshop provider receives no editing tools.
3. Choose **Apply wording**, or adjust the proposed text before applying it.
   Application changes only the checked target and is one CodeMirror undo step.
   Use Ctrl+Z / Ctrl+Shift+Z in the manuscript to undo or redo it. Watch the save
   status above the page for the disk acknowledgement.
4. If you changed the chapter or its text meanwhile, the proposal stays available
   with a conflict explanation. Open the original chapter or attach the current
   wording as appropriate. There is no first-matching-text replacement fallback.

The Workshop keeps the target through follow-up messages and preserves local
conversation history per project in this browser. It reports browser storage
failure explicitly. Opening the app on a different port or in a different browser
uses a different browser history; project files remain on disk.

**Project chat** retains upstream's broader tool workflow for native projects.
Its notice explains that it can edit chapters and lore. AI-created or AI-edited Sourcebook assertion
records are marked as proposals; promote them explicitly in Lore when accepted.

## Lore and context

The **Lore** tab edits native Sourcebook knowledge. New entries default to
**Proposal**. Use **Canon** for accepted facts or **Belief or rumour** for a
character's knowledge claim. Scope controls include book/chapter, scene,
viewpoint, timeline identity and timeline position bounds. These are explicit
author metadata, not automatic truth or continuity judgments.

Set **Viewpoint and story time** on a Workshop when needed. The selector scans
the target and neighboring prose, applies status and scope rules, then keyword
activation and bounded recursion. Recursion feeding and exclusion are controlled
by **Do not feed this entry into recursion** and **Exclude this entry from
recursive passes**. The legacy per-entry `recursive` field is retained as data
but has no implemented semantics or editable switch.

**Context used** shows selected/excluded lore, reasons, matched keys, unsupported
World Info settings, budget estimates, and the exact messages sent to the model.
Token counts are estimates from UTF-8 size plus message framing, not provider
tokenizer measurements. The configured model context is shown separately from
the bounded Workshop input allocation. Full system instructions, exact target and
complete selected lore records must fit; the app can trim optional context or
history and reports this. It rejects an impossible mandatory context budget.
Workshop uses the selected model's configured reply limit, capped at 4,096
tokens, unless an API caller explicitly supplies a smaller or larger allowed
reserve. The fallback for models without a reply setting is 1,024 tokens. Both
the context inspector and the model request use the same output reserve.

Import World Info JSON in the Lore tab. Unsupported settings are shown before
confirmation and on the imported book. Export preserves JSON values, original
IDs and unknown fields; whitespace/key formatting can change. Read the exact
[SillyTavern compatibility contract](LORE-COMPATIBILITY.md). SillyTavern itself
does not need to run for this app's independent selector.

## Save and recovery

The editor retains raw local draft text before its save debounce. Every normal
save uses the document identity and revision originally loaded, serializes queued
saves, and creates before/after records under `.aq_history/content-recovery/`.
An external revision change or failed request keeps local wording and shows an
error. A missing revision never becomes an unconditional frontend write.

Use **Download current wording** to keep a Markdown copy. **Download local wording
and reload disk** explicitly replaces the editor view with the current disk file
after downloading the local wording. It does not write the disk file.

**Saved recovery history** previews exact before/after checkpoint wording.
**Restore checkpoint in editor** is explicit, undoable and uses normal guarded
saving. It refuses if newer typing or a revision change occurred while the
preview was open. A recovered browser draft from a different disk base is shown
with saving paused for review.

The revision protocol coordinates application writes and detects observed
external changes. It cannot lock arbitrary external editors out of the tiny
interval between the final disk comparison and atomic replacement. Legacy
upstream tools have their own history and persistence paths; the new manuscript
checks apply to editor content saves and recovery. Native Lore API operations
replace story metadata atomically under the project lock. Existing generic
Sourcebook normalization still applies to native metadata; raw World Info uses
separate sidecars for its lossless semantic round trip.

## Editing original Markdown files

Linked Markdown projects edit the explicitly selected original files in place.
The **Editing original Markdown** bar shows the full destination above the page;
typing and **Apply wording** use the same revision-checked save queue. The file
names, directories and Markdown bytes are preserved when the project is linked.
Application metadata and recovery snapshots live in the app's separate project
directory under `.local-data/projects/`.

To create a linked workspace, run the following from this checkout with your own
paths, repeating `--file` in the order you want the files to appear:

```sh
venv/bin/python tools/link_manuscript.py \
  --source '/absolute/path/to/book' \
  --destination '.local-data/projects/My Linked Book' \
  --title 'My Linked Book' \
  --file 'manuscript/chapter-01.md' \
  --file 'manuscript/chapter-02.md'
```

Open **Settings**, refresh the projects list, and open the new workspace. The
link command reads only explicitly named files and creates an app-local manifest.
It refuses an existing link or a destination containing chapter files. Missing
sources and symlinked paths fail visibly; they are never recreated as empty
chapters. An optional repeated `--exclude` records reference provenance without
making those files editable.

For a linked book, use **Workshop** to discuss and revise passages. The native
project restructuring commands and broader Project chat writing tools are
disabled. New drafts and alternatives can appear as separately labelled files;
their presence in the sidebar does not promote their events to accepted canon.
Manage file order and additions through the explicit link manifest when changing
the book's organization.

The current lore entries are project metadata with source references. Editing
them does not rewrite the original planning documents. Check each entry's
editorial status and source when a manuscript decision changes.

An accepted wording change goes straight to the displayed original file.
Existing BOMs, line endings and regular-file permission bits are preserved. A
stale disk revision or a different source identity pauses saving and keeps the
local wording available for review. Recovery records are stored in the app
project, bound to that same original file identity.

## Imported working copies

Use [the copy importer](MANUSCRIPT_IMPORT.md) with an explicit ordered list of
Markdown files. It verifies source hashes before and after copying into a fresh
project, preserves the original bytes, and records an import manifest. It never
moves or edits source manuscripts. AugmentedQuill's existing chapter storage
uses numbered `.txt` filenames containing the unchanged Markdown prose; the
manifest retains source names.

Lore metadata is additive under Sourcebook `_lore`. Existing records without
this metadata keep their legacy canon interpretation. No project schema version
was changed; backward compatibility is covered by native/legacy round-trip tests.

## Range contract for contributors

JavaScript and API offsets are zero-based UTF-16 code-unit offsets. `from`/`to`
refer to the marker-stripped editor document; `rawFrom`/`rawTo` refer to the
marker-inclusive Markdown source. Ranges are half-open. Snapshots include full
raw content, SHA-256 over its UTF-8 bytes, project/document/book identity and
scene context. Grapheme checks reject split emoji and combining sequences.

Offsets count the original visible line endings: CRLF occupies two UTF-16 units.
The editor translates these offsets to CodeMirror's logical line positions and
preserves existing CRLF and mixed line endings. New replacement line breaks use
the document's effective separator. Normal typing and save acknowledgements keep
the same editor instance and undo history, including when a chapter gains its
first newline or becomes a single line.

Raw, Markdown and visual modes share that same CodeMirror source and marker
mapping. Proposals cannot introduce internal markers. Application checks the
original whole document and transfers existing markers while verifying that
everything outside the target is unchanged. Canonical scene markers use numeric
IDs, and annotation IDs follow the upstream marker grammar.
