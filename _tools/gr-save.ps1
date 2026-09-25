. (Join-Path $PSScriptRoot 'gr-common.ps1')
try {
    Save-Game 'Ручное сохранение'
} catch {
    Say "Ошибка: $($_.Exception.Message)" 'Red'
}
