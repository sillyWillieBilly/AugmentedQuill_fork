# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Transport models for explicit, revision-guarded content recovery."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ContentRecoverySummary(BaseModel):
    """Validated metadata for one durable content recovery pair."""

    recovery_id: str
    status: Literal["prepared", "committed"]
    document_key: str
    filename: str
    before_revision: str
    after_revision: str
    created_at: str
    committed_at: str | None = None


class ContentRecoveryDetail(ContentRecoverySummary):
    """A recovery pair including exact before and after manuscript text."""

    before_content: str
    after_content: str


class ContentRecoveryListResponse(BaseModel):
    """Response for the project recovery listing."""

    records: list[ContentRecoverySummary]


class ContentRecoveryRestoreRequest(BaseModel):
    """Explicit restore target and the caller's current checked base."""

    target: Literal["before", "after"]
    expected_revision: str = Field(min_length=1)
    expected_document_key: str = Field(min_length=1)
    expected_filename: str | None = None


class ContentRecoveryRestoreResponse(BaseModel):
    """Canonical content returned after a successful restore."""

    ok: bool
    content: str
    revision: str
    filename: str
    document_key: str
