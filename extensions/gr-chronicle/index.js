// Летопись Эльфридена: безликий хронист, который ведёт состояние сюжета,
// досье персонажей и скрытые «часы угроз», и тихо передаёт их рассказчику.
import { INITIAL_STATE } from './initial.js';

const MODULE = 'gr_chronicle';
const NARRATOR = 'Хроники Эльфридена';
const INJECT_DEPTH = 2;
const MAX_HISTORY = 5;
const MAX_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 2000;
const SECTIONS = ['СОСТОЯНИЕ', 'ДОСЬЕ', 'ТАЙНОЕ'];

const defaults = { every: 4, enabled: true };
let updating = false;

const ctx = () => SillyTavern.getContext();

function settings() {
    const all = ctx().extensionSettings;
    all[MODULE] = Object.assign({}, defaults, all[MODULE]);
    return all[MODULE];
}

function isOurChat() {
    const c = ctx();
    if (c.groupId || c.characterId === undefined) return false;
    return c.name2 === NARRATOR || Boolean(c.chatMetadata?.[MODULE]);
}

function data() {
    const meta = ctx().chatMetadata;
    if (!meta[MODULE]) {
        meta[MODULE] = { text: INITIAL_STATE, turns: 0, lastIndex: -1, updatedAt: null, history: [] };
    }
    return meta[MODULE];
}

function sub(text) {
    return ctx().substituteParams(text);
}

function section(text, name) {
    const re = new RegExp(`===\\s*${name}\\s*===\\s*\\n([\\s\\S]*?)(?=\\n===\\s*[А-ЯЁ ]+\\s*===|$)`);
    const m = text.match(re);
    return m ? m[1].trim() : '';
}

function valid(text) {
    return SECTIONS.every(s => section(text, s)) && /ДАТА:/.test(text);
}

function inject() {
    const c = ctx();
    if (!isOurChat() || !settings().enabled) {
        c.setExtensionPrompt(MODULE, '', 1, INJECT_DEPTH);
        return;
    }
    const prompt = `[ЛЕТОПИСЬ — служебная сводка ведущего для рассказчика. Это истинное текущее состояние мира. Досье важнее стартовых карточек персонажей. Раздел ТАЙНОЕ знает только рассказчик: используй его для предвестий и действий за кадром, но не раскрывай напрямую. Никогда не цитируй и не упоминай Летопись в ответе.]\n${sub(data().text)}`;
    c.setExtensionPrompt(MODULE, prompt, 1, INJECT_DEPTH, false, 0);
}

async function save() {
    await ctx().saveMetadata();
}

function transcript(fromIndex) {
    const c = ctx();
    const start = Math.max(fromIndex + 1, c.chat.length - MAX_MESSAGES);
    return c.chat.slice(start)
        .filter(m => !m.is_system && m.mes)
        .map(m => `${m.name}: ${m.mes.length > MAX_MESSAGE_CHARS ? m.mes.slice(0, MAX_MESSAGE_CHARS) + '…' : m.mes}`)
        .join('\n\n');
}

