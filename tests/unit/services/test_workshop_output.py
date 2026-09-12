# Copyright (C) 2026 AugmentedQuill contributors
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Tolerate harmless provider numbering while retaining replacement safety."""

import pytest

from augmentedquill.services.workshop.service import (
    WorkshopOutputError,
    _parse_alternatives,
)


def test_application_assigns_unique_ids_to_numbered_or_missing_alternatives():
    """Real providers can use numeric IDs without invalidating useful prose."""
    output = _parse_alternatives(
        [
            {"id": value, "label": "Option", "replacement": "Exact wording.\n"}
            for value in [1, None, "", "same", "same"]
        ]
    )
    assert len({item.id for item in output}) == 5
    assert all(item.replacement == "Exact wording.\n" for item in output)


@pytest.mark.parametrize(
    "replacement", [None, {"text": "rewrite"}, "<!--scene:1:end-->"]
)
def test_tolerant_ids_do_not_weaken_replacement_validation(replacement):
    """Malformed or structure-mutating replacements remain unavailable to apply."""
    with pytest.raises(WorkshopOutputError):
        _parse_alternatives([{"id": 1, "label": "Option", "replacement": replacement}])
