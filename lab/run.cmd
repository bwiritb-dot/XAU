@echo off
rem XAUG lab: данные -> сверка -> подбор -> отчёт. Запуск: двойной клик или "lab\run.cmd" из корня репозитория.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Нужен Node 20+: https://nodejs.org & pause & exit /b 1)
where python >nul 2>nul || (echo Нужен Python 3.11+: https://python.org & pause & exit /b 1)
python -m pip install -q -r requirements.txt || (pause & exit /b 1)
node fetch.mjs || (pause & exit /b 1)
node check.mjs || (pause & exit /b 1)
python optimize.py %* || (pause & exit /b 1)
python report.py || (pause & exit /b 1)
start "" report.html
