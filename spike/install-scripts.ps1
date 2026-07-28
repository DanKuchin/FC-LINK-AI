# TENURE — copy the spike Lua scripts into the Live Editor scripts folder.
#
#   pnpm spike:install     (or: powershell -ExecutionPolicy Bypass -File spike/install-scripts.ps1)
#
# Copies into <LiveEditor>\lua\tenure\ so the Lua Engine file picker can find them.
# Nothing is placed in \lua\autorun — during the spike every script runs on purpose,
# never automatically.

param(
    [string]$LiveEditorDir = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$bridgeRoot = Join-Path $repo "bridge"
$source = Join-Path $repo "bridge\spike"

if (-not (Test-Path $source)) { throw "Cannot find $source" }

if ([string]::IsNullOrWhiteSpace($LiveEditorDir)) {
    $guesses = @(
        "C:\FC 26 Live Editor",
        (Join-Path $env:USERPROFILE "Desktop\FC 26 Live Editor"),
        "D:\FC 26 Live Editor"
    )
    $LiveEditorDir = $guesses | Where-Object { Test-Path (Join-Path $_ "version_info.json") } | Select-Object -First 1
}

if ([string]::IsNullOrWhiteSpace($LiveEditorDir)) {
    throw "Live Editor folder not found. Pass it explicitly: -LiveEditorDir 'C:\path\to\FC 26 Live Editor'"
}

$target = Join-Path $LiveEditorDir "lua\tenure"
New-Item -ItemType Directory -Force -Path $target | Out-Null

# The Lua scripts write here; Lua cannot create directories portably.
$spikeOut = Join-Path $env:LOCALAPPDATA "Tenure\spike"
New-Item -ItemType Directory -Force -Path $spikeOut | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $env:LOCALAPPDATA "Tenure\bridge") | Out-Null

$stamp = Get-Date -Format "yyyyMMdd"
New-Item -ItemType Directory -Force -Path (Join-Path $spikeOut "export_$stamp") | Out-Null

$copied = 0
Get-ChildItem $source -Filter *.lua | ForEach-Object {
    Copy-Item $_.FullName -Destination (Join-Path $target $_.Name) -Force
    Write-Host ("  copied  " + $_.Name)
    $copied++
}

# Preserve shared bridge directories so the spike and production entry point
# resolve the same transport and the same guarded offset reader.
Copy-Item (Join-Path $bridgeRoot "lib") -Destination $target -Recurse -Force
Copy-Item (Join-Path $bridgeRoot "readers") -Destination $target -Recurse -Force
Copy-Item (Join-Path $bridgeRoot "tenure_bridge.lua") -Destination (Join-Path $target "tenure_bridge.lua") -Force
Write-Host "  copied  lib\"
Write-Host "  copied  readers\"
Write-Host "  copied  tenure_bridge.lua"

Write-Host ""
Write-Host "  $copied script(s) installed to:"
Write-Host "    $target"
Write-Host "  Lua output folder (pre-created):"
Write-Host "    $spikeOut"
Write-Host ""
Write-Host "  In game: Live Editor overlay (F9) -> Features -> Lua Engine -> execute -> pick a file."
Write-Host "  Run them in order: 01, 02, 03, 04. Only then 05 / 06."
Write-Host ""
