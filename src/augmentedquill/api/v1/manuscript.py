# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Project-scoped linking of explicitly selected external manuscripts."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.models.manuscript import (
    ManuscriptLinkRequest,
    ManuscriptLinkResponse,
)
from augmentedquill.services.projects.manuscript_link import (
    ManuscriptLinkError,
    async_create_link_manifest,
    load_link_manifest,
)

router = APIRouter(prefix="/projects/{project_name}", tags=["Manuscript"])


@router.get("/manuscript/link", response_model=ManuscriptLinkResponse)
async def api_get_manuscript_link(project_dir: ProjectDep) -> ManuscriptLinkResponse:
    """Return the explicit external manuscript allowlist."""
    try:
        manifest = load_link_manifest(project_dir)
    except ManuscriptLinkError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if manifest is None:
        raise HTTPException(status_code=404, detail="Project has no linked manuscript")
    return ManuscriptLinkResponse(**manifest)


@router.post("/manuscript/link", response_model=ManuscriptLinkResponse)
async def api_create_manuscript_link(
    body: ManuscriptLinkRequest, project_dir: ProjectDep
) -> ManuscriptLinkResponse:
    """Link selected Markdown/text files without copying or modifying them."""
    try:
        manifest = await async_create_link_manifest(
            project_dir,
            source_root=Path(body.source_root),
            files=body.files,
            excluded=body.excluded,
        )
    except ManuscriptLinkError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ManuscriptLinkResponse(**manifest)
