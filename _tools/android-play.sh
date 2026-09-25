#!/data/data/com.termux/files/usr/bin/bash
# Играть: загрузить из облака -> запустить Таверну -> автосохранение каждые 15 минут -> сохранить при выходе.
source "$(dirname "${BASH_SOURCE[0]}")/android-common.sh"
AUTOSAVE_MIN=15

if server_running; then
    warn 'Таверна уже запущена. Открываю браузер.'
    termux-open-url http://127.0.0.1:8000
    exit 0
fi

load_game || warn 'Продолжаю с данными телефона.'

termux-wake-lock 2>/dev/null
cd "$ROOT" || exit 1
node server.js --browserLaunchEnabled=false &
SERVER=$!

finish() {
    trap - INT TERM EXIT
    kill "$SERVER" 2>/dev/null; wait "$SERVER" 2>/dev/null
    say 'Таверна остановлена. Сохраняю...'
    save_game 'Сохранение при выходе'
    termux-wake-unlock 2>/dev/null
    exit 0
}
trap finish INT TERM EXIT

for _ in $(seq 60); do server_running && break; sleep 1; done
termux-open-url http://127.0.0.1:8000
ok 'Таверна запущена и открыта в браузере. Не закрывайте Termux. Чтобы выйти с сохранением, вернитесь сюда и нажмите CTRL+C (кнопка CTRL на панели Termux, затем C).'

last=$(date +%s)
while kill -0 "$SERVER" 2>/dev/null; do
    sleep 20
    if [ $(( $(date +%s) - last )) -ge $((AUTOSAVE_MIN * 60)) ]; then
        save_game 'Автосохранение'
        last=$(date +%s)
    fi
done
