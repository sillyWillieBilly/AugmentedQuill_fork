# Precise writing workspace

## Objective

Deliver the complete goal in `augmentedquill-writer-goal.md`. Reuse AugmentedQuill's
manuscript editor and Sourcebook, with a dedicated workshop conversation that
captures exact passage context, proposes wording without write tools, and applies
checked changes through normal editor undo and durable persistence.

## Source findings and design

- Baseline is current upstream develop e9e272f. Focused baseline passes: 84 frontend
  and 135 backend tests. Node 24.15.0, Python 3.12.13; dependencies installed here.
- Editor uses CodeMirror with stripped internal markers. `internalTags.ts` already
  provides exact raw/visible offset conversion; all view modes must use it.
- The normal chat can invoke mutating tools. A dedicated workshop API will have
  no mutation tools and will supply structured discussion/alternatives. Normal
  automation chat remains a distinct, explicitly selected workflow.
- The current chapter save path is unconditional and swallows errors. Introduce
  checked saves with visible conflicts, serialize competing saves, and preserve
  unsaved buffers. Both chapter prose and short-story drafts need the same rules.
- Lore is shared with the Sourcebook and scoped explicitly. SillyTavern is a pinned
  semantic reference; independently implemented activation avoids a hidden browser
  dependency and copying its tightly coupled AGPL implementation.

## Execution waves

### Wave 1: Complete passage workflow

1. **Passage identity and editor integration (lead)** — small tested helper for
   sentence/paragraph/selection targeting with explicit UTF-16 offsets and raw
   marker mapping; fresh snapshot on send; strict document/original checks on
   application. Add live editor handle operations and visible target preview.
   QA: caret, reversed/explicit selection, repeated text, Unicode, markers and mode
   switching. Stale snapshots and wrong-document application are rejected.
2. **Checked persistence (backend packet)** — revision fingerprints, serialized
   conditional saves and recovery for chapter and short-story prose; client captures
   the loaded revision and surfaces failed saves. QA: external modification,
   in-flight edits, delayed/stale responses, failed saves, reopen and undo/redo.
3. **Workshop API and panel (lead after contracts)** — project-scoped context and
   non-mutating discussion request, structured alternatives, explicit apply/reject,
   cancel/error feedback, keep proposals across discussion and chapter changes.
   QA: mock model flow and observable absence of prose/canon writes during generation.

### Wave 2: Lore and compatibility

4. **Lore domain and fixtures (lore packet)** — canon/belief/proposal metadata,
   viewpoint/chapter/scene/timeline eligibility, aliases/relationships/references,
   relevance with reasons and bounded budget/recursion. QA includes exclusion,
   competing priorities, cyclic recursion and budget exhaustion.
5. **World Info import/export (lore packet)** — preserve original IDs, all fields and
   unknown metadata; implement goal subset against pinned SillyTavern reference;
   unsupported semantics surfaced before use. QA lossless round trip and supported
   activation fixtures. Document implementation/license boundaries.
6. **Lore controls and context inspector (lead)** — edit explicit scope/authority,
   import/export, inspect exact sent messages, excluded entries/reasons and token
   estimates. Integrate the same selector into workshop. QA synthetic projects,
   no auto canon promotion, trial imported lorebook and persistence.

### Wave 3: Durable launch and acceptance

7. **Projects and usability** — copy-based Markdown manuscript import, backwards
   compatibility/migrations, recovery controls, provider selection and repeatable
   launch. QA original hashes unchanged, project reopen and useful connection errors.
8. **Final verification** — required Python/frontend/API/header checks, independent
   editing/persistence and scope review, then headed mock and actual local writer
   model workflow. Record exact runtime/commit and evidence for all nine goal gates.

## Contracts and ownership

Lead owns frontend workshop/editor components, workshop API/service integration,
i18n and final generated API files. The persistence packet may own existing
chapter/story save routes, services, API clients and useStory save error plumbing;
coordinate before touching shared files. Lore packet owns a new lore domain and
its tests/routes; agree Sourcebook extension/interface before editing shared models.
Agent findings can refine contracts without reducing goal requirements. Avoid
concurrent edits to the same file.

## Verification and commits

Focused invariant tests precede each new behaviour. Record meaningful results in
`.dossier/evidence/`. Required final commands are in `docs/DEVELOPMENT.md`.
Use focused commits for setup, editing, lore and verified integration; stage explicit
paths only. The goal authorizes this. Do not commit local runtime/model settings,
credentials, manuscript copies, environments or browser session files.

Completion requires all goal acceptance items, including real local inference and
headed editor interaction. Mocks alone never prove completion. Existing book and
SillyTavern/inference services remain untouched.
