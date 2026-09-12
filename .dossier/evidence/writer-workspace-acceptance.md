# Writing workspace acceptance — 12 September 2026

## Revisions and runtime

The verified upstream starting revision is
`e9e272f7446afdd0dd31652d5aec32714929c73a`. The final application implementation is
`717fd14a6a3418600d56bf6506d8e12585aee288`, on `codex/writer-workspace` in
https://github.com/sillyWillieBilly/AugmentedQuill_fork.

The final static app ran at `http://127.0.0.1:28000` with backend PID1793479,
Python3.12.13 and Node24.15.0. It was freshly launched using
`bash tools/writer-dev.sh run` after `npm --prefix src/frontend run build`.
The equivalent repeatable user command is `make run`. The main asset is
`index-BUpaaBJ8.js`; artifact hashes and sizes are in `writer-runtime.json`.
The following handoff commit contains documentation/evidence and launch helper
improvements; it does not alter the tested application source.

The author supplied ModelWarden at `http://127.0.0.1:3758/v1`, model `writer`.
The actual route returned `deepseek-v4-flash`. This proves real inference through
the local proxy; the backend model's physical location is not established.
The earlier llama-swap writer failed a 16773.79 MiB CUDA allocation. No inference
service or SillyTavern installation was restarted or reconfigured.

## Goal acceptance

1. **Fresh launch and caret workflow.** In a dedicated headed Chromium/PinchTab
   instance, the synthetic Harbour Workshop Sample opened, a caret inside
   `She waited.` survived moving focus to Workshop, and the exact sentence was
   visibly attached before discussion. The final repeated-sentence request used
   visible UTF-16 range `[28,39)` after emoji, combining text and CJK prose.
2. **Precise ranges and modes.** Explicit selection and caret-only targets were
   exercised in the headed app. Raw→Markdown→Visual mode changes retained the
   target before applying. The last of two identical sentences was replaced while
   the first, emoji, combining accent, CJK wording, scene markers and annotation
   markers stayed exact. Unit/integration tests additionally cover reversed
   selections, grapheme boundaries, ambiguous sentence fallback, CRLF and both
   mixed-line-ending orders, including later-paragraph offsets.
3. **Discussion, apply and local history.** Actual model discussion left prose and
   story metadata unchanged. The final model proposal `She remained still.` changed
   only the final `She waited.`. Ctrl+Z saved the exact original bytes to disk;
   Ctrl+Shift+Z saved the exact applied bytes. Reload and API readback retained the
   applied content and matching revision. `writer-marker-verification.json` records
   the hashes. Regeneration shares the same tested read-only service; that service
   supplies no mutation tools and rejects tool-call responses.
4. **Conflicts.** Typing while actual generation was running and changing chapters
   preserved proposals and produced explicit changed-content/wrong-document
   conflicts. An external edit to the synthetic chapter produced HTTP409, retained
   the external file and local wording, and required explicit download/reload.
   Concurrent save, stale response, missing revision and document-switch cases are
   covered by automated tests.
5. **Lore.** The context inspector included relevant Mara lore and excluded an
   out-of-scope knowledge entry and unaccepted proposal with reasons. Creating a
   native entry through the UI retained Proposal status. The final inspector showed
   the configured 1,000,000-token model context separately from the 32,768-token
   Workshop allocation and labelled all token counts as estimates.
6. **World Info.** Fixture tests cover the documented activation subset, exclusions,
   priorities, recursion, budget and scope. Import/export of the compatibility
   fixture through the API was semantically identical, including unknown fields.
   The headed Lore UI displayed the retained unsupported probability setting.
   File-picker preview/confirmation behavior is covered by UI tests; it was not
   claimed as a headed file-upload test. See `docs/LORE-COMPATIBILITY.md`.
7. **Persistence, recovery and copies.** Saved recovery preview/restore and explicit
   local draft recovery were exercised in the headed app. Checks cover atomic
   guarded saves, recovery history, failure preservation and additive legacy lore
   compatibility without a schema-version change. Chapters01/02 were copied to a
   separate project and reopened; original hashes remained unchanged. See
   `manuscript-copy-trial.json`. No real manuscript wording was sent to the model.
