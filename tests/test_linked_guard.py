# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Request-policy tests for linked Markdown projects.

These tests exercise the guard in a small FastAPI application rather than the
full application startup.  The production middleware is intentionally owned
by ``main.py``; keeping the fixture local makes this suite safe while that
integration is being assembled and proves the important property at the HTTP
boundary: blocked handlers never receive a request.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from augmentedquill.api.v1.linked_guard import (
    linked_request_guard,
    validate_linked_content_put,
    validate_linked_recovery_restore,
)
from augmentedquill.services.projects.manuscript_link import create_link_manifest


def _request(path: str, method: str = "GET") -> Request:
    """Build a Starlette request without consuming a body channel."""
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": b"",
            "headers": [],
            "server": ("testserver", 80),
            "client": ("testclient", 1),
        }
    )


def _linked_fixture(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[Path, Path]:
    """Create one app project and two explicitly selected source files."""
    projects = tmp_path / "projects"
    projects.mkdir()
    monkeypatch.setenv("AUGQ_PROJECTS_ROOT", str(projects))

    source = tmp_path / "author-manuscript"
    source.mkdir()
    (source / "chapter-01.md").write_bytes(b"First chapter\r\n")
    (source / "chapter-02.md").write_bytes("Second chapter — déjà vu\n".encode())
    (source / "private-planning.md").write_text("Do not import", encoding="utf-8")

    project = projects / "linked-book"
    project.mkdir()
    (project / "story.json").write_text(
        json.dumps({"project_type": "novel", "chapters": [{"title": "One"}]}),
        encoding="utf-8",
    )
    create_link_manifest(
        project,
        source_root=source,
        files=["chapter-01.md", "chapter-02.md"],
        excluded=[{"source": "private-planning.md", "role": "reference"}],
    )
    return project, source


def _body(response: Any) -> dict[str, Any]:
    return json.loads(response.body)


def test_linked_allowlist_and_structured_denial(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project, _source = _linked_fixture(tmp_path, monkeypatch)
    project_name = project.name

    allowed = (
        ("GET", f"/api/v1/projects/{project_name}/chapters"),
        ("GET", f"/api/v1/projects/{project_name}/prompts"),
        ("GET", f"/api/v1/projects/{project_name}/chapters/1"),
        ("PUT", f"/api/v1/projects/{project_name}/chapters/1/content"),
        ("PUT", f"/api/v1/projects/{project_name}/chapters/1/metadata"),
        ("PUT", f"/api/v1/projects/{project_name}/chapters/1/title"),
        ("PUT", f"/api/v1/projects/{project_name}/chapters/1/summary"),
        ("POST", f"/api/v1/projects/{project_name}/workshop/discuss"),
        ("GET", f"/api/v1/projects/{project_name}/manuscript/link"),
        ("GET", f"/api/v1/projects/{project_name}/view-state"),
        ("PUT", f"/api/v1/projects/{project_name}/view-state"),
        ("GET", f"/api/v1/projects/{project_name}/content-recovery"),
        (
            "GET",
            f"/api/v1/projects/{project_name}/content-recovery/checkpoint-1",
        ),
        (
            "POST",
            f"/api/v1/projects/{project_name}/content-recovery/checkpoint-1/restore",
        ),
        ("GET", f"/api/v1/projects/{project_name}/lore"),
        ("POST", f"/api/v1/projects/{project_name}/lore"),
        ("PUT", f"/api/v1/projects/{project_name}/lore/entry-1"),
        ("DELETE", f"/api/v1/projects/{project_name}/lore/entry-1"),
    )
    for method, path in allowed:
        assert linked_request_guard(_request(path, method)) is None, (method, path)

    blocked = (
        ("POST", f"/api/v1/projects/{project_name}/manuscript/link"),
        ("POST", f"/api/v1/projects/{project_name}/chapters"),
        ("PATCH", f"/api/v1/projects/{project_name}/chapters/1/content"),
        ("POST", f"/api/v1/projects/{project_name}/chapters/1/metadata"),
        ("PATCH", f"/api/v1/projects/{project_name}/chapters/1/title"),
        ("DELETE", f"/api/v1/projects/{project_name}/chapters/1"),
        ("POST", f"/api/v1/projects/{project_name}/chapters/reorder"),
        ("POST", f"/api/v1/projects/{project_name}/books/reorder"),
        ("POST", f"/api/v1/projects/{project_name}/scenes"),
        ("POST", f"/api/v1/projects/{project_name}/annotations"),
        ("POST", f"/api/v1/projects/{project_name}/search/replace-all"),
        ("POST", f"/api/v1/projects/{project_name}/checkpoints/restore"),
        ("POST", f"/api/v1/projects/{project_name}/story/generate"),
        ("POST", f"/api/v1/projects/{project_name}/chat/stream"),
        ("POST", f"/api/v1/projects/{project_name}/sourcebook"),
    )
    for method, path in blocked:
        response = linked_request_guard(_request(path, method))
        assert response is not None, (method, path)
        assert response.status_code == 403
        payload = _body(response)
        assert payload["ok"] is False
        assert payload["error"] == "linked_manuscript_guard"
        assert payload["code"] == "linked_manuscript_operation_blocked"
        assert payload["project"] == project_name
        assert payload["workshop_path"].endswith("/workshop/discuss")
        assert "Use Workshop" in payload["detail"]


def test_guard_covers_legacy_active_and_global_mutations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project, source = _linked_fixture(tmp_path, monkeypatch)
    import augmentedquill.api.v1.linked_guard as guard_module

    monkeypatch.setattr(guard_module, "get_active_project_dir", lambda: project)

    # Global settings/project discovery remain usable, and the narrow legacy
    # chapter reads/content endpoint work before the rewrite middleware runs.
    for method, path in (
        ("GET", "/api/v1/projects"),
        ("POST", "/api/v1/projects/select"),
        ("GET", "/api/v1/settings"),
        ("GET", "/api/v1/machine"),
        ("GET", "/api/v1/prompts"),
        ("GET", "/api/v1/chapters"),
        ("GET", "/api/v1/chapters/1"),
        ("PUT", "/api/v1/chapters/1/content"),
        ("PUT", "/api/v1/chapters/1/metadata"),
        ("PUT", "/api/v1/chapters/1/title"),
        ("PUT", "/api/v1/chapters/1/summary"),
    ):
        assert linked_request_guard(_request(path, method)) is None, (method, path)

    for method, path in (
        ("POST", "/api/v1/chat/stream"),
        ("POST", "/api/v1/books/delete"),
        ("POST", "/api/v1/books/reorder"),
        ("POST", "/api/v1/projects/convert"),
        ("POST", "/api/v1/projects/images/generate"),
        ("POST", "/api/v1/chapters/1/title"),
        ("POST", "/api/v1/story/generate"),
    ):
        response = linked_request_guard(_request(path, method))
        assert response is not None and response.status_code == 403

    # A denial happens before the endpoint, so an attempted destructive route
    # cannot alter the author-owned bytes.
    assert (source / "chapter-01.md").read_bytes() == b"First chapter\r\n"


def test_fastapi_middleware_stops_mutating_handler(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project, source = _linked_fixture(tmp_path, monkeypatch)
    app = FastAPI()
    attempted = False

    @app.middleware("http")
    async def linked_policy(request: Request, call_next: Any) -> Any:
        response = linked_request_guard(request)
        if response is not None:
            return response
        return await call_next(request)

    @app.post(f"/api/v1/projects/{project.name}/scenes")
    async def dangerous_handler() -> dict[str, bool]:
        nonlocal attempted
        attempted = True
        (source / "chapter-01.md").write_bytes(b"MUTATED")
        return {"ok": True}

    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/projects/{project.name}/scenes",
            json={"name": "unsafe"},
        )
    assert response.status_code == 403
    assert attempted is False
    assert (source / "chapter-01.md").read_bytes() == b"First chapter\r\n"


def test_invalid_or_missing_source_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project, source = _linked_fixture(tmp_path, monkeypatch)
    source_file = source / "chapter-01.md"
    original = source_file.read_bytes()
    source_file.unlink()

    response = linked_request_guard(
        _request(f"/api/v1/projects/{project.name}/chapters")
    )
    assert response is not None and response.status_code == 403
    payload = _body(response)
    assert payload["code"] == "linked_manuscript_operation_blocked"
    assert "manifest" in payload["detail"].lower()
    assert not source_file.exists()
    assert original == b"First chapter\r\n"


def test_missing_manifest_for_declared_link_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    projects = tmp_path / "projects"
    projects.mkdir()
    monkeypatch.setenv("AUGQ_PROJECTS_ROOT", str(projects))
    project = projects / "declared-linked"
    project.mkdir()
    (project / "story.json").write_text(
        json.dumps(
            {
                "project_type": "novel",
                "storage_mode": "linked-markdown",
                "source_root": str(tmp_path / "missing-source"),
            }
        ),
        encoding="utf-8",
    )

    response = linked_request_guard(
        _request(f"/api/v1/projects/{project.name}/chapters")
    )
    assert response is not None and response.status_code == 403
    assert "manifest" in _body(response)["detail"].lower()


def test_invalid_manifest_symlink_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project, _source = _linked_fixture(tmp_path, monkeypatch)
    manifest = project / ".aq_import" / "manuscript-link.json"
    target = tmp_path / "outside-manifest.json"
    target.write_text("{}", encoding="utf-8")
    manifest.unlink()
    manifest.symlink_to(target)

    response = linked_request_guard(
        _request(f"/api/v1/projects/{project.name}/chapters")
    )
    assert response is not None and response.status_code == 403
    assert "symlink" in _body(response)["detail"].lower()


def test_unlinked_project_is_not_restricted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    projects = tmp_path / "projects"
    projects.mkdir()
    monkeypatch.setenv("AUGQ_PROJECTS_ROOT", str(projects))
    project = projects / "ordinary"
    project.mkdir()
    (project / "story.json").write_text(
        json.dumps({"project_type": "novel"}), encoding="utf-8"
    )

    assert (
        linked_request_guard(
            _request(f"/api/v1/projects/{project.name}/chapters/1", "DELETE")
        )
        is None
    )


def test_checked_linked_saves_require_revision_and_document_identity() -> None:
    good = {
        "expected_revision": hashlib.sha256(b"before").hexdigest(),
        "expected_document_key": "linked:1234/chapter-01.md",
    }
    validate_linked_content_put(good)
    validate_linked_recovery_restore(good)

    for payload in (
        {},
        {
            "expected_revision": "stale",
            "expected_document_key": good["expected_document_key"],
        },
        {
            "expected_revision": good["expected_revision"],
            "expected_document_key": "chapter-01.md",
        },
        {
            "expected_revision": good["expected_revision"],
            "expected_document_key": "linked:\x00bad",
        },
    ):
        with pytest.raises(ValueError, match="require"):
            validate_linked_content_put(payload)
