# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Transport models for the non-mutating manuscript Workshop.

The Workshop receives an immutable snapshot of the editor target.  It never
accepts a filesystem path, provider credentials, or tool definitions from the
client.  Aliases keep the REST contract friendly to the TypeScript target
shape while the Python service uses stable snake_case names.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


def _alias(name: str) -> AliasChoices:
    """Accept the Python field and its camelCase frontend spelling."""
    if not name:
        raise ValueError("alias name is required")
    camel = name.split("_")[0] + "".join(
        part[:1].upper() + part[1:] for part in name.split("_")[1:]
    )
    return AliasChoices(name, camel)


Sha256 = Annotated[str, Field(pattern=r"^[0-9a-fA-F]{64}$")]


class WorkshopTargetSnapshot(BaseModel):
    """One immutable, marker-inclusive editor snapshot and checked range."""

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        str_strip_whitespace=False,
    )

    id: str | None = Field(
        default=None,
        min_length=1,
        max_length=160,
        validation_alias=_alias("id"),
    )
    kind: Literal["selection", "sentence", "paragraph"] | None = Field(
        default=None,
        validation_alias=_alias("kind"),
    )
    project_id: str = Field(
        min_length=1,
        max_length=240,
        validation_alias=_alias("project_id"),
    )
    document_id: str = Field(
        min_length=1,
        max_length=240,
        validation_alias=_alias("document_id"),
    )
    document_key: str = Field(
        min_length=1,
        max_length=500,
        validation_alias=_alias("document_key"),
    )
    book_id: str | None = Field(
        default=None,
        max_length=240,
        validation_alias=_alias("book_id"),
    )
    scope: Literal["chapter", "story"]
    chapter_title: str = Field(
        default="",
        max_length=1000,
        validation_alias=_alias("chapter_title"),
    )
    content: str = Field(min_length=1, max_length=500_000)
    from_offset: int = Field(
        ge=0,
        validation_alias=AliasChoices("from", "fromOffset", "from_offset"),
        serialization_alias="from",
    )
    to_offset: int = Field(
        ge=0,
        validation_alias=AliasChoices("to", "toOffset", "to_offset"),
        serialization_alias="to",
    )
    raw_from: int = Field(
        ge=0,
        validation_alias=AliasChoices("rawFrom", "raw_from"),
        serialization_alias="rawFrom",
    )
    raw_to: int = Field(
        ge=0,
        validation_alias=AliasChoices("rawTo", "raw_to"),
        serialization_alias="rawTo",
    )
    original_text: str = Field(
        min_length=1,
        max_length=100_000,
        validation_alias=_alias("original_text"),
    )
    fingerprint: Sha256
    context_before: str = Field(
        default="",
        max_length=20_000,
        validation_alias=_alias("context_before"),
    )
    context_after: str = Field(
        default="",
        max_length=20_000,
        validation_alias=_alias("context_after"),
    )
    scene_id: str | None = Field(
        default=None,
        max_length=240,
        validation_alias=_alias("scene_id"),
    )
    language: str = Field(default="en", min_length=1, max_length=32)


class WorkshopMessage(BaseModel):
    """A bounded prior Workshop conversation turn.

    Assistant turns are serialized response objects on the next request, so
    their limit must be larger than the author's 8,000-character input field.
    The service still enforces an aggregate response cap before returning a
    turn, keeping this per-message allowance finite.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        str_strip_whitespace=False,
    )

    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=100_000)


class WorkshopEditorSelection(BaseModel):
    """Directional UTF-16 offsets in the marker-stripped live buffer."""

    model_config = ConfigDict(extra="forbid")

    anchor: int = Field(ge=0, strict=True)
    head: int = Field(ge=0, strict=True)


class WorkshopEditorSnapshot(BaseModel):
    """Current editor state at send time, independent of the pinned target."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    project_id: str = Field(
        min_length=1, max_length=240, validation_alias=_alias("project_id")
    )
    document_id: str = Field(
        min_length=1, max_length=240, validation_alias=_alias("document_id")
    )
    document_key: str = Field(
        min_length=1, max_length=500, validation_alias=_alias("document_key")
    )
    book_id: str | None = Field(
        default=None, max_length=240, validation_alias=_alias("book_id")
    )
    scope: Literal["chapter", "story"]
    chapter_title: str = Field(
        default="", max_length=1000, validation_alias=_alias("chapter_title")
    )
    content: str = Field(max_length=500_000)
    selection: WorkshopEditorSelection
    line_separator: Literal["\n", "\r\n", "\r"] | None = Field(
        default=None, validation_alias=_alias("line_separator")
    )
    language: str = Field(default="en", min_length=1, max_length=32)


class WorkshopInspectorMessage(BaseModel):
    """A bounded message exactly as sent to the provider for inspection."""

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        str_strip_whitespace=False,
    )

    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=100_000)


