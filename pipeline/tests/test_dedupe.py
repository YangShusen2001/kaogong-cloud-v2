# -*- coding: utf-8 -*-
"""去重层单测。"""
import datetime as dt

from kaogong.dedupe import dedupe_items, is_same_event, normalize_title
from kaogong.http import IndexedLink


def test_normalize_title_strips_source_prefix():
    assert normalize_title("人民网：习近平致慰问电") == "习近平致慰问电"


def test_normalize_title_fullwidth_to_halfwidth():
    # 全角数字与冒号转半角；中文不受影响
    assert normalize_title("２０２６年：报告") == "2026年报告"


def test_normalize_title_removes_punct_and_space():
    assert normalize_title("【时政】高质量发展：新征程") == "时政高质量发展新征程"


def test_is_same_event_true_on_shared_substring():
    assert is_same_event("高质量发展是首要任务", "高质量发展是当前首要任务") is True


def test_is_same_event_false_on_unrelated():
    assert is_same_event("高质量发展是首要任务", "乡村振兴战略全面推进") is False


def test_dedupe_removes_same_url_and_near_dup_title():
    items = [
        IndexedLink(dt.date(2026, 8, 12), "人民网：高质量发展是首要任务", "u1"),
        IndexedLink(dt.date(2026, 8, 12), "高质量发展是当前首要任务", "u2"),
        IndexedLink(dt.date(2026, 8, 12), "乡村振兴战略全面推进", "u3"),
    ]
    out = dedupe_items(items)
    assert [x.url for x in out] == ["u1", "u3"]


def test_dedupe_keeps_first_on_dup_url():
    items = [
        IndexedLink(dt.date(2026, 8, 12), "短标题", "same"),
        IndexedLink(dt.date(2026, 8, 12), "更长的标题", "same"),
    ]
    out = dedupe_items(items)
    assert len(out) == 1
    assert out[0].title == "短标题"