8. **Actual model and errors.** Complete headed model→proposal→apply→disk undo→disk
   redo→reload passed on the final build. Actual cancellation kept prose unchanged.
   A slow earlier request exposed retry-multiplied timeouts; the service now bounds
   the entire provider operation and tests cancellation, deadline, configuration,
   HTTP-status and connection errors. Timeout/error categories were automated
   service tests; the final headed run was a successful real provider request.
9. **Checks and handoff.** Required checks and targeted final regressions passed as
   listed below. The fork, commits, launch helpers, writer guide, compatibility
   contract, importer guide and exact runtime identity are recorded in this tree.

## Automated checks and their scope

Commands were run from the repository root unless otherwise stated.

- `venv/bin/python -m pytest -q`: **958 passed**, **20 subtests passed**;
  two existing FastAPI/Starlette deprecation warnings. The final backend source is
  in `7f23f12`; later application changes were frontend-only.
- `npm --prefix src/frontend test`: **107 files and 1457 tests passed** on the
  final application source. Three existing jsdom canvas warnings are non-failing.
- `venv/bin/ruff check .` and `venv/bin/black --check .`: passed.
- Frontend ESLint, TypeScript and generated API type consistency: passed. ESLint
  has **0 errors and 59 warnings** (including complexity warnings in new large
  components). Final shortcut files also passed focused lint/format checks.
- Repository Prettier glob and `git diff --check`: passed.
- Production build and unchanged bundle budget: passed, **792.53 KiB main gzip**
  against **800 KiB**. Vite reports an upstream future config-loader warning.
- Python dependency audit: no known vulnerabilities under the CI exclusions
  `CVE-2026-4539` and `CVE-2026-3219`; unpublished local augmentedquill was skipped.
  Frontend dependencies were not changed.
- From `src/frontend`, `npx playwright test --config=playwright.config.ts`:
  **9 passed** at `f939aab`.
- `npm run test:e2e:docs`: **112 passed**, no skips, before the final CRLF/shortcut
  fixes. Legacy chat scenarios explicitly select the Project chat tab now that
  Workshop is the default.
- `npx playwright test --config=playwright.fullstack.config.ts`: **49 passed** at
  `f939aab`, before the final global shortcut fix.
- After `717fd14`, the same fullstack command restricted to
  `scene-linked-prose-undo.spec.ts` and `scene-link-regressions.spec.ts`:
  **6 passed**, no failures/skips. Disposable ports5199/18000/18001 were free after
  test teardown. These suites are isolated/mock checks; they are separate from
  the actual ModelWarden headed evidence above.

## Material defects resolved during acceptance

- Exact source line endings were normalized by CodeMirror's `Text.toString()`;
  source-aware `sliceDoc()` and range translation now preserve them.
- A dynamic editor key could lose history on first-newline/save acknowledgement;
  separator and editor identity now remain stable for a logical document.
- Global story undo also handled CodeMirror's Ctrl+Z and could leave disk unchanged
  while the UI looked undone. The global hook now respects handled events and
  editable targets. The final headed checks explicitly compared disk bytes after
  both undo and redo, not just the visible editor.
- Model context size aliases, settings normalization, alternative IDs, mandatory
  context budgets and overall request deadlines were made explicit and tested.

An early marker trial used an invalid synthetic scene ID and was rejected by the
save API. It was corrected to the upstream numeric scene-ID grammar before the
successful canonical marker tests above. That failed fixture is not counted as
successful marker acceptance.

## Remaining V1 boundaries

SillyTavern compatibility is the documented deterministic subset; probability,
timing, macros, placement and other advanced settings remain preserved and
visibly unsupported. Scope and canon are explicit author metadata, not automatic
truth inference. Token counts are estimates. Workshop history is browser-local.
The app retains upstream's single-user architecture and broader Project chat
workflow; its legacy tools do not all share the new editor save path. Revisions
cannot lock arbitrary external editors out of the final compare/replace interval.
These limits are described in the writer and compatibility guides.

Detailed browser screenshots and provider request evidence remain under ignored
`.local-data/acceptance/`, alongside synthetic fixtures and private copied books.
Only non-secret hashes, synthetic verification results and this concise evidence
record are committed.
