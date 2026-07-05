# -*- coding: utf-8 -*-
"""
Shared metadata constants for analysis requests.
"""

from __future__ import annotations


SELECTION_SOURCES: tuple[str, ...] = ("manual", "autocomplete", "import", "image", "discover", "candidate_pool")
SELECTION_SOURCE_PATTERN = "^(" + "|".join(SELECTION_SOURCES) + ")$"
