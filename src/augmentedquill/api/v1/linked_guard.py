# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Fail-closed request policy for projects linked to original manuscripts.

Linked Markdown projects deliberately expose a much smaller HTTP surface than
ordinary AugmentedQuill projects.  The source files are author-owned paths, so
legacy routes must be stopped before they can call helpers that rename,
annotate, generate into, or otherwise rewrite a chapter.  The middleware entry
point in this module is synchronous and does not consume a request body; it is
safe to call from the existing HTTP middleware before FastAPI parses a body.

The checked chapter content and recovery routes still validate their revision
and document identity in their service layer.  ``validate_linked_content_put``
is provided for those route handlers to enforce the required request fields.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from augmentedquill.services.projects.manuscript_link import (
    ManuscriptLinkError,
    has_link_manifest,
    is_linked_project,
    load_link_manifest,
    manifest_path,
)
from augmentedquill.services.projects.projects import (
    get_active_project_dir,
    get_projects_root,
)
from augmentedquill.utils.path_utils import safe_child_path

_API_PREFIX = "/api/v1/"
_PROJECT_GLOBAL_ROUTES = frozenset(
    {"create", "delete", "select", "convert", "images", "export", "import"}
)
_GLOBAL_PROJECT_MUTATIONS = (
    "projects/create",
    "projects/delete",
    "projects/convert",
    "projects/images/",
    "projects/import",
    "books/create",
    "books/delete",
    "books/restore",
    "books/reorder",
)
_LEGACY_PROJECT_PREFIXES = (
    "chapters",
    "story",
    "sourcebook",
    "checkpoints",
    "content-recovery",
    "search",
    "scenes",
    "annotations",
    "chat/",
    "chats",
    "lore",
    "manuscript/",
    "view-state",
    "workshop/",
)
_CHAPTER_GET = re.compile(r"^chapters/[1-9][0-9]*$")
_CHAPTER_CONTENT_PUT = re.compile(r"^chapters/[1-9][0-9]*/content$")
_CHAPTER_METADATA_PUT = re.compile(r"^chapters/[1-9][0-9]*/(?:metadata|title|summary)$")
_CONTENT_RECOVERY_RESTORE = re.compile(r"^content-recovery/[^/]+/restore$")
_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")


def _matches_global_project_mutation(relative: str) -> bool:
    return any(
        relative == prefix.rstrip("/") or relative.startswith(f"{prefix.rstrip('/')}/")
        for prefix in _GLOBAL_PROJECT_MUTATIONS
    )


def _api_relative_path(path: str) -> str:
    """Return an API route without the prefix or surrounding slash."""
    if path.startswith(_API_PREFIX):
        return path[len(_API_PREFIX) :].strip("/")
    return path.strip("/")


def _project_path(name: str) -> Path | None:
    """Resolve a project name without turning an unknown route into a 403."""
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        return None
    try:
        candidate = safe_child_path(get_projects_root(), name)
    except (OSError, ValueError):
        return None
    if not candidate.is_dir() or not (candidate / "story.json").is_file():
        return None
    return candidate


def _manifest_is_present(project_dir: Path) -> bool:
    """Detect even malformed or symlinked manifests so the policy fails closed."""
    path = manifest_path(project_dir)
    return path.exists() or path.is_symlink() or path.parent.is_symlink()


def _manifest_error(
    project_dir: Path, *, manifest_present: bool | None = None
) -> str | None:
    """Return an actionable manifest error, or ``None`` for a valid capability."""
    if manifest_present is None:
        manifest_present = _manifest_is_present(project_dir)
    if not manifest_present:
        if is_linked_project(project_dir):
            return "The linked manuscript manifest is missing from the project."
        return None
    try:
        if not has_link_manifest(project_dir):
            return "The linked manuscript manifest is missing or not a regular project-local file."
        load_link_manifest(project_dir)
    except (ManuscriptLinkError, OSError, RuntimeError) as exc:
        return f"The linked manuscript manifest is invalid: {exc}"
    return None


def _is_linked_project(project_dir: Path) -> tuple[bool, str | None]:
    """Return linked state while treating a present invalid manifest as linked."""
    manifest_present = _manifest_is_present(project_dir)
    error = _manifest_error(project_dir, manifest_present=manifest_present)
    if error is not None:
        return True, error
    return manifest_present, None


def _target_for_route(relative: str) -> tuple[Path | None, str | None, str]:
    """Resolve a project target and the project-relative route suffix.

    ``relative`` may be either the already rewritten project route or a legacy
    active-project route.  This makes the guard safe to call immediately before
    or after the legacy rewrite middleware.
    """
    parts = relative.split("/") if relative else []
    if parts and parts[0] == "projects":
        if len(parts) >= 3 and parts[1] not in _PROJECT_GLOBAL_ROUTES:
            project_name = parts[1]
            return _project_path(project_name), project_name, "/".join(parts[2:])
        if _matches_global_project_mutation(relative):
            return get_active_project_dir(), None, relative
        return None, None, relative

    # These are global active-project mutations in the legacy API.  Project
    # creation/deletion is app-local, but the linked policy intentionally keeps
    # all project/book mutation routes behind an explicit non-linked selection.
    if _matches_global_project_mutation(relative):
        return get_active_project_dir(), None, relative

    if relative == "chat" or relative.startswith("chat/"):
        return get_active_project_dir(), None, relative

    if any(
        relative == prefix.rstrip("/") or relative.startswith(prefix)
        for prefix in _LEGACY_PROJECT_PREFIXES
    ):
        return get_active_project_dir(), None, relative

    return None, None, relative


