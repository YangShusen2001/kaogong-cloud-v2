@echo off
chcp 65001 >nul
cd /d "D:\kaogong-cloud-v2\pipeline"
if not exist ".venv\Scripts\python.exe" (
  echo 首次运行：创建虚拟环境并安装依赖...
  python -m venv .venv
  .venv\Scripts\python.exe -m pip install -e ".[review]"
)
echo 正在启动本地审核服务（浏览器会自动打开）...
.venv\Scripts\python.exe -m kaogong.review
pause
