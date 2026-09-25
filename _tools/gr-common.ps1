# Общие функции резервного копирования и синхронизации SillyTavern через Git.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$Data = Split-Path $PSScriptRoot -Parent
$Root = Split-Path (Split-Path $Data -Parent) -Parent
$BackupDir = Join-Path $env:USERPROFILE 'SillyTavern-Резерв'
$KeepBackups = 20

function Find-Tool($name, $fallback) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    if (Test-Path $fallback) { return $fallback }
    throw "Не найден $name. Установите его или проверьте путь $fallback."
}

$Git = Find-Tool 'git' (Join-Path $env:USERPROFILE 'git\cmd\git.exe')
$Node = Find-Tool 'node' (Join-Path $env:USERPROFILE 'nodejs\node.exe')

# Уже открытые программы (Проводник) не видят обновлённый PATH до перезахода в Windows,
# а помощнику входа GitHub нужен git в PATH. Добавляем явно.
$GitRoot = Split-Path (Split-Path $Git -Parent) -Parent
$env:Path = "$(Split-Path $Git -Parent);$GitRoot\mingw64\bin;$(Split-Path $Node -Parent);$env:Path"

# Передаёт текст в git через файл: конвейер PowerShell 5.1 искажает ввод для нативных программ.
function Git-Input([string]$text, [string[]]$gitArgs) {
    $f = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($f, $text, (New-Object Text.UTF8Encoding $false))
        $argLine = ($gitArgs | ForEach-Object { "`"$_`"" }) -join ' '
        return cmd /c "`"$Git`" $argLine < `"$f`""
    } finally { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

function Git {
    $ErrorActionPreference = 'Continue'
    $out = & $Git -C $Data @args 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' '): $($out -join "`n")" }
    return $out
}

function Test-Server {
    try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 8000); $c.Close(); return $true } catch { return $false }
}

function Test-Remote {
    $ErrorActionPreference = 'Continue'
    $r = & $Git -C $Data remote 2>$null
    return [bool]($r -contains 'origin')
}

function New-LocalBackup([string]$reason) {
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    New-Item -ItemType Directory -Force $BackupDir | Out-Null
    $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
    $zipPath = Join-Path $BackupDir "$stamp`_$reason.zip"
    $zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
    try {
        $skipped = 0
        Get-ChildItem $Data -Recurse -File -Force | Where-Object { $_.FullName -notmatch '\\\.git\\' } | ForEach-Object {
            $rel = $_.FullName.Substring($Data.Length + 1)
            try { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel) | Out-Null } catch { $skipped++ }
        }
    } finally { $zip.Dispose() }
    Get-ChildItem $BackupDir -Filter *.zip | Sort-Object Name -Descending | Select-Object -Skip $KeepBackups | Remove-Item -Force
    $note = if ($skipped) { " (пропущено занятых файлов: $skipped)" } else { '' }
    Say "Локальный резерв: $zipPath$note" 'DarkGray'
}

function Save-Game([string]$message = 'Сохранение') {
    $ErrorActionPreference = 'Continue'
    New-LocalBackup 'save'
    Git add -A | Out-Null
    $changes = & $Git -C $Data status --porcelain
    if ($changes) {
        $host_ = $env:COMPUTERNAME
        Git commit -q -m "$message ($host_, $(Get-Date -Format 'yyyy-MM-dd HH:mm'))" | Out-Null
        Say 'Изменения записаны в историю.' 'Green'
    } else {
        Say 'Новых изменений нет.' 'DarkGray'
    }
    if (Test-Remote) {
        Say 'Выгружаю в облако...'
        try {
            Git pull -q --rebase origin main | Out-Null
            Git push -q origin main | Out-Null
            Say 'Облако обновлено.' 'Green'
        } catch {
            Say "Не удалось выгрузить в облако: $($_.Exception.Message)" 'Yellow'
            Say 'Локально всё сохранено. Попробуйте позже или запустите Загрузить.bat, чтобы разобрать расхождение.' 'Yellow'
        }
    } else {
        Say 'Облако не подключено (запустите Подключить облако.bat). Сохранено только на этом ПК.' 'Yellow'
    }
}

function Load-Game {
    $ErrorActionPreference = 'Continue'
    if (-not (Test-Remote)) { Say 'Облако не подключено, загружать нечего.' 'Yellow'; return }
    New-LocalBackup 'before-load'
    Git add -A | Out-Null
    if (& $Git -C $Data status --porcelain) {
        Git commit -q -m "Локальные изменения перед загрузкой ($env:COMPUTERNAME)" | Out-Null
    }
    Say 'Загружаю из облака...'
    try {
        Git pull -q --rebase origin main | Out-Null
        Say 'Загружена последняя версия из облака.' 'Green'
    } catch {
        & $Git -C $Data rebase --abort 2>$null | Out-Null
        Say 'Версии на этом ПК и в облаке разошлись и не сливаются автоматически.' 'Red'
        Say "Ничего не потеряно: локальный резерв лежит в $BackupDir." 'Red'
        throw
    }
}
