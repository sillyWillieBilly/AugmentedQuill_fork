# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Project-scoped lore models, selection, and SillyTavern interchange."""

from augmentedquill.services.lore.activation import select_lore, select_project_lore
from augmentedquill.services.lore.models import (
    LoreActivation,
    LoreContextRequest,
    LoreDecision,
    LoreEntry,
    LoreEntryCreate,
    LoreEntryUpdate,
    LoreScope,
    LoreSelectionResult,
    LoreStatus,
)

__all__ = [
    "LoreActivation",
    "LoreContextRequest",
    "LoreDecision",
    "LoreEntry",
    "LoreEntryCreate",
    "LoreEntryUpdate",
    "LoreScope",
    "LoreSelectionResult",
    "LoreStatus",
    "select_lore",
    "select_project_lore",
]
