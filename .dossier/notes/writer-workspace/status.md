# Writer workspace status

## Current linked Markdown workspace — 12 September 2026

Application code is frozen at `0a746d4`. The author can edit explicitly linked
original Markdown files. The app remains at http://127.0.0.1:28000 with the
author-supplied ModelWarden `writer` selected. The final backend PID is 2058778;
the final main bundle is `index-DHViiFp5.js`, 794.52 KiB gzip.

- Explicit source membership, original-path/status display, revision and identity
  checks, atomic writes, preserved permission bits and app-local recovery.
- Canonical external-file locks serialize concurrent writes from two app projects.
  Linked reads skip migrations; legacy structural, scene, annotation and snapshot
  services fail closed even when a declared link manifest is missing.
- Linked UI uses Workshop and Lore. It skips unsupported automatic fetches and
  discards stale native-project responses. Native projects keep their workflows.
- Workshop honors configured reply space up to 4,096 tokens unless an API caller
  explicitly overrides it. This repaired an observed empty model follow-up.
- Local setup: 17 linked files, 10 reference exclusions and 11 sourced lore
  entries. Runtime manuscript/lore/model data stays outside Git. All 149 original
  book files retain their hashes, sizes and modes; existing author changes remain.
- Final headed Brave: zero failed requests/alerts on book load; disposable save
  and Ctrl+Z both returned 200 and restored exact bytes and mode 0640. Actual
  writer alternatives and a follow-up were inspected and remain unapplied.
- Backend: 987 tests plus 20 subtests. Final affected checks: 43 tests. Frontend:
  108 files and 1,465 tests. Browser fixture: 9; fullstack: 49. Docs: 111 passed,
  one passed on retry; a fresh five-case tutorial/suggestions run passed.
- Ruff, Black, TypeScript, generated API types, Prettier and build passed.
  ESLint has zero errors and 61 warnings.

See [current evidence](../../evidence/linked-markdown-acceptance.md) and
[runtime identity](../../evidence/linked-markdown-runtime.json) for precise scope,
including checks that started before the final small changes. The taskbar
launcher still reuses/starts the app and opens Brave. Lore is a sourced snapshot,
not a live planning-file sync. Workshop history belongs to its browser profile
and origin. An uncooperative external editor retains the documented race between
the final revision comparison and atomic replacement.

## Initial build record (historical)

The first complete writing workspace is implemented and validated. Scope and
acceptance criteria: `augmentedquill-writer-goal.md`. The final application code is
commit `717fd14a6a3418600d56bf6506d8e12585aee288`; the following handoff commit adds
launch documentation and evidence without changing the application build.

- Fork: https://github.com/sillyWillieBilly/AugmentedQuill_fork
- Branch: `codex/writer-workspace`
- Verified upstream base: `e9e272f7446afdd0dd31652d5aec32714929c73a`
- Setup: `010aecd`; backend: `7f23f12`; editor/lore UI: `f939aab`;
  local undo routing: `717fd14`.
- Running locally at http://127.0.0.1:28000, with ModelWarden `writer` configured
  through the author-supplied `http://127.0.0.1:3758/v1` route. Its response model
  was `deepseek-v4-flash`; this establishes actual inference through a local proxy,
  not GPU-local inference.

## Delivered

- Fresh immutable passage snapshots, checked exact application, alternatives,
  comparison/adjust/reject, discussion history, cancellation and conflict handling.
- Native lore status/scope, bounded deterministic selection and a context inspector.
  World Info semantic roundtrips preserve unsupported fields and expose warnings.
- Revision-checked serialized saves, retained browser drafts, explicit failures,
  external-change handling, durable checkpoints and undoable recovery.
- UTF-16/marker mapping, Unicode and CRLF/mixed-line-ending preservation. Normal
  save acknowledgements retain the editor instance and its undo history. Global
  story shortcuts no longer double-handle CodeMirror or native input undo/redo.
- Copy-based Markdown import with source hashes and original-byte preservation.
  The two-chapter trial reopened successfully; the original source hashes were
  rechecked unchanged. Real manuscript prose was not sent to models or committed.
- Isolated setup/run/development/schema generation, concise contextual AGENTS.md,
  and user/developer/compatibility/import guides.

## Validation

- Backend: **958 passed**, plus **20 subtests**; two existing deprecation warnings.
- Frontend: **107 files, 1457 tests passed** on the final application source.
- Browser fixture: **9 passed**; documentation scenarios: **112 passed**;
  fullstack scenarios: **49 passed**. No failures or skipped cases.
- After the final shortcut fix, the affected fullstack undo/history scenarios:
  **6 passed** at `717fd14`.
- Ruff, Black, TypeScript, generated API types, Prettier and build passed.
  ESLint passed with zero errors and 59 style/complexity warnings. Final main
  bundle: **792.53 KiB gzip**, within the existing 800 KiB budget.
- Python dependency audit passed with the repository CI exclusions; the local
  package itself is not published on PyPI and was skipped by the audit.
- Headed actual-model acceptance covered precise apply, mode changes, repeated
  text, Unicode/markers, byte-verified undo/redo and reopen, conflicts, cancellation,
  lore inspection and recovery. Mock and actual-model evidence are kept distinct.

See [acceptance evidence](../../evidence/writer-workspace-acceptance.md) and
[runtime identity](../../evidence/writer-runtime.json) for exact test scope and
artifacts. The old fullstack run preceded the final shortcut change; the affected
browser tests, full frontend suite and real-model headed flow were repeated after
that change. Do not describe older checks as having run on the later revision.

## Handoff and limits

Use `make run` for the built app or `make dev` for live development. Runtime data,
provider settings, browser artifacts and copied books are ignored under
`.local-data/`. Existing SillyTavern and inference services were preserved.

Start with `docs/WRITER-WORKSPACE.md`. V1 deliberately has a documented SillyTavern
subset, explicit author-scoped lore, estimated token budgets, browser-local
Workshop history, and the upstream single-user project model. Imported advanced
probability/timing/macro/placement options are retained and visibly unsupported.
The precise manuscript save/recovery path has revision checks; legacy Project chat
retains broader tools and some upstream persistence paths. Details and follow-up
boundaries are in `docs/LORE-COMPATIBILITY.md` and the writer guide.
