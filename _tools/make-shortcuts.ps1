# Создаёт в корне SillyTavern bat-файлы для игры, сохранения и загрузки.
$Data = Split-Path $PSScriptRoot -Parent
$Root = Split-Path (Split-Path $Data -Parent) -Parent
$shims = [ordered]@{
    'Играть.bat'             = 'gr-play.ps1'
    'Сохранить.bat'          = 'gr-save.ps1'
    'Загрузить.bat'          = 'gr-load.ps1'
    'Подключить облако.bat'  = 'gr-cloud.ps1'
    'Восстановить резерв.bat' = 'gr-restore.ps1'
}
foreach ($name in $shims.Keys) {
    $body = "@echo off`r`nchcp 65001 >nul`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0data\default-user\_tools\$($shims[$name])`"`r`npause`r`n"
    [IO.File]::WriteAllText((Join-Path $Root $name), $body, (New-Object Text.UTF8Encoding $false))
}
Write-Host "Ярлыки созданы в $Root" -ForegroundColor Green
