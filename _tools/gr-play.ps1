# Играть: загрузить из облака -> запустить Таверну -> автосохранение каждые 15 минут -> сохранить при выходе.
. (Join-Path $PSScriptRoot 'gr-common.ps1')
$AutosaveMinutes = 15

if (Test-Server) {
    Say 'Таверна уже запущена. Откройте http://127.0.0.1:8000 в браузере.' 'Yellow'
    return
}

try { Load-Game } catch { Say 'Продолжаю с локальными данными.' 'Yellow' }

Say 'Запускаю Таверну... Не закрывайте это окно. Чтобы выйти с сохранением, нажмите здесь Ctrl+C.' 'Cyan'
$server = Start-Process $Node -ArgumentList 'server.js' -WorkingDirectory $Root -NoNewWindow -PassThru
$last = Get-Date
try {
    while (-not $server.HasExited) {
        Start-Sleep -Seconds 20
        if (((Get-Date) - $last).TotalMinutes -ge $AutosaveMinutes) {
            try { Save-Game 'Автосохранение' } catch { Say "Автосохранение не удалось: $($_.Exception.Message)" 'Yellow' }
            $last = Get-Date
        }
    }
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    Say 'Таверна остановлена. Сохраняю...' 'Cyan'
    try { Save-Game 'Сохранение при выходе' } catch { Say "Ошибка сохранения: $($_.Exception.Message)" 'Red' }
    Start-Sleep -Seconds 3
}
