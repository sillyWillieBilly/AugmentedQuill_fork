# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Project-contained listing and explicit restore for content recovery pairs."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.api.v1.http_responses import error_json
from augmentedquill.models.content_recovery import (
    ContentRecoveryDetail,
    ContentRecoveryListResponse,
    ContentRecoveryRestoreRequest,
    ContentRecoveryRestoreResponse,
    ContentRecoverySummary,
)
from augmentedquill.services.projects.content_persistence import (
    ContentRecoveryRecord,
    ContentRevisionConflict,
    async_restore_content_recovery,
    list_content_recovery,
    read_content_recovery,
)

router = APIRouter(
    prefix="/projects/{project_name}/content-recovery",
    tags=["Content Recovery"],
)


def _summary(record: ContentRecoveryRecord) -> ContentRecoverySummary:
    """Map a validated service record to its metadata-only response."""
    return ContentRecoverySummary(
        recovery_id=record.recovery_id,
        status=record.status,
        document_key=record.after.document_key,
        filename=record.after.filename,
        before_revision=record.before.revision,
        after_revision=record.after.revision,
        created_at=record.created_at,
        committed_at=record.committed_at,
    )


def _detail(record: ContentRecoveryRecord) -> ContentRecoveryDetail:
    """Map a validated service record to its exact-content response."""
    return ContentRecoveryDetail(
        **_summary(record).model_dump(),
        before_content=record.before.content,
        after_content=record.after.content,
    )


@router.get("", response_model=ContentRecoveryListResponse)
async def api_list_content_recovery(
    project_dir: ProjectDep,
) -> ContentRecoveryListResponse:
    """List valid, project-contained before/after recovery records."""
    return ContentRecoveryListResponse(
        records=[_summary(record) for record in list_content_recovery(project_dir)]
    )


@router.get("/{recovery_id}", response_model=ContentRecoveryDetail)
async def api_read_content_recovery(
    project_dir: ProjectDep, recovery_id: str
) -> ContentRecoveryDetail | JSONResponse:
    """Read one validated recovery pair without changing the manuscript."""
    try:
        return _detail(read_content_recovery(project_dir, recovery_id))
    except FileNotFoundError as exc:
        return error_json(str(exc), status_code=404)
    except (OSError, ValueError) as exc:
        return error_json(str(exc), status_code=400)


@router.post(
    "/{recovery_id}/restore",
    response_model=ContentRecoveryRestoreResponse,
)
async def api_restore_content_recovery(
    body: ContentRecoveryRestoreRequest,
    project_dir: ProjectDep,
    recovery_id: str,
) -> ContentRecoveryRestoreResponse | JSONResponse:
    """Restore a selected pair only when the caller's current base matches."""
    try:
        snapshot = await async_restore_content_recovery(
            project_dir,
            recovery_id,
            body.target,
            expected_revision=body.expected_revision,
            expected_document_key=body.expected_document_key,
            expected_filename=body.expected_filename,
        )
    except ContentRevisionConflict as exc:
        current = exc.snapshot
        return error_json(
            str(exc),
            status_code=409,
            content=current.content,
            revision=current.revision,
            filename=current.filename,
            document_key=current.document_key,
        )
    except FileNotFoundError as exc:
        return error_json(str(exc), status_code=404)
    except (OSError, ValueError) as exc:
        return error_json(str(exc), status_code=400)

    return ContentRecoveryRestoreResponse(
        ok=True,
        content=snapshot.content,
        revision=snapshot.revision,
        filename=snapshot.filename,
        document_key=snapshot.document_key,
    )
