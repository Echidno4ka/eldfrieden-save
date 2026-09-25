#!/data/data/com.termux/files/usr/bin/bash
# Установка на Android (Termux). Запускается из склонированных сохранений:
#   bash ~/eldfrieden-save/_tools/android-setup.sh
set -e
ST_VERSION="1.19.0"   # та же версия, что на ПК
SAVES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ST="$HOME/SillyTavern"

echo '== Устанавливаю Node.js и инструменты =='
pkg install -y nodejs-lts termux-tools

if [ ! -f "$ST/server.js" ]; then
    echo "== Скачиваю SillyTavern $ST_VERSION =="
    git clone -q --depth 1 --branch "$ST_VERSION" https://github.com/SillyTavern/SillyTavern "$ST"
fi
echo '== Устанавливаю зависимости SillyTavern (несколько минут) =='
cd "$ST" && npm install --no-audit --no-fund --omit=dev

if [ "$SAVES" != "$ST/data/default-user" ]; then
    echo '== Переношу сохранения =='
    mkdir -p "$ST/data"
    [ -d "$ST/data/default-user" ] && mv "$ST/data/default-user" "$ST/data/default-user.old-$(date +%s)"
    mv "$SAVES" "$ST/data/default-user"
fi

DATA="$ST/data/default-user"
git -C "$DATA" config user.name 'katolinthyss'
git -C "$DATA" config user.email 'katolinthyss@gmail.com'
git -C "$DATA" config core.quotepath off
chmod +x "$DATA"/_tools/*.sh

echo '== Добавляю команды играть / сохранить / загрузить =='
sed -i '/# eldfrieden-save$/d' "$HOME/.bashrc" 2>/dev/null || true
cat >> "$HOME/.bashrc" <<EOF
alias играть='bash $DATA/_tools/android-play.sh' # eldfrieden-save
alias сохранить='bash $DATA/_tools/android-save.sh' # eldfrieden-save
alias загрузить='bash $DATA/_tools/android-load.sh' # eldfrieden-save
alias play='bash $DATA/_tools/android-play.sh' # eldfrieden-save
alias save='bash $DATA/_tools/android-save.sh' # eldfrieden-save
alias load='bash $DATA/_tools/android-load.sh' # eldfrieden-save
EOF

echo
echo 'Готово. Закройте и снова откройте Termux, затем введите:  play'
echo 'Ключ API введите в Таверне один раз: на телефоне он хранится отдельно от ПК.'
