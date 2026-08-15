# -*- coding: utf-8 -*-
import json
from pathlib import Path

import kaogong.__main__ as cli


def test_main_emits_json_completion_event_and_fails_quality_gate(tmp_path, monkeypatch, capsys):
    # Given: pipeline stages complete but the quality gate fails.
    digest = tmp_path / "2026-08-12" / "digest.json"
    monkeypatch.setattr(cli, "build_content", lambda target, content_dir: digest)
    monkeypatch.setattr(cli, "clip_content", lambda target, content_dir: 0)
    monkeypatch.setattr(cli, "practice_content", lambda target, content_dir: None)
    monkeypatch.setattr(cli, "quality_gate", lambda target, content_dir: {"qualityStatus": "failed"})

    # When: the CLI executes through its real main boundary.
    exit_code = cli.main(["2026-08-12", "--content-dir", str(tmp_path)])

    # Then: automation receives structured completion and a nonzero exit code.
    event = json.loads(capsys.readouterr().out)
    assert exit_code == 1
    assert event == {
        "event": "pipeline.complete",
        "date": "2026-08-12",
        "digest": str(digest),
        "articles": 0,
        "practice": None,
        "qualityStatus": "failed",
    }
