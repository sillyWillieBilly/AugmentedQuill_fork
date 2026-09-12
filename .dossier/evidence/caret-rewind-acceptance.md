# Workshop caret and rewind acceptance — 12 September 2026

Application revision: `9f232e8f4167f6e5a0d6b702b0f2dc3f5ff60dbd`.
The tested frontend is `index-DCEkP2lS.js`, 796.23 KiB gzip, within the 800 KiB
budget. Private browser snapshots, model requests/responses and file checks are
under ignored `.local-data/evidence/caret-rewind/`.

## Behavior and review

Every message captures the current editor buffer, document identity, directional
selection and configured line separator before asynchronous work. The backend
derives logical line numbers and UTF-16 columns from that snapshot, with bounded
line/selection excerpts and a buffer SHA-256. Its inspectable context explicitly
distinguishes the current document/buffer from the pinned proposal target.
Old clients may omit this additive field; missing context is reported honestly.
Existing history remains readable without fabricated retroactive caret receipts.

The writer instructions answer the latest author message directly. Cursor facts
do not request replacement prose. The exact latest message is reserved before
optional context, including when prior history is disabled; an oversized request
fails explicitly instead of losing its question behind a long story summary.

Rewind branches immediately before any user message, restores that prompt as an
editable persisted draft, and retains the complete original conversation in the
history selector. It cancels pending generation and ignores obsolete responses.
It never invokes a manuscript undo or save. Shared proposal decisions stay
consistent between retained branches; application still checks the immutable
document and original buffer. Failed-send drafts survive switching and reopening.

Independent review reproduced two issues during implementation: omission of the
latest question under context pressure and loss of the persisted draft after a
failed send. Both were repaired and covered by regressions. Final review found no
remaining consequential blocker in this scope.

## Automated checks

- Backend: **1,004 passed**, plus **20 subtests**; two dependency deprecation
  warnings. Focused Workshop service/API checks: **52 passed**.
- Frontend: **110 files, 1,496 tests passed**. Final panel/storage regressions:
  **29 passed**; independent panel review: **14 passed**.
- Ruff, Black, TypeScript, generated API types, Prettier and production build
  passed. ESLint has **0 errors**, with **63 nonfatal style warnings**.
- Browser cursor/scene-marker fixture: **9 passed**.
- Fullstack browser regressions: **49 passed** in 6.8 minutes, with no retries.
  The existing native scene/annotation scenarios logged save-revision conflicts;
  their scenario assertions passed. This is separate from the error-free final
  linked-book reload. The documentation tutorial suite was not repeated for this
  patch; its earlier result remains in the linked-Markdown baseline record.

The generated-type command initially reported the intended uncommitted schema
delta; it passed after committing the regenerated schema and TypeScript file.
Two context-allocation fixtures now use 1,024 estimated input tokens because the
expanded complete instructions no longer fit their former 512-token allowance.
The explicit too-small-budget and no-truncation invariants remain tested.

## Headed Brave and actual writer

Playwright controlled a separate headed Brave context on an isolated runtime at
port 28001. Its two-chapter disposable manuscript included BOM, CRLF, combining
Unicode and an astral character. It used the author's configured ModelWarden
`writer`, with no response mocking for these three requests:

1. Pin a sentence on line 3, move the caret to line 5 column 11, and ask the exact
   reported cursor question. HTTP 200: the writer reported line 5 column 11 and
   the correct line text, with zero replacement alternatives.
2. Move the caret to line 7 column 1 and ask a follow-up. HTTP 200: the writer
   reported the new position and line text; the proposal target ID stayed fixed.
3. Rewind the first message, revise the prompt, reload, and select text backwards
   on line 5. The draft survived reload. Resending included only the revised user
   message in active history. HTTP 200: the writer reported line 5 column 11 and
   quoted exactly the selected text, with zero replacement alternatives.

The original four-turn conversation remained selectable; the new branch held
only its replacement two-turn exchange. No proposal was applied. Complete
provider-bound messages and line metadata are available in Context used.

## Live update and preservation

The author's existing book tabs were inspected for pending saves and backed up
locally before refresh. The verified old app process was replaced with PID
**2176153** at port 28000. Both Brave tabs loaded the final bundle. The active
conversation and exact editor buffer were preserved, and the caret returned to
logical line **13**, offset **1732**. The new Rewind control was visible. No page
errors or failed API requests occurred during the active-tab reload.
The isolated acceptance window and port 28001 backend were closed after testing;
the author's book remains open on the port 28000 app.

SHA-256, size, permission mode and membership checks confirmed **all 149 book
files unchanged** during this fix. Existing author edits remain intact. Runtime
model settings, user conversations, lore and manuscript contents are excluded
from this public evidence. Old assistant replies remain historical; resend or
rewind a question to receive an answer using the new context.
