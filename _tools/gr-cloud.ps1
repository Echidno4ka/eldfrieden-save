# Подключить облако: вход в GitHub через браузер, создание приватного репозитория, первая выгрузка.
. (Join-Path $PSScriptRoot 'gr-common.ps1')
$ErrorActionPreference = 'Continue'
$RepoName = 'eldfrieden-save'

if (Test-Remote) {
    $url = & $Git -C $Data remote get-url origin
    Say "Облако уже подключено: $url" 'Green'
    return
}

Say 'Сейчас откроется окно входа в GitHub. Войдите в свой аккаунт и разрешите доступ.' 'Cyan'
$req = "protocol=https`nhost=github.com`n`n"
$cred = Git-Input $req @('credential', 'fill')
$token = ($cred | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
if (-not $token) { Say 'Вход не выполнен. Запустите скрипт ещё раз.' 'Red'; return }

$headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'eldfrieden-save'; Accept = 'application/vnd.github+json' }
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
try {
    $me = Invoke-RestMethod https://api.github.com/user -Headers $headers
} catch {
    Say "GitHub не принял вход: $($_.Exception.Message)" 'Red'
    Git-Input $req @('credential', 'reject') | Out-Null
    return
}
Git-Input "protocol=https`nhost=github.com`nusername=$($me.login)`npassword=$token`n`n" @('credential', 'approve') | Out-Null

$repoUrl = "https://github.com/$($me.login)/$RepoName.git"
try {
    Invoke-RestMethod "https://api.github.com/repos/$($me.login)/$RepoName" -Headers $headers | Out-Null
    Say "Репозиторий $RepoName уже есть, подключаюсь к нему." 'Cyan'
    $exists = $true
} catch {
    $body = @{ name = $RepoName; private = $true; description = 'Сохранения SillyTavern: Герой-рационал' } | ConvertTo-Json
    Invoke-RestMethod https://api.github.com/user/repos -Method Post -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json' | Out-Null
    Say "Создан приватный репозиторий $repoUrl" 'Green'
    $exists = $false
}

& $Git -C $Data remote add origin $repoUrl
if ($exists) {
    & $Git -C $Data fetch -q origin
    $remoteHasMain = & $Git -C $Data ls-remote --heads origin main
    if ($remoteHasMain) {
        Say 'В облаке уже есть сохранения. Объединяю с этим ПК...' 'Cyan'
        & $Git -C $Data pull -q --rebase origin main
    }
}
& $Git -C $Data push -q -u origin main
if ($LASTEXITCODE -eq 0) { Say 'Готово: облако подключено, данные выгружены.' 'Green' } else { Say 'Выгрузка не удалась, см. сообщение выше.' 'Red' }
