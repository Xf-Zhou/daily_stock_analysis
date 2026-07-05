from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "deploy_server.sh"


def test_deploy_script_is_generic_and_protects_runtime_state() -> None:
    assert SCRIPT.exists(), "scripts/deploy_server.sh should exist"

    content = SCRIPT.read_text(encoding="utf-8")

    for required_env in ("DSA_DEPLOY_HOST", "DSA_DEPLOY_USER", "DSA_DEPLOY_PATH"):
        assert required_env in content
    assert "DSA_DEPLOY_SYNC_COMPOSE" in content

    for forbidden_literal in ("43.156.46.247", "dailystock.online", "dsa_deploy_codex"):
        assert forbidden_literal not in content

    for protected_pattern in (
        ".env",
        "data/*.db*",
        "data/cache/",
        "data/*.lock*",
        "data/.admin_*",
        "data/.session_secret",
        "docker/docker-compose.yml",
        "logs/",
        "reports/",
    ):
        assert protected_pattern in content

    assert "--info=stats1" not in content, "macOS rsync does not support --info=stats1"


def test_deploy_script_has_valid_bash_syntax() -> None:
    result = subprocess.run(
        ["bash", "-n", str(SCRIPT)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
