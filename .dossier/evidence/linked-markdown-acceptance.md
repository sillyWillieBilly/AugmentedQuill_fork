# Linked Markdown acceptance — 12 September 2026

Application revision: `0a746d4`. This implements the author's explicit instruction
to save directly into original Markdown files. This public record contains no
manuscript, lore payload, credentials or model conversation text. Private receipts
remain under ignored `.local-data/evidence/`.

## Storage and review

An app-local manifest explicitly lists source membership, order, identity,
editorial status and initial provenance hashes. The app project and original
manuscript root are disjoint. Excluded references grant no edit access. Schema
extensions are additive; native project regression tests remain compatible.

Independent review identified and resolved migration-on-read writes, legacy
service bypasses and concurrent saves through two app projects. Linked reads
skip migration writers. Structural, scene, annotation and snapshot services reject
linked intent, including a declared project whose manifest is missing or invalid.
Canonical external-path locks serialize the complete save/recovery sequence
across metadata projects; the existing async project lock remains outermost.
No lock sidecars are created in the original book.

New Workshop, Lore, recovery, view-state and link APIs are project-scoped. The
guard recognizes older-looking paths defensively; allowing a request through
the policy does not create an unscoped route where none is registered.

## Automated checks

- Full backend: **987 passed, 20 subtests**, two dependency deprecation warnings.
- Final affected guard, API, legacy boundary and Workshop tests: **43 passed**.
- Final frontend: **108 files, 1,465 tests passed**.
- Ruff, Black, TypeScript, generated types and Prettier passed.
- ESLint: **0 errors, 61 warnings**.
- Main bundle `index-DHViiFp5.js`: **794.52 KiB gzip**, below the 800 KiB budget.
- Browser fixture: **9 passed**; fullstack: **49 passed**.
- Documentation suite: **111 passed, 1 flaky**. The sourcebook-character chat
  tutorial passed on its configured retry. A fresh run of that three-case tutorial
  and two native suggestion cases: **5 passed**, without retries.

The full browser suites began before the final prompt-read allowance and linked
suggestion gate, and their Vite sessions observed a hot update. Affected native
suggestion cases were repeated in the fresh five-case run. Final unit checks,
built-app reload and linked save/undo used final source. Do not describe the
entire earlier browser run as a frozen final-revision run. Native scene/annotation
tests logged revision conflicts and the docs run logged a nonfatal backend
exception; scenario assertions passed. Those logs are distinct from the final
zero-alert/zero-failed-request linked-book walkthrough.

## Headed Brave and actual writer

A dedicated headed Brave profile was controlled with local Playwright. The
original book opened with its full source path visible. A caret inside the opening
sentence attached exactly that sentence. ModelWarden `writer` returned two
alternatives with apply, adjust and reject controls. No proposal was applied.

An initial follow-up returned 502 with an empty Workshop response. The request
used the old 1,024-token fallback despite a configured 4,096-token reply limit.
Workshop now honors that setting when the API caller has not supplied a reserve;
tests cover both configuration and explicit caller precedence. The actual retry
returned 200 and two further alternatives, retaining the same target identity.

Context used reported 2,915 estimated prompt tokens, a 4,096-token output reserve,
a 32,768-token Workshop cap and the configured 1,000,000-token model context.
Two authority/voice lore entries were included; nine were excluded with reasons.
Separate scope probes verified different numbered/draft continuity rules.

On the final build and restarted backend, the linked book loaded with zero failed
requests and no visible alerts. A disposable linked file accepted one typed
character (200) and Ctrl+Z (200). Disk verification confirmed exact restoration
of BOM, CRLF/mixed line endings, combining Unicode and mode 0640. The concurrency
regression separately proves exactly one successful save and one revision
conflict when two app projects write the same original file.

A final SHA-256, size and mode comparison found all 149 existing book files
unchanged, with no added or removed files. Existing author changes and an
untracked note were preserved. App metadata holds 17 distinct chapter/draft/
alternative records, 10 reference exclusions and 11 sourced lore entries.

## Boundaries

Lore entries are dated snapshots with provenance; original planning documents do
not synchronize automatically. Draft presence does not accept its events as
canon. World Info import/export retains the documented compatibility subset;
SillyTavern itself is not this app's live backend.

Locks coordinate one running app process. Atomic replacement avoids torn files
but cannot exclude an arbitrary external editor from the interval after the last
revision comparison. Browser drafts, explicit conflicts and recovery remain
available. Workshop conversations belong to their browser profile and origin.
