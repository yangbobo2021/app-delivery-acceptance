"""Resolve the user-selected test directory and its acceptance assets."""

import os
from pathlib import Path

DEFAULT_TEST_DIR = "tests"
ASSET_FOLDER = "delivery-acceptance"


def test_directory(project, selected=None):
    root = Path(project).resolve()
    value = selected if selected is not None else os.environ.get("DELIVERY_ACCEPTANCE_TEST_DIR", DEFAULT_TEST_DIR)
    if not str(value).strip():
        raise ValueError("test directory must not be empty")
    if any(char in str(value) for char in ("\n", "\r", "\0")):
        raise ValueError("test directory must not contain line breaks or NUL")
    candidate = Path(value).expanduser()
    directory = (candidate if candidate.is_absolute() else root / candidate).resolve()
    if ".git" in directory.parts:
        raise ValueError("test assets cannot be stored in Git metadata")
    return directory


def asset_directory(project, selected=None):
    directory = test_directory(project, selected)
    assets = (directory / ASSET_FOLDER).resolve()
    if not assets.is_relative_to(directory):
        raise ValueError("generated-asset subdirectory resolves outside the selected test directory")
    return assets
