# Установка игры на новом ПК с нуля: Node.js, SillyTavern, Git и ваши сохранения из GitHub.
# Запуск: правой кнопкой -> «Выполнить с помощью PowerShell», или
#   powershell -ExecutionPolicy Bypass -File install-new-pc.ps1
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
$ProgressPreference = 'SilentlyContinue'
function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }
function AddPath($dir) {
    $p = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($p -notlike "*$dir*") { [Environment]::SetEnvironmentVariable('Path', ((@($p, $dir) | Where-Object { $_ }) -join ';'), 'User') }
    $env:Path = "$dir;$env:Path"
}

$Home_ = $env:USERPROFILE
$St = Join-Path $Home_ 'SillyTavern'
$tmp = Join-Path $env:TEMP 'st-setup'
New-Item -ItemType Directory -Force $tmp | Out-Null

$login = Read-Host 'Ваш логин GitHub (где лежит репозиторий eldfrieden-save)'
if (-not $login) { return }

# 1. Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Say 'Устанавливаю Node.js...' 'Cyan'
    $j = (Invoke-WebRequest https://nodejs.org/dist/index.json -UseBasicParsing).Content | ConvertFrom-Json
    $v = ($j | ForEach-Object { $_ } | Where-Object { $_.lts -ne $false } | Select-Object -First 1).version
    Invoke-WebRequest "https://nodejs.org/dist/$v/node-$v-win-x64.zip" -OutFile "$tmp\node.zip" -UseBasicParsing
    Expand-Archive "$tmp\node.zip" $tmp -Force
    Move-Item "$tmp\node-$v-win-x64" (Join-Path $Home_ 'nodejs')
    AddPath (Join-Path $Home_ 'nodejs')
}

# 2. Git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Say 'Устанавливаю Git...' 'Cyan'
    $r = Invoke-RestMethod https://api.github.com/repos/git-for-windows/git/releases/latest -UserAgent 'st-setup'
    $a = $r.assets | Where-Object { $_.name -match '^PortableGit-.*-64-bit\.7z\.exe$' } | Select-Object -First 1
    Invoke-WebRequest $a.browser_download_url -OutFile "$tmp\git.7z.exe" -UseBasicParsing
    if ((Get-AuthenticodeSignature "$tmp\git.7z.exe").Status -ne 'Valid') { throw 'Подпись установщика Git недействительна, прерываю.' }
    Start-Process "$tmp\git.7z.exe" -ArgumentList "-o`"$(Join-Path $Home_ 'git')`"", '-y' -Wait -WindowStyle Hidden
    AddPath (Join-Path $Home_ 'git\cmd')
}

# 3. SillyTavern
if (-not (Test-Path (Join-Path $St 'server.js'))) {
    Say 'Устанавливаю SillyTavern...' 'Cyan'
    $rel = Invoke-RestMethod https://api.github.com/repos/SillyTavern/SillyTavern/releases/latest -UserAgent 'st-setup'
    Invoke-WebRequest "https://github.com/SillyTavern/SillyTavern/archive/refs/tags/$($rel.tag_name).zip" -OutFile "$tmp\st.zip" -UseBasicParsing
    Expand-Archive "$tmp\st.zip" "$tmp\st" -Force
    Move-Item (Get-ChildItem "$tmp\st" -Directory | Select-Object -First 1).FullName $St
    Push-Location $St; & npm install --no-audit --no-fund --omit=dev; Pop-Location
}

# 4. Сохранения
$data = Join-Path $St 'data\default-user'
if (Test-Path (Join-Path $data '.git')) {
    Say 'Сохранения уже подключены.' 'Green'
} else {
    Say 'Скачиваю сохранения из GitHub (может открыться окно входа)...' 'Cyan'
    $clone = Join-Path $St 'data\_clone'
    Remove-Item $clone -Recurse -Force -ErrorAction SilentlyContinue
    $ErrorActionPreference = 'Continue'
    & git clone -q "https://github.com/$login/eldfrieden-save.git" $clone
    if ($LASTEXITCODE -ne 0) { Say 'Не удалось скачать сохранения. Проверьте логин и вход в GitHub.' 'Red'; return }
    $ErrorActionPreference = 'Stop'
    if (Test-Path $data) { Rename-Item $data ('default-user.old-' + (Get-Date -Format 'yyyyMMddHHmmss')) }
    Rename-Item $clone 'default-user'
}

# 5. Ярлыки
& (Join-Path $data '_tools\make-shortcuts.ps1')
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Say "Готово. Запускайте «Играть.bat» в папке $St." 'Green'
