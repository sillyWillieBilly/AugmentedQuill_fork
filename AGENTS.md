# Working on the writing workspace

This fork builds a precise, lore-aware novel editor on AugmentedQuill. The current
scope and completion criteria are in `augmentedquill-writer-goal.md`; execution
state and decisions live in `.dossier/`. Read those when continuing the build.

## Project boundaries

- React/TypeScript and CodeMirror: `src/frontend/features/`. Shared UI belongs in
  `components/ui`; HTTP access belongs in `services`, using the existing API client.
- FastAPI routes in `src/augmentedquill/api/v1` delegate to domain services in
  `services/`. Resolve project routes with `ProjectDep` and shared response helpers.
- Keep user-facing strings in i18n resources and model instructions in
  `resources/config/instructions.json`. Story text inputs use the story language.
- Preserve GPL notices and the purpose header on Python/TypeScript/JavaScript
  files. Follow existing Black/Ruff/ESLint conventions and precise types.
- For API changes, regenerate `openapi.json` and `types/api.generated.ts` with the
  existing tools. For project schema changes, provide a tested migration or prove
  the extension is intrinsically backward compatible.

## Author and runtime data

- Workshop discussion cannot mutate prose or accepted lore. Apply a proposal only
  to its checked document and original passage, preserving undo and newer edits.
- Tests use disposable projects. Set the `AUGQ_*` temporary paths before importing
  backend modules, following `tests/conftest.py`. Never test against real books.
- Local development uses `.local-data/` and loopback ports 28000/28001. Keep
  credentials, model settings, manuscripts and runtime data out of Git. Preserve
  the existing SillyTavern and inference services.

## Work and verification

- For this goal, the author authorizes the fork, `codex/` development branches,
  local setup and launches, fixes, and focused commits. Preserve unrelated edits.
- Use a concise plan for substantial work and independent review for consequential
  editing/persistence changes. Prefer bounded, independent delegated packets;
  the lead owns integration and acceptance. This project workflow replaces generic
  workspace requirements for fixed review cascades and approval after every phase.
- Run relevant invariant tests as behaviour changes, then the required repository
  checks before finishing. Commands and runtime details: `docs/DEVELOPMENT.md`.
  Local tests are isolated; run and repair them without repeated permission checks.
- Keep working through the goal's browser and real-model acceptance checks. Record
  the exact tested revision, distinguish mocks from real-model evidence, and state
  remaining gaps. A first implementation is not completion.

Keep this file short and specific. Add instructions when they resolve an observed
project problem; put task history in `.dossier/`, and link detailed guidance only
where it applies. See the author's requested
[OpenAI guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra).
