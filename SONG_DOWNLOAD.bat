@echo off
setlocal enabledelayedexpansion
title NewMusic Downloader

:: This variable remembers the last artist you typed
set "lastArtist="

:START
cls
echo ==================================================
echo         NewMusic yt-dlp Downloader Tool
echo ==================================================
echo.
:: 1. Get the YouTube URL
set "ytUrl="
set /p ytUrl="1. Enter YouTube URL: "

:: 2. Get the Song Name
set "songName="
set /p songName="2. Enter Song title: "

:ASK_ARTIST
:: 3. Get the Artist (Folder Name) with Memory
set "artistInput="
if "!lastArtist!"=="" (
    set /p artistInput="3. Enter Artist folder name: "
) else (
    set /p artistInput="3. Enter Artist folder name [Press Enter to keep '!lastArtist!']: "
)

:: If you just pressed Enter, use the saved artist. Otherwise, update it.
if "!artistInput!"=="" (
    set "artistFolder=!lastArtist!"
) else (
    set "artistFolder=!artistInput!"
    set "lastArtist=!artistInput!"
)

:: 4. Verify if the Artist Folder exists
set "artistBaseDir=%~dp0assets\!artistFolder!"
if not exist "!artistBaseDir!" (
    echo.
    echo [!] The artist folder "!artistFolder!" does not exist in your assets.
    set "createNew="
    set /p createNew="    Do you want to create a new artist folder? (Y/N): "
    
    :: If the answer is NOT "Y" or "y", loop back to asking for the artist
    if /I not "!createNew!"=="Y" (
        echo    Okay, let's try entering the artist again.
        echo.
        goto ASK_ARTIST
    )
)

:: 5. Convert Song Name to a slug (replace spaces with _, make lowercase)
set "slug=!songName: =_!"
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$raw = '!slug!'; $raw.ToLower()"`) do set "slug=%%I"

:: 6. Define target directory safely (USING RELATIVE PATHS)
set "targetDir=!artistBaseDir!\songs"
if not exist "!targetDir!" (
    mkdir "!targetDir!"
)

echo.
echo --------------------------------------------------
echo Ready to download!
echo URL  : !ytUrl!
echo PATH : !targetDir!
echo FILE : !slug!.wav
echo --------------------------------------------------
echo.
:: 7. Execute yt-dlp (USING RELATIVE PATH)
"%~dp0yt-dlp.exe" -f bestaudio --extract-audio --audio-format wav -o "!targetDir!\!slug!.%%(ext)s" "!ytUrl!"

echo.
echo ==================================================
echo Download Complete!
echo ==================================================
echo Press any key to download another song, or close this window to exit.
pause >nul
goto START