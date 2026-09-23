@echo off
cd /d "%~dp0.."
python tools\build_index.py
pause