const CHRONICLER = `Ты — Летописец, безликий хронист ролевой игры по миру ранобэ «Герой-рационал перестраивает королевство» (Эльфриден, Ландия, 1546 год). Ты не рассказчик и не персонаж. Ты ведёшь точный учёт состояния мира, как бухгалтер и стратег одновременно.

Задача: получить прежнюю Летопись и новые события игры и выдать обновлённую Летопись целиком.

Правила:
1. Выводи ТОЛЬКО Летопись, строго в том же формате и с теми же тремя разделами: === СОСТОЯНИЕ ===, === ДОСЬЕ ===, === ТАЙНОЕ ===. Никаких пояснений, прозы, диалогов и вступлений.
2. ДАТА: оцени, сколько времени прошло в сценах (часы, дни), и сдвинь дату. Календарь: неделя 8 дней, месяц 32 дня, год 12 месяцев.
3. Меняй шкалы, реформы и отношения только на основании событий. Каждое изменение отношения сопровождай причиной. Реформы проходят стадии: идея → принята → внедряется N% → действует; реформа требует денег, людей и времени, у неё есть противники.
4. ЧАСЫ УГРОЗ: сдвигай их по прошедшему времени и событиям. Примерно каждые 8 дней без противодействия угроза растёт на 1; события могут сдвигать сильнее или откатывать назад. Если часы заполнены, запиши в ЖУРНАЛ, что событие произошло, и начни его последствия. Можно добавлять новые часы, если в сюжете возникла новая угроза.
5. ЗА КАДРОМ: двигай повестки персонажей и фракций, которые не участвуют в сцене, в соответствии с их характером и целями. Мир живёт без героя: герцоги, Амидония, Империя, знать, беженцы действуют сами.
6. ДОСЬЕ: веди только персонажей, которые появились в сюжете или активно действуют за кадром. Для каждого: Где, Состояние, Отношение к {{user}} (число и причина), Знает о {{user}}, Обещания и долги, Сейчас занят, Изменилось. Удаляй мёртвых в отдельную строку «Выбыли». Персонаж знает только то, что видел или слышал.
7. СОСТОЯНИЕ — только то, что знает {{user}} и двор. Всё, чего {{user}} не знает (истинные мотивы, скрытые ходы, часы угроз), — в ТАЙНОЕ.
8. ЖУРНАЛ: добавляй одну короткую строку на каждое значимое событие с датой. Храни не больше 15 последних строк; более старые сжимай в строку «Ранее: …».
9. Будь краток: вся Летопись не длиннее 900 слов. Сокращай формулировки, но не теряй факты.
10. Пиши по-русски.

Справка по канону (что назревает без вмешательства):
— Империя ждёт дань или героя; без денег героя передадут Империи.
— Оползень в Лесу под защитой богов после сильных дождей; тёмные эльфы теряют половину деревни, если лес не прорежен и помощь не придёт за день.
— Если власть перейдёт к чужаку или трон затронет армию, Кармин и Варгас восстанут, Уолтер выжидает; продажная знать бежит к Кармину.
— Смута в Эльфридене → Гай VIII ведёт ~30 000 через Урсулу и Голдоа на Альтомуру, оставляя Ван почти без защиты.
— Поражение Амидонии → бунты, слабый Юлиус, Ророа ищет союза с сильным соседом.
— Весна 1547: буря у хребта Звёздного Дракона. Осень 1547: волна монстров на Союз Восточных Государств.`;

