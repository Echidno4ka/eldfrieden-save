#!/data/data/com.termux/files/usr/bin/bash
source "$(dirname "${BASH_SOURCE[0]}")/android-common.sh"
if server_running; then
    err 'Таверна сейчас запущена. Закройте её (CTRL+C в окне игры), потом загружайте.'
    exit 1
fi
load_game
