# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Focused invariants for the non-mutating Workshop service."""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from pydantic import ValidationError

from augmentedquill.models.workshop import (
    WorkshopContextBudget,
    WorkshopDiscussRequest,
    WorkshopMessage,
)
from augmentedquill.services.exceptions import BadRequestError, ConfigurationError
from augmentedquill.services.lore.storage import write_world_info
from augmentedquill.services.workshop.context import build_workshop_prompt
from augmentedquill.services.workshop.readonly import (
    load_story_json_readonly,
    select_lore,
)
from augmentedquill.services.workshop.service import (
    WorkshopOutputError,
    WorkshopTargetConflict,
    _workshop_timeout_seconds,
    discuss_workshop,
)


def _utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def _utf16_offset(value: str, index: int) -> int:
    return _utf16_length(value[:index])


def _request(
    *,
    project_id: str = "fixture",
    content: str = "🌊 Cafe\u0301. 潮水升起。",
    original: str = "潮水升起。",
    from_offset: int | None = None,
    to_offset: int | None = None,
    raw_from: int | None = None,
    raw_to: int | None = None,
    **extra: Any,
) -> WorkshopDiscussRequest:
    start = (
        _utf16_offset(content, content.index("潮"))
        if from_offset is None
        else from_offset
    )
    end = _utf16_length(content) if to_offset is None else to_offset
    raw_start = start if raw_from is None else raw_from
    raw_end = end if raw_to is None else raw_to
    fingerprint = hashlib.sha256(content.encode("utf-8")).hexdigest()
    target: dict[str, Any] = {
        "id": "target-1",
        "projectId": project_id,
        "documentId": "chapter-1",
        "documentKey": "chapter:chapter-1.md",
        "kind": "sentence",
        "scope": "chapter",
        "chapterTitle": "The harbour",
        "content": content,
        "from": start,
        "to": end,
        "rawFrom": raw_start,
        "rawTo": raw_end,
        "originalText": original,
        "fingerprint": fingerprint,
        "contextBefore": "Before.",
        "contextAfter": "After.",
        "sceneId": "scene-1",
        "language": "en",
    }
    target.update(extra.pop("target", {}))
    payload: dict[str, Any] = {
        "target": target,
        "messages": [{"role": "user", "content": "Suggest two options."}],
    }
    payload.update(extra)
    return WorkshopDiscussRequest.model_validate(payload)


