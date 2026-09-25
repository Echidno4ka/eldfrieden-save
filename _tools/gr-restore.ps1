# Восстановить данные из локального резерва (zip).
. (Join-Path $PSScriptRoot 'gr-common.ps1')
if (Test-Server) { Say 'Сначала закройте Таверну.' 'Red'; return }
$zips = @(Get-ChildItem $BackupDir -Filter *.zip -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
if (-not $zips.Count) { Say "Резервов нет в $BackupDir." 'Yellow'; return }
Say 'Доступные резервы (новые сверху):' 'Cyan'
for ($i = 0; $i -lt $zips.Count; $i++) { Say ("  {0,2}. {1}" -f ($i + 1), $zips[$i].BaseName) }
$pick = Read-Host 'Номер резерва для восстановления (Enter — отмена)'
if (-not $pick) { return }
$zip = $zips[[int]$pick - 1]
if (-not $zip) { Say 'Нет такого номера.' 'Red'; return }
New-LocalBackup 'before-restore'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zip.FullName)
try {
    foreach ($e in $archive.Entries) {
        if (-not $e.Name) { continue }
        $dest = Join-Path $Data $e.FullName
        New-Item -ItemType Directory -Force (Split-Path $dest -Parent) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
    }
} finally { $archive.Dispose() }
Say "Восстановлено из $($zip.Name). Файлы, созданные после этого резерва, не удалены." 'Green'