def _allowed_linked_route(method: str, suffix: str) -> bool:
    """Return whether a linked project may receive this route."""
    method = method.upper()
    if method in {"OPTIONS", "HEAD"}:
        return True

    if suffix == "chapters":
        return method == "GET"
    if _CHAPTER_GET.fullmatch(suffix):
        return method == "GET"
    if _CHAPTER_METADATA_PUT.fullmatch(suffix):
        # These handlers update project-local story.json metadata only.  They
        # do not write, rename, reorder, or otherwise alter linked sources.
        return method == "PUT"
    if _CHAPTER_CONTENT_PUT.fullmatch(suffix):
        return method == "PUT"

    if suffix == "workshop/discuss":
        return method == "POST"

    if suffix == "prompts":
        return method == "GET"

    if suffix == "manuscript/link":
        return method == "GET"

    if suffix == "view-state":
        return method in {"GET", "PUT"}

    if suffix == "content-recovery" or suffix.startswith("content-recovery/"):
        # Listing/preview are read-only.  Restore is separately revision-guarded
        # by ContentRecoveryRestoreRequest and persist_content.
        return method == "GET" or (
            method == "POST" and _CONTENT_RECOVERY_RESTORE.fullmatch(suffix)
        )

    if suffix == "lore" or suffix.startswith("lore/"):
        return method in {"GET", "POST", "PUT", "DELETE"}

    return False


def _blocked_response(
    *,
    project_name: str | None,
    method: str,
    path: str,
    reason: str | None = None,
) -> JSONResponse:
    """Build one stable, actionable 403 response for the frontend."""
    workshop_path = (
        f"/api/v1/projects/{project_name}/workshop/discuss"
        if project_name
        else "/api/v1/projects/{project_name}/workshop/discuss"
    )
    detail = (
        "This linked Markdown project protects its original manuscript files. "
        "Use Workshop to discuss a passage, then apply an accepted alternative "
        "through the checked editor save."
    )
    if reason:
        detail = f"{detail} {reason}"
    return JSONResponse(
        status_code=403,
        content={
            "ok": False,
            "error": "linked_manuscript_guard",
            "code": "linked_manuscript_operation_blocked",
            "detail": detail,
            "method": method.upper(),
            "path": path,
            "project": project_name,
            "workshop_path": workshop_path,
        },
    )


def linked_request_guard(request: Request) -> JSONResponse | None:
    """Return a 403 response when a linked project receives a blocked request.

    Call this from HTTP middleware after any legacy path rewrite.  It is also
    safe before the rewrite because legacy project routes resolve the active
    project directly.  The function never reads the request body, so FastAPI
    can still parse JSON for routes that are allowed.
    """
    path = str(request.scope.get("path") or request.url.path)
    relative = _api_relative_path(path)
    project_dir, project_name, suffix = _target_for_route(relative)
    if project_dir is None:
        return None

    linked, manifest_error = _is_linked_project(project_dir)
    if not linked:
        return None
    if manifest_error is not None:
        return _blocked_response(
            project_name=project_name or project_dir.name,
            method=request.method,
            path=path,
            reason=manifest_error,
        )
    if project_name is None:
        project_name = project_dir.name
    if _allowed_linked_route(request.method, suffix):
        return None
    return _blocked_response(
        project_name=project_name,
        method=request.method,
        path=path,
    )


def validate_linked_content_put(payload: Mapping[str, Any]) -> None:
    """Require a revision and stable external identity for linked content PUT.

    This helper is intentionally separate from middleware because request-body
    reads in middleware can consume Starlette's receive channel.  A content
    route should call it after Pydantic parsing and before its persistence
    service.  The service still performs the authoritative current-file CAS.
    """
    expected_revision = payload.get("expected_revision")
    expected_document_key = payload.get("expected_document_key")
    if not isinstance(expected_revision, str) or not _SHA256.fullmatch(
        expected_revision
    ):
        raise ValueError(
            "Linked manuscript content saves require a 64-character SHA-256 expected_revision."
        )
    if (
        not isinstance(expected_document_key, str)
        or not expected_document_key.startswith("linked:")
        or "\x00" in expected_document_key
    ):
        raise ValueError(
            "Linked manuscript content saves require the captured linked document_key."
        )


def validate_linked_recovery_restore(payload: Mapping[str, Any]) -> None:
    """Require the same checked identity fields for recovery restore requests."""
    validate_linked_content_put(payload)