def _project(tmp_path: Path) -> Path:
    project = tmp_path / "fixture"
    project.mkdir()
    (project / "story.json").write_text(
        json.dumps(
            {
                "metadata": {"version": 1},
                "project_title": "Tide",
                "story_summary": "A traveller listens to the sea.",
                "tags": ["quiet", "coastal"],
                "sourcebook": {
                    "Sea": {
                        "description": "A dangerous sea.",
                        "synonyms": ["tide"],
                        "_lore": {
                            "scope": {"timeline_start": 10, "timeline_end": 20},
                            "activation": {"constant": True},
                        },
                        "unknown_nested": {"keep": ["this", "field"]},
                    },
                    "Inland": {
                        "description": "Far from the water.",
                        "_lore": {
                            "scope": {"timeline_start": 30, "timeline_end": 40},
                            "activation": {"constant": True},
                        },
                    },
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (project / "chapter-1.md").write_text("disk prose", encoding="utf-8")
    return project


def _fake_credentials(*_args: Any, **_kwargs: Any) -> tuple[str, None, str, int, str]:
    return "http://fake/v1", None, "fixture-model", 30, "fixture"


def _fake_machine() -> dict[str, Any]:
    return {"openai": {"models": [{"name": "fixture", "context_length": 4096}]}}


def _run(
    project: Path,
    request: WorkshopDiscussRequest,
    result: dict[str, Any],
    *,
    machine: dict[str, Any] | None = None,
):
    fake_complete = AsyncMock(return_value=result)
    machine_loader = _fake_machine if machine is None else lambda: machine
    with (
        patch(
            "augmentedquill.services.workshop.service.resolve_openai_credentials",
            side_effect=_fake_credentials,
        ),
        patch(
            "augmentedquill.services.workshop.service.load_machine_config",
            side_effect=machine_loader,
        ),
        patch(
            "augmentedquill.services.workshop.service.load_model_prompt_overrides",
            return_value={},
        ),
        patch(
            "augmentedquill.services.workshop.service.llm.unified_chat_complete",
            fake_complete,
        ),
    ):
        response = asyncio.run(discuss_workshop(project, request))
    return response, fake_complete


def test_discussion_is_read_only_and_returns_two_alternatives(tmp_path: Path):
    project = _project(tmp_path)
    before = {
        path.relative_to(project): path.read_bytes()
        for path in project.rglob("*")
        if path.is_file()
    }
    request = _request(loreQuery="tide", timelinePosition=15)
    result = {
        "content": json.dumps(
            {
                "discussion": "The sentence can make the tide more active.",
                "alternatives": [
                    {"id": "clear", "label": "Clear", "replacement": "The tide rose."},
                    {
                        "id": "poetic",
                        "label": "Poetic",
                        "replacement": "The tide lifted its dark voice.",
                    },
                ],
            }
        ),
        "tool_calls": [],
    }
    response, fake_complete = _run(project, request, result)
    after = {
        path.relative_to(project): path.read_bytes()
        for path in project.rglob("*")
        if path.is_file()
    }

    assert before == after
    assert [item.id for item in response.alternatives] == ["clear", "poetic"]
    assert response.target_id == "target-1"
    assert response.fingerprint == request.target.fingerprint.lower()
    assert response.context.messages[0].role == "system"
    assert response.context.messages == [
        type(response.context.messages[0]).model_validate(message)
        for message in fake_complete.await_args.kwargs["messages"]
    ]
    assert response.context.selected_lore[0]["unknown_nested"] == {
        "keep": ["this", "field"]
    }
    assert any(
        decision.entry_id == "sourcebook:Sea" and decision.included
        for decision in response.context.lore_decisions
    )
    assert any(
        decision.entry_id == "sourcebook:Inland" and decision.reason == "scope_excluded"
        for decision in response.context.lore_decisions
    )
    assert fake_complete.await_args.kwargs["tools"] is None
    assert fake_complete.await_args.kwargs["supports_function_calling"] is False
    assert fake_complete.await_args.kwargs["tool_choice"] is None


def test_target_rejects_fingerprint_and_unicode_anchor_mismatch(tmp_path: Path):
    project = _project(tmp_path)
    request = _request(target={"fingerprint": "0" * 64})
    with pytest.raises(WorkshopTargetConflict, match="fingerprint"):
        asyncio.run(discuss_workshop(project, request))

    request = _request(from_offset=1, to_offset=3, original="🌊")
    with pytest.raises(WorkshopTargetConflict, match="UTF-16"):
        asyncio.run(discuss_workshop(project, request))


def test_marker_wrapped_target_uses_raw_and_visible_offsets(tmp_path: Path):
    project = _project(tmp_path)
    content = "<!--scene:s:start-->Wait here.<!--scene:s:end-->"
    marker = "<!--scene:s:start-->"
    start = len("Wait here.") * 0 + _utf16_length(marker)
    request = _request(
        content=content,
        original="Wait here.",
        from_offset=0,
        to_offset=_utf16_length("Wait here."),
        raw_from=start,
        raw_to=start + _utf16_length("Wait here."),
        target={"sceneId": "s"},
    )
    result = {"content": '{"discussion":"ok","alternatives":[]}', "tool_calls": []}
    response, _ = _run(project, request, result)
    assert response.context.messages[-1].content.find("Wait here.") >= 0


def test_lore_decisions_and_unsupported_options_are_inspectable(tmp_path: Path):
    project = _project(tmp_path)
    write_world_info(
        project,
        "Imported",
        {
            "name": "Imported",
            "entries": {
                "7": {
                    "uid": 7,
                    "key": ["tide"],
                    "content": "Imported tide context.",
                    "probability": 0.5,
                }
            },
        },
    )
    request = _request(loreQuery="tide", timelinePosition=15)
    response, _ = _run(
        project,
        request,
        {"content": '{"discussion":"ok","alternatives":[]}', "tool_calls": []},
    )

    imported_id = "world-info:Imported:7"
    assert any(
        decision.entry_id == imported_id and decision.included
        for decision in response.context.lore_decisions
    )
    assert "Imported:7:probability" in response.context.unsupported_options
    assert response.context.selected_lore[-1]["probability"] == 0.5


def test_budget_rejects_unbounded_or_too_small_output():
    with pytest.raises(ValidationError):
        _request(budget={"contextTokens": 10})
    with pytest.raises(ValidationError):
        _request(budget={"outputTokens": 5_000})


def test_history_allows_bounded_serialized_assistant_turns():
    request = _request(messages=[{"role": "assistant", "content": "x" * 9_000}])
    assert len(request.messages[0].content) == 9_000
    with pytest.raises(ValidationError):
        WorkshopMessage(role="assistant", content="x" * 100_001)


def test_model_output_rejects_an_oversized_serialized_turn(tmp_path: Path):
    project = _project(tmp_path)
    request = _request()
    result = {
        "content": json.dumps(
            {
                "discussion": "d" * 99_000,
                "alternatives": [{"id": "a", "label": "A", "replacement": "r" * 2_000}],
            }
        ),
        "tool_calls": [],
    }
    with pytest.raises(WorkshopOutputError, match="too large"):
        _run(project, request, result)


def test_budget_rejects_output_reserve_larger_than_model_context(tmp_path: Path):
    project = _project(tmp_path)
    request = _request(budget={"outputTokens": 512})
    with pytest.raises(BadRequestError, match="context window"):
        _run(
            project,
            request,
            {"content": '{"discussion":"ok","alternatives":[]}'},
            machine={
                "openai": {"models": [{"name": "fixture", "context_length": 512}]}
            },
        )


def test_model_tool_call_and_provider_failure_are_safe(tmp_path: Path):
    project = _project(tmp_path)
    request = _request()
    with pytest.raises(WorkshopOutputError, match="not permitted"):
        _run(
            project,
            request,
            {"content": "{}", "tool_calls": [{"function": {"name": "write"}}]},
        )
    with pytest.raises(WorkshopOutputError, match="not permitted"):
        _run(
            project,
            request,
            {
                "content": '{"discussion":"ok","alternatives":[]}',
                "tool_calls": [],
                "raw": {
                    "choices": [
                        {"message": {"tool_calls": [{"function": {"name": "write"}}]}}
                    ]
                },
            },
        )

    failing = AsyncMock(side_effect=RuntimeError("provider offline"))
    with (
        patch(
            "augmentedquill.services.workshop.service.resolve_openai_credentials",
            side_effect=_fake_credentials,
        ),
        patch(
            "augmentedquill.services.workshop.service.load_machine_config",
            side_effect=_fake_machine,
        ),
        patch(
            "augmentedquill.services.workshop.service.load_model_prompt_overrides",
            return_value={},
        ),
        patch(
            "augmentedquill.services.workshop.service.llm.unified_chat_complete",
            failing,
        ),
        pytest.raises(WorkshopOutputError, match="request failed"),
    ):
        asyncio.run(discuss_workshop(project, request))


def test_provider_overall_timeout_cancels_never_completing_provider(
    tmp_path: Path,
):
    project = _project(tmp_path)
    request = _request()
    cancelled = asyncio.Event()

    async def never_completes(**_kwargs: Any) -> dict[str, Any]:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    with (
        patch(
            "augmentedquill.services.workshop.service.resolve_openai_credentials",
            return_value=("http://fake/v1", None, "fixture-model", 0.01, "fixture"),
        ),
        patch(
            "augmentedquill.services.workshop.service.load_machine_config",
            side_effect=_fake_machine,
        ),
        patch(
            "augmentedquill.services.workshop.service.load_model_prompt_overrides",
            return_value={},
        ),
        patch(
            "augmentedquill.services.workshop.service.llm.unified_chat_complete",
            side_effect=never_completes,
        ) as complete,
        pytest.raises(WorkshopOutputError, match="timed out after 0.01 seconds"),
    ):
        asyncio.run(discuss_workshop(project, request))

    assert cancelled.is_set()
    assert complete.await_args.kwargs["timeout_s"] == 0.01


@pytest.mark.parametrize("configured", [None, "", 0, -1, float("inf"), True])
def test_invalid_workshop_timeout_uses_finite_default(configured: Any):
    assert _workshop_timeout_seconds(configured) == 60.0


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        (httpx.ConnectError("provider offline"), "connection failed"),
        (
            httpx.HTTPStatusError(
                "provider body must not escape",
                request=httpx.Request("POST", "http://fake/v1/chat/completions"),
                response=httpx.Response(
                    503,
                    request=httpx.Request("POST", "http://fake/v1/chat/completions"),
                    content=b"secret provider response",
                ),
            ),
            "HTTP status 503",
        ),
    ],
)
def test_provider_failures_use_safe_connection_or_http_categories(
    tmp_path: Path,
    failure: Exception,
    message: str,
):
    project = _project(tmp_path)
    request = _request()
    failing = AsyncMock(side_effect=failure)
    with (
        patch(
            "augmentedquill.services.workshop.service.resolve_openai_credentials",
            side_effect=_fake_credentials,
        ),
        patch(
            "augmentedquill.services.workshop.service.load_machine_config",
            side_effect=_fake_machine,
        ),
        patch(
            "augmentedquill.services.workshop.service.load_model_prompt_overrides",
            return_value={},
        ),
        patch(
            "augmentedquill.services.workshop.service.llm.unified_chat_complete",
            failing,
        ),
        pytest.raises(WorkshopOutputError, match=message) as raised,
    ):
        asyncio.run(discuss_workshop(project, request))

    assert "secret provider response" not in str(raised.value)
    assert "provider offline" not in str(raised.value)


def test_provider_configuration_error_is_preserved(tmp_path: Path):
    project = _project(tmp_path)
    request = _request()
    config_error = ConfigurationError("selected Workshop model is unavailable")
    failing = AsyncMock(side_effect=config_error)
    with (
        patch(
            "augmentedquill.services.workshop.service.resolve_openai_credentials",
            side_effect=_fake_credentials,
        ),
        patch(
            "augmentedquill.services.workshop.service.load_machine_config",
            side_effect=_fake_machine,
        ),
        patch(
            "augmentedquill.services.workshop.service.load_model_prompt_overrides",
            return_value={},
        ),
        patch(
            "augmentedquill.services.workshop.service.llm.unified_chat_complete",
            failing,
        ),
        pytest.raises(
            ConfigurationError, match="selected Workshop model is unavailable"
        ),
    ):
        asyncio.run(discuss_workshop(project, request))


def test_provider_cancellation_is_not_converted_to_a_project_mutation(tmp_path: Path):
    project = _project(tmp_path)
    request = _request()
    cancelled = AsyncMock(side_effect=asyncio.CancelledError())
    with (
        patch(
            "augmentedquill.services.workshop.service.resolve_openai_credentials",
            side_effect=_fake_credentials,
        ),
        patch(
            "augmentedquill.services.workshop.service.load_machine_config",
            side_effect=_fake_machine,
        ),
        patch(
            "augmentedquill.services.workshop.service.load_model_prompt_overrides",
            return_value={},
        ),
        patch(
            "augmentedquill.services.workshop.service.llm.unified_chat_complete",
            cancelled,
        ),
        pytest.raises(asyncio.CancelledError),
    ):
        asyncio.run(discuss_workshop(project, request))


def test_lore_scan_includes_nearby_target_prose(tmp_path: Path):
    project = _project(tmp_path)
    story_path = project / "story.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["sourcebook"]["Mara"] = {
        "description": "Mara knows the harbour route.",
        "_lore": {"activation": {"primary_keys": ["Mara", "harbour"]}},
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")
    request = _request(
        original="She waited.",
        target={
            "contextBefore": "Mara crossed the harbour before dawn.",
            "contextAfter": "The harbour fell silent.",
        },
    )

    selection = select_lore(
        project,
        story,
        request.target,
        query=None,
        budget=request.budget,
        viewpoint=None,
        timeline=None,
        timeline_position=None,
    )

    assert any(item.get("name") == "Mara" for item in selection.selected)
    assert any(
        decision.entry_id == "sourcebook:Mara" and decision.included
        for decision in selection.decisions
    )


def test_lore_scope_preserves_opaque_document_ids(tmp_path: Path):
    project = _project(tmp_path)
    story_path = project / "story.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["sourcebook"] = {
        "Opaque": {
            "description": "The opaque chapter fact.",
            "_lore": {
                "scope": {"chapter_id": "chapter-2"},
                "activation": {"constant": True},
            },
        },
        "Numeric": {
            "description": "A different chapter fact.",
            "_lore": {
                "scope": {"chapter_id": "2"},
                "activation": {"constant": True},
            },
        },
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")
    request = _request(target={"documentId": "chapter-2"})

    selection = select_lore(
        project,
        story,
        request.target,
        query=None,
        budget=request.budget,
        viewpoint=None,
        timeline=None,
        timeline_position=None,
    )

    assert [item["name"] for item in selection.selected] == ["Opaque"]
    assert any(
        decision.entry_id == "sourcebook:Numeric"
        and decision.reason == "scope_excluded"
        for decision in selection.decisions
    )


def test_lore_caps_update_decisions_to_actual_sent_entries(tmp_path: Path):
    project = _project(tmp_path)
    story_path = project / "story.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["sourcebook"] = {
        name: {
            "description": f"{name} anchor context.",
            "_lore": {"activation": {"primary_keys": ["anchor"]}},
        }
        for name in ("Alpha", "Beta")
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")
    request = _request(original="anchor.", target={"contextBefore": ""})
    budget = request.budget.model_copy(update={"max_lore_entries": 1})

    selection = select_lore(
        project,
        story,
        request.target,
        query=None,
        budget=budget,
        viewpoint=None,
        timeline=None,
        timeline_position=None,
    )

    assert [item["name"] for item in selection.selected] == ["Alpha"]
    beta = next(
        decision
        for decision in selection.decisions
        if decision.entry_id == "sourcebook:Beta"
    )
    assert not beta.included
    assert beta.reason == "entry_budget"
    assert any(
        item.id == "sourcebook:Beta" and item.reason == "entry_budget"
        for item in selection.excluded
    )


def test_constant_lore_overflow_is_reported_instead_of_silently_dropped(
    tmp_path: Path,
):
    project = _project(tmp_path)
    story_path = project / "story.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["sourcebook"] = {
        "Constant": {
            "description": "A constant fact that cannot fit the tiny lore cap.",
            "_lore": {"activation": {"constant": True}},
        }
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")
    request = _request()
    budget = request.budget.model_copy(update={"max_lore_chars": 10})

    with pytest.raises(BadRequestError, match="Constant lore entry"):
        select_lore(
            project,
            story,
            request.target,
            query=None,
            budget=budget,
            viewpoint=None,
            timeline=None,
            timeline_position=None,
        )


def test_exact_target_and_lore_json_are_never_clipped(tmp_path: Path):
    project = _project(tmp_path)
    request = _request(
        original="潮水升起。",
        target={
            "contextBefore": "A very long neighboring passage. " * 80,
            "contextAfter": "Another very long neighboring passage. " * 80,
        },
    )
    budget = WorkshopContextBudget(
        max_context_chars=550,
        context_tokens=512,
        max_lore_chars=0,
        output_tokens=128,
    )

    prompt = build_workshop_prompt(
        target=request.target,
        story=load_story_json_readonly(project),
        machine=_fake_machine(),
        selected_model_name="fixture",
        model_overrides={},
        history=request.messages,
        author_viewpoint=None,
        timeline=None,
        timeline_position=None,
        lore_query=None,
        project_dir=project,
        budget=budget,
    )
    target_message = prompt.messages[-1]["content"]
    lore_payload = json.dumps(
        prompt.lore.selected,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    assert "Selected passage (exact):\n潮水升起。" in target_message
    assert f"Selected lore (read-only):\n{lore_payload}" in target_message
    assert prompt.inspector_messages[-1].content == target_message
    assert prompt.budget.estimated_prompt_tokens <= prompt.budget.context_budget_tokens
    assert (
        prompt.budget.estimated_prompt_tokens + prompt.budget.output_reserve_tokens
        <= prompt.budget.context_limit_tokens
    )


def test_exact_target_rejects_too_small_character_cap(tmp_path: Path):
    project = _project(tmp_path)
    request = _request(budget={"maxContextChars": 100})

    with pytest.raises(BadRequestError, match="max_context_chars"):
        build_workshop_prompt(
            target=request.target,
            story=load_story_json_readonly(project),
            machine=_fake_machine(),
            selected_model_name="fixture",
            model_overrides={},
            history=[],
            author_viewpoint=None,
            timeline=None,
            timeline_position=None,
            lore_query=None,
            project_dir=project,
            budget=request.budget,
        )


def test_system_instructions_are_never_clipped_to_fit(tmp_path: Path):
    project = _project(tmp_path)
    request = _request(
        budget={"contextTokens": 512, "maxLoreChars": 0, "outputTokens": 128}
    )
    override = "Complete safety instruction. " * 100

    with pytest.raises(BadRequestError, match="complete Workshop system instructions"):
        build_workshop_prompt(
            target=request.target,
            story=load_story_json_readonly(project),
            machine=_fake_machine(),
            selected_model_name="fixture",
            model_overrides={"workshop_discussion": override},
            history=[],
            author_viewpoint=None,
            timeline=None,
            timeline_position=None,
            lore_query=None,
            project_dir=project,
            budget=request.budget,
        )


def test_canonical_large_model_context_is_reported_with_bounded_workshop_budget(
    tmp_path: Path,
):
    project = _project(tmp_path)
    request = _request(
        budget={"contextTokens": 512, "maxLoreChars": 0, "outputTokens": 128}
    )

    prompt = build_workshop_prompt(
        target=request.target,
        story=load_story_json_readonly(project),
        machine={
            "openai": {
                "models": [{"name": "fixture", "context_window_tokens": 1_000_000}]
            }
        },
        selected_model_name="fixture",
        model_overrides={},
        history=request.messages,
        author_viewpoint=None,
        timeline=None,
        timeline_position=None,
        lore_query=None,
        project_dir=project,
        budget=request.budget,
    )

    assert prompt.budget.context_limit_tokens == 1_000_000
    assert prompt.budget.context_budget_tokens == 512
    assert prompt.budget.estimated_prompt_tokens <= 512
    assert any("input allocation capped" in warning for warning in prompt.warnings)

    uncapped_request = _request(budget={"maxLoreChars": 0, "outputTokens": 128})
    uncapped_prompt = build_workshop_prompt(
        target=uncapped_request.target,
        story=load_story_json_readonly(project),
        machine={
            "openai": {
                "models": [{"name": "fixture", "context_window_tokens": 1_000_000}]
            }
        },
        selected_model_name="fixture",
        model_overrides={},
        history=[],
        author_viewpoint=None,
        timeline=None,
        timeline_position=None,
        lore_query=None,
        project_dir=project,
        budget=uncapped_request.budget,
    )
    assert uncapped_prompt.budget.context_limit_tokens == 1_000_000
    assert uncapped_prompt.budget.context_budget_tokens == 32_768
    assert any(
        "input allocation capped" in warning for warning in uncapped_prompt.warnings
    )
