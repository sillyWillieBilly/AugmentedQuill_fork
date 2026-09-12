# Chapter scrolling and linked outline acceptance — 12 September 2026

Application revision: `ad7742db3bc2b3a33402d52b5e0a75020d9f67f5`. The production frontend is
`index-CeXZCAS2.js`, **797.13 KiB gzip**, within the existing 800 KiB budget.
The outline is loaded separately as `LinkedSceneOutline-DIb2945x.js`.
Private screenshots, browser state and file hashes are under the ignored
`.local-data/evidence/navigation/` directory.

## Behavior and review

The sidebar previously gave every section `shrink-0`. Restored section heights
could extend below the viewport, and the clipped chapter list never acquired an
effective internal scroll area. Expanded sections now shrink within the available
sidebar height, preserving measured header/resize-handle minimums and the author's
saved preferred heights. The chapter list has a constrained scroll area, contained
wheel scrolling and a stable scrollbar gutter. Narrow fixed sidebars account for
the application header.

For linked Markdown, the chapter-list **Show scenes view** button opens an outline
beside the current editor. The top **Scenes**, **Split** and **Page** buttons now
control this read-only navigation. Native scene planning retains its existing
storage-specific branch. The linked editor stays mounted through all three modes,
preserving unsaved text and undo. Full Scenes makes the covered editor inert and
removes it from the accessibility tree; a jump returns to Page and restores focus
only to the still-current editor instance.

Entries come from the live buffer, using exact project/document identity and
marker-stripped UTF-16 positions with the configured line separator. A click
rechecks source and identity before moving the caret. Changed text refreshes the
outline and requires choosing again. Initial reads retry briefly if a restored
outline mounts before the editor handle, with bounded attempts and cleanup.
No save, model, scene-editing or lore API is called by the outline.

The parser indexes existing ATX headings, thematic dividers and scene start
markers. It skips fenced examples, the initial chapter H1 and a closing divider
followed only by an export page-break element. Ordinary blank paragraphs do not
invent scenes. Chapters without internal divisions expose one opening entry and
an explanation. The toolbar wraps inside a constrained Split editor instead of
overlapping the outline.

Independent review identified the initial hidden-editor keyboard-focus issue;
the inert/focus fix and subsequent readiness/toolbar changes passed review.
No consequential blocker remained. Review and tests used disposable projects.

## Automated checks

- Backend: **1,004 passed**, with two existing dependency deprecation warnings.
  Backend code and API schemas are unchanged by this patch.
- Frontend: **112 files, 1,518 tests passed**. Final focused parser/panel/header
  checks: **23 passed**. New readiness tests cover delayed handles and cleanup.
- Ruff, Black, TypeScript, generated API types, Prettier, Git whitespace checks
  and production build passed. ESLint: **0 errors, 62 warnings**.
- Cursor/scene-marker browser fixture: **9 passed**.
- Fullstack browser suite: **49 passed**, without failed assertions. The native
  scene/annotation tests continue to log save-revision conflicts already seen in
  the preceding acceptance run. This run began before the final linked-only
  export-footer filter; its native application paths did not change afterward.
- Sidebar regressions: **2 passed** after both failed against the original CSS.
  They use actual wheel events with 17 disposable chapters, normal and oversized
  restored preferences, chapter focus, collapse/expand, and 1440×900, 1440×550
  and 860×550 viewports. Saved preferred heights remain unchanged.
- Linked outline browser regressions: **3 passed with retries disabled**, covering
  exact jumps, stale-source refusal, same editor/undo, inert full Scenes, initial
  Split reload, chapter switching, constrained toolbar layout, source-byte
  preservation and absence of native scene/content mutation requests.
- Full documentation browser suite: **117 total**, with **116 passing directly**
  and **one passing on its configured retry**, in 11.1 minutes. The first attempt
  of `06-tutorial-first-story.spec.ts:48` timed out waiting for the mock-chat-created
  character name; its retry passed. All five new navigation scenarios passed on
  their first attempt. Application and test source remained frozen during this run.

The browser fixture's Vite warnings and Vitest's optional canvas notices are
nonfatal. A missing type annotation in the new parser test was corrected; the
final lint run passed. Initial new browser test failures were fixture timing,
request-matcher and cleanup errors and were repaired before the passing run.

## Headed Brave acceptance

A separate headed Brave window used a disposable linked project at port 28001
with 17 synthetic files. Chapter 5 included BOM, CRLF, combining/astral Unicode,
headings, an interior divider and existing internal markers. Actual wheel events
changed the chapter list's scroll position, after which Chapter 5 opened normally.
The list measured 538 pixels high against 1,402 pixels of content.

The enabled sidebar button opened Split with five source-grounded entries.
Divider and heading clicks reached logical lines 95 and 102. Page/Scenes/Split
kept the same EditorView and exact source text. Tab could not enter the inert
covered editor; a full-Scenes jump returned to a focused Page editor. Reloading
with Split saved populated the outline automatically. The toolbar no longer
overlapped the outline with both side panels open.

A deliberate synthetic edit, with saves intercepted, remained in the same editor
through mode changes. Ctrl+Z restored the complete pre-edit BOM/CRLF buffer.
All 17 synthetic source hashes remained unchanged after closing the test runtime.
Navigation-only requests contained no native scene or manuscript mutation calls;
view-state persistence is expected. The intentional failed-save exercise is not
described as an error-free network session. No writing-model request was needed
for this navigation-only change; earlier actual-model caret/rewind evidence stays
in its own acceptance record.

## Live update and preservation

The author's two saved book tabs were backed up and checked before refresh.
Both now load `index-CeXZCAS2.js` from the existing backend PID **2176153** at
http://127.0.0.1:28000. The backend process was not replaced for this frontend fix.
Each tab's exact buffer and directional selection survived refresh, and every
saved Workshop storage value matched the pre-change snapshot.

The primary tab was deliberately navigated from Chapter 1 to the numbered
Chapter 5 original using the repaired list. It is left in Split with its outline
visible. This Chapter 5 has no internal scene divisions, so it has one opening
entry; its final export-only page break is excluded. The other tab remains on
Chapter 1. The existing Workshop stays selected; no conversation or proposal was
edited or applied.

SHA-256, size, permission mode and membership checks confirm **all 149 original
book files unchanged**. Pre-existing author edits remain untouched. The isolated
Brave window and port 28001 backend were closed; both author tabs remain open.
Runtime model settings, manuscript text, lore and conversations are excluded from
this public record and from the commit.
