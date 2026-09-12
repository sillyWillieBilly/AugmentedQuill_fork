# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Project-scoped, non-mutating Workshop discussion endpoint."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from contextlib import suppress
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.models.workshop import (
    WorkshopDiscussRequest,
    WorkshopDiscussResponse,
)
from augmentedquill.services.exceptions import ServiceError
from augmentedquill.services.workshop.service import discuss_workshop

router = APIRouter(tags=["Workshop"])


async def _watch_disconnect(request: Request) -> bool:
    """Poll the ASGI connection until it closes, without busy-spinning."""
    while True:
        try:
            if await request.is_disconnected():
                return True
        except Exception:
            # A server-specific receive implementation must not turn a
            # context-inspection request into an unrelated provider failure.
            return False
        await asyncio.sleep(0.05)


async def _await_with_disconnect(
    request: Request,
    operation: Awaitable[Any],
) -> Any:
    """Cancel the provider operation when the client disconnects."""
    operation_task = asyncio.create_task(operation)
    disconnect_task = asyncio.create_task(_watch_disconnect(request))
    try:
        done, _ = await asyncio.wait(
            {operation_task, disconnect_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if disconnect_task in done:
            disconnected = disconnect_task.result()
            if disconnected and not operation_task.done():
                operation_task.cancel()
                with suppress(asyncio.CancelledError):
                    await operation_task
                raise HTTPException(
                    status_code=499,
                    detail="Workshop request cancelled because the client disconnected",
                )
            return await operation_task
        return await operation_task
    finally:
        if not operation_task.done():
            operation_task.cancel()
            with suppress(asyncio.CancelledError):
                await operation_task
        if not disconnect_task.done():
            disconnect_task.cancel()
        with suppress(asyncio.CancelledError):
            await disconnect_task


@router.post(
    "/projects/{project_name}/workshop/discuss",
    response_model=WorkshopDiscussResponse,
)
async def api_workshop_discuss(
    body: WorkshopDiscussRequest,
    project_dir: ProjectDep,
    request: Request,
) -> WorkshopDiscussResponse:
    """Discuss an immutable editor snapshot without project mutation.

    The route deliberately exposes no tool loop and accepts no provider
    credentials, URL, or arbitrary model request body.  Cancellation bubbles
    through a cancellation watcher so a disconnected request aborts the
    provider task instead of continuing an unnoticed model generation.
    """
    try:
        return await _await_with_disconnect(
            request, discuss_workshop(project_dir, body)
        )
    except ServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
