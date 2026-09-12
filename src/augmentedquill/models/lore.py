# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Public model import path for the lore service contract.

The implementation lives beside the selector in ``services.lore.models`` so
the service can be used without importing the API package.  Re-exporting the
models here keeps the repository's established ``augmentedquill.models``
surface available to route consumers and generated schema tooling.
"""

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
]
