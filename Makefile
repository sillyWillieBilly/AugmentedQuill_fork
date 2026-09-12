# Development shortcuts for the isolated writing workspace.
.PHONY: setup dev run test check types

setup:
	uv venv --python 3.12 --allow-existing venv
	uv pip install --python venv/bin/python -e '.[dev]'
	npm --prefix src/frontend ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund

dev:
	bash tools/writer-dev.sh dev

run:
	npm --prefix src/frontend run build
	bash tools/writer-dev.sh run

test:
	venv/bin/python -m pytest
	npm --prefix src/frontend test

check:
	venv/bin/ruff check .
	venv/bin/black --check .
	npm --prefix src/frontend run lint
	npm --prefix src/frontend run typecheck

types:
	bash tools/writer-dev.sh types
