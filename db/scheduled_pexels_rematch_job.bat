@echo off
REM =================================================================
REM 여소남 OS - Pexels 사진 전체 재매칭 작업 (새벽 1시 예약 실행용)
REM 2026-04-21 등록 — ERR-pexels-korean-search 해결을 위한 2단 작업
REM =================================================================
REM 단계:
REM   1. Gemini 2.5 Flash 로 1,175건 영어명 번역 → aliases[0] 저장 (~5분)
REM   2. 영어 alias 우선으로 Pexels 전수 재검색 → photos 업데이트 (~6시간)
REM
REM 로그: scratch\pexels_rematch_<date>.log
REM =================================================================

cd /d "c:\Users\admin\Desktop\여소남OS"

REM 로그 파일명 (한글 date /t 은 파싱 어려움 → PowerShell 로 ISO 날짜)
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm"`) do set "LOG_TS=%%i"
set "LOG_FILE=scratch\pexels_rematch_%LOG_TS%.log"

if not exist scratch mkdir scratch

echo ================================================== > "%LOG_FILE%"
echo 작업 시작 %LOG_TS% >> "%LOG_FILE%"
echo ================================================== >> "%LOG_FILE%"

echo. >> "%LOG_FILE%"
echo [Step 1/2] Gemini 영어명 번역 >> "%LOG_FILE%"
echo ---------------------------------------------------- >> "%LOG_FILE%"
node db\translate_attractions_to_english.js --insert >> "%LOG_FILE%" 2>&1

echo. >> "%LOG_FILE%"
echo [Step 2/2] Pexels 전수 재매칭 (약 6시간, Rate limit 18s/req) >> "%LOG_FILE%"
echo ---------------------------------------------------- >> "%LOG_FILE%"
node db\rematch_pexels_photos.js --insert --delay=18 >> "%LOG_FILE%" 2>&1

echo. >> "%LOG_FILE%"
echo ================================================== >> "%LOG_FILE%"
echo 작업 완료 %DATE% %TIME% >> "%LOG_FILE%"
echo ================================================== >> "%LOG_FILE%"