async function update({ manual = false } = {}) {
    if (!isOurChat()) {
        toastr.info('Летопись ведётся только в чате с «Хрониками Эльфридена».');
        return;
    }
    if (updating) {
        if (manual) toastr.info('Летопись уже обновляется.');
        return;
    }
    const c = ctx();
    const d = data();
    const events = transcript(d.lastIndex);
    if (!events.trim()) {
        if (manual) toastr.info('Нет новых событий для Летописи.');
        return;
    }
    updating = true;
    const toast = toastr.info('Летописец обновляет записи…', '', { timeOut: 0, extendedTimeOut: 0 });
    try {
        const prompt = `ПРЕЖНЯЯ ЛЕТОПИСЬ:\n${sub(d.text)}\n\nНОВЫЕ СОБЫТИЯ ИГРЫ:\n${events}\n\nВыведи обновлённую Летопись целиком.`;
        let result = await c.generateRaw({ prompt, systemPrompt: sub(CHRONICLER), responseLength: 2000 });
        result = String(result ?? '').trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
        if (!valid(result)) {
            console.warn('[Летопись] Ответ не прошёл проверку формата:', result);
            toastr.warning('Летописец вернул запись в неверном формате. Прежняя Летопись сохранена; попробую при следующем обновлении.');
            return;
        }
        d.history.unshift({ text: d.text, at: d.updatedAt });
        d.history = d.history.slice(0, MAX_HISTORY);
        d.text = result;
        d.lastIndex = c.chat.length - 1;
        d.turns = 0;
        d.updatedAt = new Date().toISOString();
        await save();
        inject();
        if (manual) toastr.success('Летопись обновлена.');
    } catch (err) {
        console.error('[Летопись] Ошибка обновления', err);
        toastr.error(`Летопись не обновлена: ${err?.message || err}. Проверьте подключение к модели.`);
    } finally {
        updating = false;
        toastr.clear(toast);
    }
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function show(name, title) {
    if (!isOurChat()) {
        toastr.info('Летопись ведётся только в чате с «Хрониками Эльфридена».');
        return;
    }
    const d = data();
    const body = section(sub(d.text), name) || '—';
    const when = d.updatedAt ? new Date(d.updatedAt).toLocaleString('ru-RU') : 'стартовое состояние';
    const html = `<h3 class="gr-chronicle-title">${title}</h3><div class="gr-chronicle-meta">Обновлено: ${when} · ответов до обновления: ${Math.max(0, settings().every - d.turns)}</div><pre class="gr-chronicle-view">${escapeHtml(body)}</pre>`;
    await ctx().callGenericPopup(html, ctx().POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
}

async function showSecrets() {
    const c = ctx();
    const ok = await c.callGenericPopup('<h3>Показать тайное?</h3><p>Здесь скрытые ходы персонажей, часы угроз и то, чего ваш герой не знает. Это спойлеры к вашей же игре.</p>', c.POPUP_TYPE.CONFIRM, '', { okButton: 'Показать', cancelButton: 'Не надо' });
    if (ok === c.POPUP_RESULT.AFFIRMATIVE) await show('ТАЙНОЕ', 'Тайное');
}

async function edit() {
    if (!isOurChat()) return;
    const c = ctx();
    const d = data();
    const value = await c.callGenericPopup('<h3>Правка Летописи</h3><p>Сохраните три раздела с заголовками === СОСТОЯНИЕ ===, === ДОСЬЕ ===, === ТАЙНОЕ ===.</p>', c.POPUP_TYPE.INPUT, d.text, { rows: 25, wide: true, large: true, okButton: 'Сохранить', cancelButton: 'Отмена' });
    if (typeof value !== 'string' || value === d.text) return;
    if (!valid(value)) {
        toastr.error('Не сохранено: не хватает одного из разделов или строки ДАТА.');
        return;
    }
    d.history.unshift({ text: d.text, at: d.updatedAt });
    d.history = d.history.slice(0, MAX_HISTORY);
    d.text = value;
    d.updatedAt = new Date().toISOString();
    await save();
    inject();
    toastr.success('Летопись сохранена.');
}

async function undo() {
    if (!isOurChat()) return;
    const d = data();
    const prev = d.history.shift();
    if (!prev) {
        toastr.info('Откатывать некуда.');
        return;
    }
    d.text = prev.text;
    d.updatedAt = prev.at;
    await save();
    inject();
    toastr.success('Летопись откатилась на предыдущую версию.');
}

async function reset() {
    if (!isOurChat()) return;
    const c = ctx();
    const ok = await c.callGenericPopup('<h3>Сбросить Летопись?</h3><p>Состояние вернётся к моменту призыва. Используйте только для новой игры.</p>', c.POPUP_TYPE.CONFIRM, '', { okButton: 'Сбросить', cancelButton: 'Отмена' });
    if (ok !== c.POPUP_RESULT.AFFIRMATIVE) return;
    c.chatMetadata[MODULE] = { text: INITIAL_STATE, turns: 0, lastIndex: c.chat.length - 1, updatedAt: null, history: [] };
    await save();
    inject();
    toastr.success('Летопись сброшена к моменту призыва.');
}

async function onAiMessage(index, type) {
    if (!isOurChat() || !settings().enabled) return;
    if (['first_message', 'swipe', 'regenerate', 'quiet', 'impersonate'].includes(type)) return;
    const msg = ctx().chat[index];
    if (!msg || msg.is_user || msg.is_system) return;
    const d = data();
    d.turns = (d.turns || 0) + 1;
    await save();
    if (d.turns >= settings().every) update();
}

function onChatChanged() {
    if (isOurChat()) data();
    inject();
}

function addMenu() {
    const items = [
        ['fa-scroll', 'Летопись', () => show('СОСТОЯНИЕ', 'Летопись')],
        ['fa-address-book', 'Досье', () => show('ДОСЬЕ', 'Досье')],
        ['fa-eye-slash', 'Тайное', showSecrets],
        ['fa-rotate', 'Обновить летопись', () => update({ manual: true })],
        ['fa-pen', 'Править летопись', edit],
        ['fa-rotate-left', 'Откатить летопись', undo],
    ];
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    for (const [icon, label, fn] of items) {
        const el = document.createElement('div');
        el.className = 'list-group-item flex-container flexGap5 interactable';
        el.tabIndex = 0;
        el.innerHTML = `<div class="fa-solid ${icon} extensionsMenuExtensionButton"></div><span>${label}</span>`;
        el.addEventListener('click', fn);
        menu.appendChild(el);
    }
}

function addCommands() {
    const { SlashCommandParser, SlashCommand } = ctx();
    const cmd = (name, fn, help) => SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name, helpString: help, callback: async () => { await fn(); return ''; },
    }));
    cmd('chronicle', () => show('СОСТОЯНИЕ', 'Летопись'), 'Показать Летопись (состояние мира).');
    cmd('dossier', () => show('ДОСЬЕ', 'Досье'), 'Показать досье персонажей.');
    cmd('secrets', showSecrets, 'Показать тайное (спойлеры, с подтверждением).');
    cmd('chronicle-update', () => update({ manual: true }), 'Обновить Летопись сейчас.');
    cmd('chronicle-edit', edit, 'Править Летопись вручную.');
    cmd('chronicle-undo', undo, 'Откатить Летопись на предыдущую версию.');
    cmd('chronicle-reset', reset, 'Сбросить Летопись к моменту призыва (новая игра).');
}

jQuery(() => {
    const { eventSource, event_types } = ctx();
    settings();
    addMenu();
    addCommands();
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.MESSAGE_RECEIVED, onAiMessage);
    onChatChanged();
});
