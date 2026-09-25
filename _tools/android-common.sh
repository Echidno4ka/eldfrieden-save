#!/data/data/com.termux/files/usr/bin/bash
# Общие функции сохранения для Android (Termux).
DATA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$DATA/../.." && pwd)"
BACKUPS="$HOME/eldfrieden-backups"
KEEP=10

say()  { printf '\033[0;37m%s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m%s\033[0m\n' "$*"; }
warn() { printf '\033[0;33m%s\033[0m\n' "$*"; }
err()  { printf '\033[0;31m%s\033[0m\n' "$*"; }

server_running() { (exec 3<>/dev/tcp/127.0.0.1/8000) 2>/dev/null; }
has_remote() { git -C "$DATA" remote | grep -qx origin; }

backup() {
    mkdir -p "$BACKUPS"
    local file="$BACKUPS/$(date +%Y-%m-%d_%H-%M-%S)_$1.tar.gz"
    tar -czf "$file" -C "$DATA" --exclude=.git . 2>/dev/null && say "Локальный резерв: $file"
    ls -1t "$BACKUPS"/*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
}

save_game() {
    backup save
    git -C "$DATA" add -A
    if [ -n "$(git -C "$DATA" status --porcelain)" ]; then
        git -C "$DATA" commit -q -m "${1:-Сохранение} (android, $(date '+%Y-%m-%d %H:%M'))" && ok 'Изменения записаны в историю.'
    else
        say 'Новых изменений нет.'
    fi
    if has_remote; then
        say 'Выгружаю в облако...'
        if git -C "$DATA" pull -q --rebase origin main && git -C "$DATA" push -q origin main; then
            ok 'Облако обновлено.'
        else
            git -C "$DATA" rebase --abort 2>/dev/null
            warn 'Не удалось выгрузить в облако. Локально всё сохранено, попробуйте позже.'
        fi
    fi
}

load_game() {
    has_remote || { warn 'Облако не подключено.'; return 0; }
    backup before-load
    git -C "$DATA" add -A
    [ -n "$(git -C "$DATA" status --porcelain)" ] && git -C "$DATA" commit -q -m "Локальные изменения перед загрузкой (android)"
    say 'Загружаю из облака...'
    if git -C "$DATA" pull -q --rebase origin main; then
        ok 'Загружена последняя версия из облака.'
    else
        git -C "$DATA" rebase --abort 2>/dev/null
        err "Версии на телефоне и в облаке разошлись. Ничего не потеряно, резерв в $BACKUPS."
        return 1
    fi
}
