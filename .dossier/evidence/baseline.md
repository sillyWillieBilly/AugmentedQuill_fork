# Baseline verification — 2026-09-12

Checkout: e9e272f7446afdd0dd31652d5aec32714929c73a, code unmodified.
Python 3.12.13; Node 24.15.0. New project-local venv and npm lockfile install.

`venv/bin/python -m pytest -q tests/unit/services/test_chat_tools.py tests/unit/services/test_project_content_marker_preservation.py tests/unit/services/test_project_snapshots.py tests/unit/api/v1/test_sourcebook_api.py tests/unit/services/test_sourcebook_validation.py`

135 passed in 12.27s, two upstream Starlette/httpx deprecation warnings.

From `src/frontend`:
`npm test -- features/editor/CodeMirrorEditor.diff.test.tsx features/editor/Editor.sync.test.tsx features/editor/DiffAcceptBar.test.tsx features/chat/chatExecutionHelpers.test.ts features/chat/useChatExecution.test.ts features/editor/codeMirrorKeymap.test.ts`

84 passed across six files in 1.22s. No real model calls in this baseline.

`bash -n tools/writer-dev.sh` passed. Actual launch still to be exercised.
