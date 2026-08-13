# -*- coding: utf-8 -*-
"""候选 → DailyDigest 组装单测。"""
import datetime as dt

from kaogong.build import build_digest
from kaogong.models import Candidate


def _c(title, url, slot, date="2026-08-12", summary=""):
    return Candidate(title=title, url=url, date=dt.date.fromisoformat(date), slot=slot, summary=summary)


def test_build_groups_sections_in_order():
    cands = [
        _c("时政A", "u1", "pol"),
        _c("时评C", "u3", "shi"),
        _c("广东D", "u4", "gd"),
        _c("政策E", "u5", "gdp", summary="解读摘要"),
    ]
    d = build_digest(cands, dt.date(2026, 8, 12))
    assert [s.id for s in d.sections] == ["national", "essay", "guangdong", "guangdong-policy"]


def test_build_merges_pol_and_gov_into_national():
    d = build_digest([_c("时政A", "u1", "pol"), _c("政策B", "u2", "gov")], dt.date(2026, 8, 12))
    assert d.sections[0].id == "national"
    assert len(d.sections[0].items) == 2


def test_build_near_dup_deduped():
    cands = [
        _c("人民网：高质量发展是首要任务", "u1", "pol"),
        _c("高质量发展是当前首要任务", "u2", "gov"),
    ]
    d = build_digest(cands, dt.date(2026, 8, 12))
    assert len(d.sections[0].items) == 1


def test_build_title_date_and_weekday():
    d = build_digest([_c("x", "u1", "pol")], dt.date(2026, 8, 12))
    assert d.date == "2026-08-12"
    assert "周三" in d.title
    assert d.sections[0].items[0].date == "08-12"


def test_build_essay_dedups_by_url():
    cands = [_c("时评1", "u", "shi"), _c("时评2", "u", "qst")]
    d = build_digest(cands, dt.date(2026, 8, 12))
    assert len(d.sections[0].items) == 1  # essay 里同一 url 只留一条


def test_build_empty_candidates():
    d = build_digest([], dt.date(2026, 8, 12))
    assert d.sections == []


def test_build_roundtrip_to_json():
    d = build_digest([_c("时政A", "u1", "pol", summary="摘要")], dt.date(2026, 8, 12))
    data = d.to_json()
    item = data["sections"][0]["items"][0]
    assert item["sourceUrl"] == "u1"
    assert item["summary"] == "摘要"
