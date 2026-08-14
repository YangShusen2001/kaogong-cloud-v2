# -*- coding: utf-8 -*-
"""本地审核客户端入口：python -m kaogong.review。启动服务并自动开浏览器。"""
from __future__ import annotations

import sys
import threading
import webbrowser

import uvicorn


def main() -> int:
    port = 8321
    threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    uvicorn.run("kaogong.review.server:app", host="127.0.0.1", port=port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
