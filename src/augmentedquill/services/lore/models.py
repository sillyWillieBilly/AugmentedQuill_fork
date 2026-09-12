# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Transport and domain models for explicit, inspectable lore selection."""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class LoreStatus(str, Enum):
    """Editorial status of a lore assertion."""

    CANON = "canon"
    BELIEF = "belief"
    PROPOSAL = "proposal"


class LoreScope(BaseModel):
    """Explicit scope in which a lore entry is applicable.

    A missing field means that the entry is unrestricted at that level.  Bounds
    are inclusive and are useful for entries that become true only after a
    chapter or scene.  Viewpoint and timeline are deliberate metadata filters;
    they do not attempt to infer fictional truth.
    """

    model_config = ConfigDict(extra="allow")

    book_id: str | None = None
    chapter_id: str | int | None = None
    chapter_start: int | None = Field(None, ge=0)
    chapter_end: int | None = Field(None, ge=0)
    scene_id: str | int | None = None
    scene_start: int | None = Field(None, ge=0)
    scene_end: int | None = Field(None, ge=0)
    viewpoint: str | None = None
    timeline_id: str | None = None
    timeline_position: int | None = Field(None, ge=0)
    timeline_start: int | None = Field(None, ge=0)
    timeline_end: int | None = Field(None, ge=0)


class LoreActivation(BaseModel):
    """Deterministic subset of SillyTavern World Info activation options."""

    model_config = ConfigDict(extra="allow")

    enabled: bool = True
    constant: bool = False
    primary_keys: list[str] = Field(default_factory=list)
    secondary_keys: list[str] = Field(default_factory=list)
    selective_logic: Literal["AND_ANY", "NOT_ALL", "NOT_ANY", "AND_ALL"] = "AND_ANY"
    order: int = 100
    recursive: bool = False
    prevent_recursion: bool = False
    exclude_recursion: bool = False
    case_sensitive: bool | None = None
    match_whole_words: bool | None = None

    @field_validator("selective_logic", mode="before")
    @classmethod
    def normalize_selective_logic(cls, value: object) -> str:
        # SillyTavern serializes these values as 0..3 in some files and as
        # names in others.  Keep one stable API representation.
        if isinstance(value, int):
            return (
                ("AND_ANY", "NOT_ALL", "NOT_ANY", "AND_ALL")[value]
                if 0 <= value <= 3
                else "AND_ANY"
            )
        value_text = str(value or "AND_ANY").upper()
        aliases = {"AND": "AND_ANY", "ANY": "AND_ANY", "ALL": "AND_ALL"}
        return (
            aliases.get(value_text, value_text)
            if value_text in {"AND_ANY", "NOT_ALL", "NOT_ANY", "AND_ALL"}
            else "AND_ANY"
        )


class LoreEntry(BaseModel):
    """A native or imported lore entry exposed to the Workshop."""

    # Unknown fields are retained on API reads for native extensions.  Raw
    # SillyTavern records are additionally kept in raw_record because their
    # shape and extension paths are intentionally not normalized away.
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    kind: str = "other"
    # Records without ``_lore.status`` retain the legacy canon interpretation.
    status: LoreStatus = LoreStatus.CANON
    description: str = ""
    aliases: list[str] = Field(default_factory=list)
    relations: list[dict[str, Any]] = Field(default_factory=list)
    sources: list[Any] = Field(default_factory=list)
    scope: LoreScope = Field(default_factory=LoreScope)
    activation: LoreActivation = Field(default_factory=LoreActivation)
    belief_actor: str | None = None
    book: str | None = None
    raw_record: dict[str, Any] | None = None
    raw_fields: dict[str, Any] = Field(default_factory=dict)


class LoreEntryCreate(BaseModel):
    """Create a native Sourcebook lore entry."""

    model_config = ConfigDict(extra="allow")

    name: str = Field(..., min_length=1)
    kind: str = "other"
    # A new entry is an editorial proposal until the author explicitly
    # promotes it.  Legacy records without ``_lore.status`` continue to read
    # as canon in ``activation._status_from_metadata``.
    status: LoreStatus = LoreStatus.PROPOSAL
    description: str = ""
    aliases: list[str] = Field(default_factory=list)
    relations: list[dict[str, Any]] = Field(default_factory=list)
    sources: list[Any] = Field(default_factory=list)
    scope: LoreScope = Field(default_factory=LoreScope)
    activation: LoreActivation = Field(default_factory=LoreActivation)
    belief_actor: str | None = None


class LoreEntryUpdate(BaseModel):
    """Partial update for native lore metadata and Sourcebook content."""

    model_config = ConfigDict(extra="allow")

    name: str | None = Field(None, min_length=1)
    kind: str | None = None
    status: LoreStatus | None = None
    description: str | None = None
    aliases: list[str] | None = None
    relations: list[dict[str, Any]] | None = None
    sources: list[Any] | None = None
    scope: LoreScope | None = None
    activation: LoreActivation | None = None
    belief_actor: str | None = None


class LoreContextRequest(BaseModel):
    """Inputs for the pure context-selection service."""

    scan_text: str = ""
    scope: LoreScope = Field(default_factory=LoreScope)
    budget_tokens: int | None = Field(None, ge=1)
    include_beliefs: bool = True
    include_proposals: bool = False
    recursive: bool = False
    max_recursion_steps: int = Field(0, ge=0)


class LoreDecision(BaseModel):
    """Inspectable disposition of one candidate entry."""

    entry_id: str
    included: bool
    reason: str
    matched_primary: list[str] = Field(default_factory=list)
    matched_secondary: list[str] = Field(default_factory=list)
    estimated_tokens: int = 0
    priority: int = 0
    recursion_step: int = 0


class LoreSelectionResult(BaseModel):
    """Selected prompt material plus every relevant exclusion explanation."""

    selected: list[LoreEntry] = Field(default_factory=list)
    decisions: list[LoreDecision] = Field(default_factory=list)
    context_text: str = ""
    estimated_tokens: int = 0
    budget_tokens: int | None = None
    budget_warning: str | None = None
    warnings: list[str] = Field(default_factory=list)
    unsupported_options: list[str] = Field(default_factory=list)
