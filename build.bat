@echo off
setlocal
where mvn >nul 2>nul
if errorlevel 1 (
  echo Maven was not found. Install Maven 3.8+ and JDK 11+, then run this script again.
  pause
  exit /b 1
)
call mvn clean package
if errorlevel 1 exit /b %errorlevel%
echo.
echo Built: target\LabSync.war
pause
