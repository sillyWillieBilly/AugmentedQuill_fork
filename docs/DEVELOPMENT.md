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

The existing OpenAI-compatible llama-swap service was discovered at
http://127.0.0.1:8080/v1. Read its current model list before choosing a model.
Keep actual provider settings in local runtime data, outside Git.

## Validation

Start with the tests relevant to a change. Before completing the build, run:

```sh
venv/bin/ruff check .
venv/bin/black --check .
venv/bin/python -m pytest
venv/bin/python tools/enforce_code_hygiene.py .
venv/bin/python tools/check_copyright.py .
npm --prefix src/frontend run lint
npm --prefix src/frontend run typecheck
npm --prefix src/frontend run test
npm --prefix src/frontend run build
npm --prefix src/frontend run check:generated-types
```

The browser fixture in `src/frontend/playwright.docs.config.ts` uses isolated data
and a mock model. Its pass does not replace the real-model workshop acceptance
session. Record commands, outcomes and relevant failures in `.dossier/evidence/`.
