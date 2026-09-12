# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Transport models for projects linked to external Markdown files."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ManuscriptLinkRequest(BaseModel):
    """Request an explicit source-file allowlist for an existing project."""

    source_root: str
    files: list[str] = Field(min_length=1)
    excluded: list[dict[str, Any]] = Field(default_factory=list)


class ManuscriptLinkResponse(BaseModel):
    """A lossless link manifest projection returned by the API."""

    schema_version: int
    kind: str
    source_root: str
    entries: list[dict[str, Any]]
    excluded: list[dict[str, Any]]
