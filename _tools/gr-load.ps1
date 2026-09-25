. (Join-Path $PSScriptRoot 'gr-common.ps1')
if (Test-Server) {
    Say 'Таверна сейчас запущена. Закройте её перед загрузкой, иначе она перезапишет загруженные данные.' 'Red'
    return
}
try { Load-Game } catch { Say "Ошибка: $($_.Exception.Message)" 'Red' }