class WorkshopContextBudget(BaseModel):
    """Caller-selectable limits, each bounded by server safety caps."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    max_history_messages: int = Field(
        default=8,
        ge=0,
        le=12,
        validation_alias=_alias("max_history_messages"),
    )
    max_context_chars: int = Field(
        default=12_000,
        ge=1,
        le=30_000,
        validation_alias=_alias("max_context_chars"),
    )
    context_tokens: int | None = Field(
        default=None,
        ge=256,
        le=32_768,
        validation_alias=_alias("context_tokens"),
    )
    max_lore_entries: int = Field(
        default=12,
        ge=0,
        le=30,
        validation_alias=_alias("max_lore_entries"),
    )
    max_lore_chars: int = Field(
        default=8_000,
        ge=0,
        le=20_000,
        validation_alias=_alias("max_lore_chars"),
    )
    output_tokens: int = Field(
        default=1_024,
        ge=128,
        le=4_096,
        validation_alias=_alias("output_tokens"),
    )


class WorkshopDiscussRequest(BaseModel):
    """Request to discuss an exact manuscript target without mutating it."""

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        str_strip_whitespace=False,
    )

    target: WorkshopTargetSnapshot = Field(
        validation_alias=AliasChoices("target", "targetSnapshot", "target_snapshot")
    )
    editor_context: WorkshopEditorSnapshot | None = Field(
        default=None, validation_alias=_alias("editor_context")
    )
    messages: list[WorkshopMessage] = Field(default_factory=list, max_length=12)
    model_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=240,
        validation_alias=_alias("model_name"),
    )
    model_type: Literal["CHAT", "WRITING"] = Field(
        default="CHAT",
        validation_alias=_alias("model_type"),
    )
    author_viewpoint: str | None = Field(
        default=None,
        max_length=2_000,
        validation_alias=_alias("author_viewpoint"),
    )
    timeline: str | None = Field(
        default=None,
        max_length=1_000,
        validation_alias=_alias("timeline"),
    )
    timeline_position: int | None = Field(
        default=None,
        ge=0,
        validation_alias=_alias("timeline_position"),
    )
    budget: WorkshopContextBudget = Field(
        default_factory=WorkshopContextBudget,
        validation_alias=AliasChoices("budget", "contextBudget", "context_budget"),
    )
    lore_query: str | None = Field(
        default=None,
        max_length=1_000,
        validation_alias=_alias("lore_query"),
    )


class WorkshopAlternative(BaseModel):
    """One explicitly reviewable replacement proposal."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=160)
    label: str = Field(min_length=1, max_length=500)
    replacement: str = Field(max_length=100_000)


class WorkshopExcludedLore(BaseModel):
    """Why one candidate lore entry was omitted from the model context."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=500)
    reason: str = Field(min_length=1, max_length=500)


class WorkshopLoreDecision(BaseModel):
    """One deterministic lore selector disposition for the inspector."""

    model_config = ConfigDict(extra="forbid")

    entry_id: str = Field(min_length=1, max_length=500)
    included: bool
    reason: str = Field(min_length=1, max_length=500)
    matched_primary: list[str] = Field(default_factory=list)
    matched_secondary: list[str] = Field(default_factory=list)
    estimated_tokens: int = Field(default=0, ge=0)
    priority: int = 0
    recursion_step: int = Field(default=0, ge=0)


class WorkshopBudgetEstimate(BaseModel):
    """Character and token estimates exposed in the context inspector."""

    model_config = ConfigDict(extra="forbid")

    system_chars: int = Field(ge=0)
    history_chars: int = Field(ge=0)
    target_chars: int = Field(ge=0)
    lore_chars: int = Field(ge=0)
    total_chars: int = Field(ge=0)
    context_limit_tokens: int = Field(ge=0)
    context_budget_tokens: int = Field(ge=0)
    estimated_prompt_tokens: int = Field(ge=0)
    output_reserve_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)


class WorkshopContextInspector(BaseModel):
    """Auditable view of exactly what the provider received."""

    model_config = ConfigDict(extra="forbid")

    messages: list[WorkshopInspectorMessage]
    selected_lore: list[dict[str, Any]] = Field(default_factory=list)
    excluded_lore: list[WorkshopExcludedLore] = Field(default_factory=list)
    lore_decisions: list[WorkshopLoreDecision] = Field(default_factory=list)
    unsupported_options: list[str] = Field(default_factory=list)
    budget: WorkshopBudgetEstimate
    warnings: list[str] = Field(default_factory=list)


class WorkshopDiscussResponse(BaseModel):
    """Non-mutating Workshop result and review metadata."""

    model_config = ConfigDict(extra="forbid")

    discussion: str
    alternatives: list[WorkshopAlternative]
    target_id: str
    fingerprint: Sha256
    context: WorkshopContextInspector
