@echo off
cd /d "%~dp0"
python -c "import fastapi, uvicorn, PIL, numpy" 2>nul || pip install -r requirements.txt
start "" http://localhost:8766
python server.py 8766
pause
