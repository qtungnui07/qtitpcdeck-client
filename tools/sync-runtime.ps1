# Copies Macro-Deck/ui/runtime/src into the client app.
# The runtime is framework-free TypeScript with no build step, so the Angular compiler consumes it
# directly. Spec files are stripped; they are not part of the app build.
param(
    [string]$MacroDeckRoot = (Join-Path $PSScriptRoot "..\..\Macro-Deck"),
    [string]$AppRoot = (Join-Path $PSScriptRoot "..")
)

$ErrorActionPreference = "Stop"

$source = Join-Path $MacroDeckRoot "ui\runtime\src"
$target = Join-Path $AppRoot "src\runtime"

if (-not (Test-Path $source)) {
    throw "Runtime source not found at $source"
}

if (Test-Path $target) {
    Remove-Item -Recurse -Force $target
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force
Get-ChildItem -Path $target -Recurse -File -Include *.spec.ts | Remove-Item -Force

$sha = (git -C $MacroDeckRoot rev-parse HEAD).Trim()
$upstream = Join-Path $target "UPSTREAM.md"
$content = Get-Content $upstream -Raw
$content = $content -replace '(?s)```\r?\n.*?\r?\n```', "``````" + "`n$sha`n" + "``````"
Set-Content -Path $upstream -Value $content -NoNewline

Write-Host "Synced runtime from $sha"
