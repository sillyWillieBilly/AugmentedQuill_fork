# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Focused API lifecycle tests for the non-streaming Workshop route."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

from augmentedquill.api.v1.workshop import api_workshop_discuss
from augmentedquill.models.workshop import WorkshopDiscussRequest


class _DisconnectedRequest:
    async def is_disconnected(self) -> bool:
        return True


def _request() -> WorkshopDiscussRequest:
    return WorkshopDiscussRequest.model_validate(
        {
            "target": {
                "projectId": "fixture",
                "documentId": "chapter-1",
                "documentKey": "chapter:chapter-1.md",
                "scope": "chapter",
                "chapterTitle": "The harbour",
                "content": "Tide.",
                "from": 0,
                "to": 5,
                "rawFrom": 0,
                "rawTo": 5,
                "originalText": "Tide.",
                "fingerprint": "a" * 64,
            },
            "messages": [{"role": "user", "content": "Discuss this."}],
        }
    )


def test_client_disconnect_cancels_inflight_workshop_provider(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    cancelled = asyncio.Event()

    async def fake_discuss(_project_dir: Path, _body: WorkshopDiscussRequest):
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr("augmentedquill.api.v1.workshop.discuss_workshop", fake_discuss)

    async def exercise() -> None:
        with pytest.raises(HTTPException) as error:
            await api_workshop_discuss(
                _request(), tmp_path, _DisconnectedRequest()  # type: ignore[arg-type]
            )
        assert error.value.status_code == 499
        assert cancelled.is_set()

    asyncio.run(exercise())
