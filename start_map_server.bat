@echo off
setlocal

REM In den Ordner der BAT wechseln (funktioniert auch mit Spaces)
pushd "%~dp0" || (echo Konnte nicht in den BAT-Ordner wechseln & pause & exit /b 1)

REM Debug-Ausgabe
echo Current dir: %CD%

REM Prüfen ob npx existiert
where npx >nul 2>&1 || (echo npx nicht gefunden. Installiere Node.js oder PATH pruefen. & pause & exit /b 1)

REM Server starten
npx http-server . -p 8080 -c-1

popd
endlocal
