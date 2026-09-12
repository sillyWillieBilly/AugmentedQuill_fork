# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Project-scoped lore CRUD, deterministic selection, and World Info exchange."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.services.lore.activation import select_project_lore
from augmentedquill.services.lore.models import (
    LoreContextRequest,
    LoreEntry,
    LoreEntryCreate,
    LoreEntryUpdate,
    LoreSelectionResult,
)
from augmentedquill.services.lore.native import (
    async_create_native_lore,
    async_delete_native_lore,
    async_update_native_lore,
    get_native_lore,
    list_native_lore,
)
from augmentedquill.services.lore.storage import (
    async_delete_world_info,
    async_write_world_info,
    list_world_info_books,
    read_world_info,
    unsupported_world_info_options,
)

router = APIRouter(prefix="/projects/{project_name}", tags=["Lore"])


@router.get("/lore/world-info")
async def api_list_world_info(project_dir: ProjectDep) -> list[dict[str, Any]]:
    """List imported raw World Info books and their unsupported options."""

    books: list[dict[str, Any]] = []
    for name in list_world_info_books(project_dir):
        try:
            payload = read_world_info(project_dir, name) or {}
        except ValueError as exc:
            books.append(
                {
                    "name": name,
                    "unsupported_options": [f"{name}: unreadable World Info ({exc})"],
                }
            )
            continue
        books.append(
            {
                "name": name,
                "unsupported_options": unsupported_world_info_options(name, payload),
            }
        )
    return books


@router.get("/lore/world-info/{book_name:path}")
async def api_get_world_info(book_name: str, project_dir: ProjectDep) -> dict[str, Any]:
    """Export a raw World Info book without normalizing unknown fields."""

    try:
        payload = read_world_info(project_dir, book_name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if payload is None:
        raise HTTPException(
            status_code=404, detail=f"World Info book '{book_name}' not found"
        )
    return payload


@router.post("/lore/world-info/{book_name:path}")
async def api_import_world_info(
    book_name: str, payload: dict[str, Any], project_dir: ProjectDep
) -> dict[str, Any]:
    """Import a World Info object, retaining all fields and original IDs."""

    try:
        stored = await async_write_world_info(project_dir, book_name, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "name": book_name,
        "entries": len(stored.get("entries", {})),
        "unsupported_options": unsupported_world_info_options(book_name, stored),
    }


@router.delete("/lore/world-info/{book_name:path}")
async def api_delete_world_info(
    book_name: str, project_dir: ProjectDep
) -> dict[str, bool]:
    """Delete an imported World Info book."""

    if not await async_delete_world_info(project_dir, book_name):
        raise HTTPException(
            status_code=404, detail=f"World Info book '{book_name}' not found"
        )
    return {"ok": True}


@router.get("/lore", response_model=list[LoreEntry])
async def api_list_lore(
    project_dir: ProjectDep, query: str | None = None
) -> list[LoreEntry]:
    """List native Sourcebook lore and its explicit status/scope metadata."""

    return list_native_lore(project_dir, query=query)


@router.post("/lore", response_model=LoreEntry, status_code=201)
async def api_create_lore(
    payload: LoreEntryCreate, project_dir: ProjectDep
) -> LoreEntry:
    """Create a native Sourcebook entry with lore metadata."""

    try:
        return await async_create_native_lore(project_dir, payload)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/lore/{entry_id:path}", response_model=LoreEntry)
async def api_get_lore(entry_id: str, project_dir: ProjectDep) -> LoreEntry:
    """Get a native lore entry by its stable ID or current Sourcebook name."""

    entry = get_native_lore(project_dir, entry_id)
    if entry is None:
        raise HTTPException(
            status_code=404, detail=f"Lore entry '{entry_id}' not found"
        )
    return entry


@router.put("/lore/{entry_id:path}", response_model=LoreEntry)
async def api_update_lore(
    entry_id: str, payload: LoreEntryUpdate, project_dir: ProjectDep
) -> LoreEntry:
    """Update Sourcebook content and/or lore metadata without losing its ID."""

    try:
        return await async_update_native_lore(project_dir, entry_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/lore/{entry_id:path}")
async def api_delete_lore(entry_id: str, project_dir: ProjectDep) -> dict[str, bool]:
    """Delete a native lore entry."""

    if not await async_delete_native_lore(project_dir, entry_id):
        raise HTTPException(
            status_code=404, detail=f"Lore entry '{entry_id}' not found"
        )
    return {"ok": True}


@router.post("/lore/select", response_model=LoreSelectionResult)
async def api_select_lore(
    payload: LoreContextRequest, project_dir: ProjectDep
) -> LoreSelectionResult:
    """Return deterministic lore context and an inclusion/exclusion inspector."""

    return select_project_lore(
        project_dir,
        scan_text=payload.scan_text,
        scope=payload.scope,
        budget_tokens=payload.budget_tokens,
        include_beliefs=payload.include_beliefs,
        include_proposals=payload.include_proposals,
        recursive=payload.recursive,
        max_recursion_steps=payload.max_recursion_steps,
    )
