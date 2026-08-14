# -*- coding: utf-8 -*-
"""本地审核服务（FastAPI）：抓取 / 读取 / 保存 / 原文预览 / 发布到 Cloudflare。"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

from ..pipeline import build_content, clip_content

ROOT = Path(__file__).resolve().parents[4]  # 仓库根（pipeline/src/kaogong/review/ 上溯 4 层）
CONTENT = ROOT / "content"
WEB = ROOT / "apps" / "web"
UI = Path(__file__).resolve().parent / "ui" / "index.html"
LOGO = WEB / "public" / "logo.png"

# Worker 地址：默认写死，可用环境变量覆盖
PUBLIC_API_BASE = os.environ.get("PUBLIC_API_BASE", "https://kaogong-api.2667199938.workers.dev")

app = FastAPI(title="每日时政 · 本地审核")


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse(UI.read_text(encoding="utf-8"))


@app.get("/logo.png")
def logo() -> FileResponse:
    return FileResponse(LOGO)


class FetchBody(BaseModel):
    date: str = ""  # YYYY-MM-DD，空则今天


@app.post("/api/fetch")
def api_fetch(body: FetchBody) -> dict:
    target = dt.date.fromisoformat(body.date) if body.date else dt.date.today()
    digest_path = build_content(target, CONTENT)
    n_clips = clip_content(target, CONTENT)
    return {"ok": True, "date": target.isoformat(), "digest": str(digest_path), "clips": n_clips}


@app.get("/api/dates")
def api_dates() -> dict:
    dates = sorted(
        (d.name for d in CONTENT.iterdir() if (d / "digest.json").exists()),
        reverse=True,
    )
    return {"dates": dates}


@app.get("/api/digest/{date}")
def api_digest(date: str) -> dict:
    p = CONTENT / date / "digest.json"
    if not p.exists():
        raise HTTPException(404, "该日期无日报")
    return json.loads(p.read_text(encoding="utf-8"))


class DigestBody(BaseModel):
    date: str
    digest: dict


@app.post("/api/digest")
def api_save_digest(body: DigestBody) -> dict:
    p = CONTENT / body.date / "digest.json"
    p.write_text(json.dumps(body.digest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True}


@app.get("/api/article/{id}")
def api_article(id: str) -> dict:
    for d in CONTENT.iterdir():
        p = d / f"article-{id}.json"
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    raise HTTPException(404, "无该原文")


def _run(cmd: list[str], cwd: Path) -> tuple[bool, str]:
    env = dict(os.environ)
    env["PUBLIC_API_BASE"] = PUBLIC_API_BASE
    r = subprocess.run(cmd, cwd=str(cwd), env=env, capture_output=True, text=True)
    log = (r.stdout + r.stderr)[-3000:]
    return r.returncode == 0, log


@app.post("/api/publish")
def api_publish() -> dict:
    npx = "npx.cmd" if os.name == "nt" else "npx"
    ok, log = _run([npx, "astro", "build"], WEB)
    if not ok:
        return {"ok": False, "step": "构建", "log": log}
    ok, log = _run(
        [npx, "wrangler", "pages", "deploy", "dist", "--project-name", "kaogong-web", "--branch", "main"],
        WEB,
    )
    if not ok:
        return {"ok": False, "step": "部署", "log": log}
    return {"ok": True, "log": log}
