# Developing the writer workspace

The fork starts at upstream develop `e9e272f7446afdd0dd31652d5aec32714929c73a`.
`origin` is the author's fork; `upstream` is StableLlamaAI/AugmentedQuill.
Use the goal file and `.dossier/notes/writer-workspace/status.md` for current scope
and evidence. The original upstream agent guide is retained in Git at the base
revision. `AGENTS.md` keeps project constraints and contextual entry points,
following the OpenAI article supplied by the author on 12 September 2026.

## Setup and run

Prerequisites: Python 3.12+, Node 24+, npm, and uv. From the repository root:

```sh
make setup
make dev
```

Open http://127.0.0.1:28001. The backend runs at 127.0.0.1:28000 and the development
frontend explicitly proxies to it. Ctrl+C stops this launch's child processes.
`make run` builds the frontend and serves the app at http://127.0.0.1:28000.
Runtime files stay under ignored `.local-data/`; tests have their own temporary
data. These commands neither launch nor reconfigure an inference service.

The author supplied ModelWarden at `http://127.0.0.1:3758/v1`, model `writer`.
The isolated app uses it as the writing/chat/editing connection. The route
returned `deepseek-v4-flash` during verification; a loopback proxy address does
not establish that inference runs on the local GPU. The earlier llama-swap
writer request failed because its GPU allocation could not fit.
Keep actual provider settings in local runtime data, outside Git. In Settings,
use the OpenAI-compatible base URL ending in `/v1` and choose the desired roles.
No inference service is restarted by this checkout's launch helpers.

## Validation

Start with the tests relevant to a change. Before completing the build, run:

```sh
venv/bin/ruff check .
venv/bin/black --check .
venv/bin/python -m pytest
npm --prefix src/frontend run lint
npm --prefix src/frontend run typecheck
npm --prefix src/frontend run test
npm --prefix src/frontend run build
npm --prefix src/frontend run check:generated-types
src/frontend/node_modules/.bin/prettier --check '**/*.{ts,tsx,js,jsx,mjs,cjs,json,css,scss,md,html}'
```

`tools/enforce_code_hygiene.py` is an upstream bulk rewriting utility, not a
validation command; it rewrites headers across the tree. The earlier upstream
guidance also referenced a nonexistent `tools/check_copyright.py`. Preserve
license/purpose headers during edits and use the actual checks in
`.github/workflows/code-quality.yml`.

The browser fixture in `src/frontend/playwright.docs.config.ts` uses isolated data
and a mock model. Its pass does not replace the real-model workshop acceptance
session. Record commands, outcomes and relevant failures in `.dossier/evidence/`.

From `src/frontend`, run the repository browser suites with
`npm exec -- playwright test --config=playwright.config.ts`, then repeat with
`playwright.docs.config.ts` and `playwright.fullstack.config.ts`.
The pipeline additionally runs `pip-audit --ignore-vuln CVE-2026-4539
--ignore-vuln CVE-2026-3219`; npm audit runs when dependencies change.

Run `make types` after API changes: it exports the current backend schema under
the isolated runtime paths and regenerates the frontend types. Commit both
generated files with the API changes. `check:generated-types` verifies that the
committed generated file matches the schema.
