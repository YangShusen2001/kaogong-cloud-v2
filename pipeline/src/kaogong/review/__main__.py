# -*- coding: utf-8 -*-
"""本地审核客户端入口：python -m kaogong.review。启动服务并自动开应用窗口。

优先用 Edge/Chrome 的 --app 模式开「无地址栏窗口」（像桌面应用，不依赖额外框架），
找不到浏览器时退回系统默认浏览器。
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import webbrowser

import uvicorn


def _find_app_browser() -> str | None:
    """找一个支持 --app 模式的 Chromium 内核浏览器（Edge / Chrome / Chromium）。"""
    for name in ("msedge", "chrome", "chromium"):
        exe = shutil.which(name)
        if exe:
            return exe
    for path in (
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ):
        if os.path.isfile(path):
            return path
    return None


def _open_app_window(url: str) -> None:
    """优先开无地址栏的应用窗口，失败退回默认浏览器。"""
    exe = _find_app_browser()
    if exe:
        try:
            subprocess.Popen([exe, f"--app={url}", "--new-window"])
            return
        except OSError:
            pass
    webbrowser.open(url)


def main() -> int:
    port = 8321
    url = f"http://127.0.0.1:{port}"
    threading.Timer(1.0, lambda: _open_app_window(url)).start()
    uvicorn.run("kaogong.review.server:app", host="127.0.0.1", port=port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
