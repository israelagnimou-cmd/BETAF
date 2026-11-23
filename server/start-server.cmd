@echo off
set BETAF_HOST=0.0.0.0
set BETAF_PORT=3000
if not "%~1"=="" set "BETAF_DATA_DIR=%~1"
node "%~dp0server.cjs"
