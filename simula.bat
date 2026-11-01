@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo First-time setup: installing dependencies...
  python -m venv .venv
  if errorlevel 1 (
    echo.
    echo PYTHON WAS NOT FOUND. Please install Python from https://www.python.org/downloads/
    echo In the installer, check "Add python.exe to PATH", then run this again.
    pause
    exit /b 1
  )
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

".venv\Scripts\python.exe" run.py %*
pause

