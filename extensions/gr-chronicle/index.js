// Летопись Эльфридена: безликий хронист, который ведёт состояние сюжета,
// досье персонажей и скрытые «часы угроз», и тихо передаёт их рассказчику.
import { INITIAL_STATE } from './initial.js';

const MODULE = 'gr_chronicle';
const NARRATOR = 'Хроники Эльфридена';
const INJECT_DEPTH = 4;
const MAX_HISTORY = 5;
const MAX_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 2000;
const SECTIONS = ['СОСТОЯНИЕ', 'ДОСЬЕ', 'ТАЙНОЕ'];

const GEO = `КАРТА (неизменна, сверяйся всегда):
— Эльфриден на юго-востоке Ландии. Столица Парнам в центре. Южнее Парнама Лес под защитой богов.
— Хлебные районы на юго-западе (бывшие земли Амидонии).
— Герцог Кармин (Георг) — Рандель, северо-запад, у амидонской границы. Сухопутная армия.
— Герцог Варгас (Кастор) — Город Красного Дракона, горы на севере. Воздушные силы.
— Герцогиня Уолтер (Экселл) — Лагуна-Сити, северо-восточное побережье. Флот.
— Крепость Альтомура у хребта Урсула, граница с Амидонией.
Расстояния только в днях пути (или в вёрстах/лигах), никогда в километрах. Не выдумывай новые города, замки и расстояния; не переноси персонажей и владения без события в сюжете.`;

// ---- Лорбук: Летописец сверяется с ним, а не сочиняет ----
const LORE_BOOKS = [
    'ГР — Быт и культура', 'ГР — Военное дело', 'ГР — География', 'ГР — Государства', 'ГР — История',
    'ГР — Канон · узлы сюжета', 'ГР — Локации', 'ГР — Лор и магия', 'ГР — Персонажи · Амидония',
    'ГР — Персонажи · двор Парнама', 'ГР — Персонажи · Империя', 'ГР — Персонажи · правила',
    'ГР — Персонажи · прочие страны', 'ГР — Персонажи · скрытые таланты', 'ГР — Персонажи · три герцогства',
    'ГР — Политика', 'ГР — Расы', 'ГР — Экономика',
];
// Эти книги Летописец видит всегда целиком: карта и узлы сюжета. Плюс запись календаря.
const LORE_ALWAYS = ['ГР — География', 'ГР — Канон · узлы сюжета'];
const LORE_ALWAYS_ENTRIES = ['Континентальный календарь'];
const LORE_BUDGET = 22000; // символов справки на одно обновление

async function bookNames() {
    try {
        const wi = await import('../../../world-info.js');
        const found = (wi.world_names || []).filter(n => n.startsWith('ГР —'));
        if (found.length) return found;
    } catch (e) { console.warn('[Летопись] список лорбуков не получен, беру встроенный', e); }
    return LORE_BOOKS;
}

function keyMatches(key, text) {
    const k = String(key || '').trim();
    if (!k) return false;
    const m = k.match(/^\/([\s\S]+)\/([a-z]*)$/);
    if (m) {
        try { return new RegExp(m[1], m[2]).test(text); } catch { return false; }
    }
    return text.toLowerCase().includes(k.toLowerCase());
}

async function loreFor(scanText) {
    const always = [], matched = [];
    for (const name of await bookNames()) {
        let book;
        try { book = await ctx().loadWorldInfo(name); } catch { continue; }
        if (!book?.entries) continue;
        for (const e of Object.values(book.entries)) {
            if (e.disable || !e.content) continue;
            const item = `[${name.replace('ГР — ', '')} · ${e.comment || (e.key || [])[0] || 'запись'}]\n${e.content.trim()}`;
            if (LORE_ALWAYS.includes(name) || LORE_ALWAYS_ENTRIES.includes(e.comment)) always.push(item);
            else if ((e.key || []).some(k => keyMatches(k, scanText))) matched.push(item);
        }
    }
    const out = [];
    let size = 0;
    for (const item of [...always, ...matched]) {
        if (size + item.length > LORE_BUDGET) continue;
        out.push(item);
        size += item.length;
    }
    return sub(out.join('\n\n'));
}

// ---- Календарь и таймлайн: угрозы не наступают раньше своего срока ----
const DAYS_IN_YEAR = 384, DAYS_IN_MONTH = 32;
const SUMMON_DAY = abs(1546, 4, 30);

function abs(y, m, d) { return (y - 1546) * DAYS_IN_YEAR + (m - 1) * DAYS_IN_MONTH + d; }
function fmt(n) {
    const y = 1546 + Math.floor((n - 1) / DAYS_IN_YEAR);
    const r = (n - 1) % DAYS_IN_YEAR;
    return `${y} г., ${Math.floor(r / DAYS_IN_MONTH) + 1}-й месяц, ${(r % DAYS_IN_MONTH) + 1}-й день`;
}
function parseDate(text) {
    const m = String(text).match(/ДАТА:\s*(\d{4})\s*г\.?,?\s*(\d+)-?й?\s*месяц[а-я]*,?\s*(\d+)-?й?\s*день/i);
    return m ? abs(+m[1], +m[2], +m[3]) : null;
}

// Сроки из лорбука «Канон · узлы сюжета» и «История». earliest — день, раньше которого событие невозможно.
const TIMELINE = [
    { name: 'Оползень в Лесу под защитой богов', earliest: SUMMON_DAY + 16,
      rule: 'через несколько недель после призыва и только после затяжных дождей, показанных в сюжете или ЗА КАДРОМ' },
    { name: 'Окончательное требование Империи', earliest: SUMMON_DAY + 32,
      rule: 'посол требует ответа не раньше чем через месяц после призыва, если в сюжете не назван другой срок' },
    { name: 'Открытый мятеж герцогов', earliest: SUMMON_DAY + 64,
      rule: 'только если власть перешла к чужаку или трон затронул армию; сначала гонцы должны довезти вести (дни пути), потом отказ явиться ко двору, переписка, сбор войск; открытый мятеж — не раньше двух месяцев после призыва' },
    { name: 'Вторжение Амидонии на Альтомуру', earliest: SUMMON_DAY + 80,
      rule: 'только после того, как междоусобица в Эльфридене реально началась, и не раньше чем через 16 дней после её начала: 30 000 солдат нужно собрать' },
    { name: 'Буря над хребтом Звёздного Дракона', earliest: abs(1547, 1, 1),
      rule: 'весна 1547 года, ко времени Церемонии контракта' },
    { name: 'Волна монстров на Союз Восточных Государств', earliest: abs(1547, 9, 1),
      rule: 'осень 1547 года; бьёт по Ластании и Чиме на севере, НЕ по Эльфридену' },
];

function timelineText(day) {
    const now = day ?? SUMMON_DAY;
    const lines = TIMELINE.map(t => now < t.earliest
        ? `— ЗАБЛОКИРОВАНО до ${fmt(t.earliest)}: ${t.name}. Условие: ${t.rule}.`
        : `— Возможно с ${fmt(t.earliest)}: ${t.name}. Условие: ${t.rule}.`);
    return `ТЕКУЩАЯ ДАТА: ${fmt(now)} (день ${now - SUMMON_DAY} после призыва)
ТАЙМЛАЙН КАНОНА (сроки жёсткие):
${lines.join('\n')}
— Демоны: северный фронт в тупике уже годы, демоны не продвигаются. Никаких нападений демонов или орд монстров на Эльфриден. Отдельные монстры возможны только в подземельях и глуши.`;
}

// Слова, по которым видно, что Летописец запустил событие раньше срока.
const LOCK_MARKERS = [
    { idx: 4, re: /буря|Звёздн[а-яё]* Дракон/i },
    { idx: 5, re: /волн[аыу] монстр|нашестви|орд[аыу] монстр/i },
    { idx: 3, re: /Гай[^.\n]{0,40}(выступ|вторг|перешёл|ведёт|осад)|вторжени[ея] Амидони/i },
    { idx: 2, re: /мятеж|восстал[иа]?|восстани/i },
];
function journal(text) {
    const m = String(text).match(/ЖУРНАЛ:\s*\n([\s\S]*?)(?=\n===|$)/);
    return m ? m[1] : '';
}
function earlyEvent(oldText, newText, day) {
    const oldJ = journal(oldText), newJ = journal(newText);
    for (const { idx, re } of LOCK_MARKERS) {
        const t = TIMELINE[idx];
        if (day < t.earliest && re.test(newJ) && !re.test(oldJ)) return t.name;
    }
    return null;
}

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
    const prompt = `[ЛЕТОПИСЬ — служебная сводка ведущего для рассказчика. Это истинное текущее состояние мира. Досье важнее стартовых карточек персонажей. Раздел ТАЙНОЕ знает только рассказчик: используй его для предвестий и действий за кадром, но не раскрывай напрямую. Никогда не цитируй и не упоминай Летопись в ответе. Не пересказывай ТАЙНОЕ и сводку устами персонажей: не больше одного предвестия за сцену, NPC не зачитывают списки угроз. Если Летопись расходится с картой ниже, верна карта. Летопись — фон, а не сценарий: всё из ЖУРНАЛА уже произошло и уже показано в чате. Не разыгрывай это заново, не повторяй цифры и доклады; продолжай сцену с последнего сообщения игрока.${data().stale ? ' Летопись сейчас может опережать чат (игрок удалил или переиграл сообщения): если она расходится с чатом, верен чат.' : ''}]\n${GEO}\n\n${timelineText(parseDate(data().text))}\nСобытия со статусом ЗАБЛОКИРОВАНО не происходят и не упоминаются как текущие.\n\n${sub(data().text)}`;
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
4. ЧАСЫ УГРОЗ привязаны к ТАЙМЛАЙНУ ниже. Событие со статусом ЗАБЛОКИРОВАНО не может произойти, даже если часы полны: держи их на последнем делении до даты. Двигай часы прежде всего по конкретным событиям игры; одно лишь время двигает их не быстрее чем на 1 деление за 16 дней. Сначала должны сложиться предпосылки (вести дошли, войска собраны, дожди прошли) — перепрыгивать этапы нельзя. Если часы заполнены и срок наступил, запиши событие в ЖУРНАЛ. Новые часы добавляй только для угрозы, которая уже прямо проявилась в сюжете, и сразу указывай для неё реалистичный срок.
5. ЗА КАДРОМ: двигай повестки персонажей и фракций, которые не участвуют в сцене, в соответствии с их характером и целями. Мир живёт без героя: герцоги, Амидония, Империя, знать, беженцы действуют сами. Но действия за кадром ограничены скоростью гонцов и маршей: персонаж не может узнать новость раньше, чем её довезут.
6. ДОСЬЕ: веди только персонажей, которые появились в сюжете или активно действуют за кадром. Для каждого: Где, Состояние, Отношение к {{user}} (число и причина), Знает о {{user}}, Обещания и долги, Сейчас занят, Изменилось. Удаляй мёртвых в отдельную строку «Выбыли». Персонаж знает только то, что видел или слышал.
7. СОСТОЯНИЕ — только то, что знает {{user}} и двор. Всё, чего {{user}} не знает (истинные мотивы, скрытые ходы, часы угроз), — в ТАЙНОЕ.
8. ЖУРНАЛ: добавляй одну короткую строку на каждое значимое событие с датой. Храни не больше 15 последних строк; более старые сжимай в строку «Ранее: …».
9. Будь краток: вся Летопись не длиннее 900 слов. Сокращай формулировки, но не теряй факты.
10. Пиши по-русски.
11. География — строго по карте ниже. Если в прежней Летописи место или расстояние противоречит карте, исправь его.
12. НЕ ВЫДУМЫВАЙ. Каждый факт о персонаже, месте, расстоянии, дате, титуле и имени бери из СПРАВКИ ЛОРБУКА или из событий игры. Если опоры нет — не пиши этот факт или пиши «неизвестно». Если прежняя Летопись противоречит справке, исправь Летопись по справке.
13. ДАТА не может идти назад и не может прыгнуть дальше, чем реально прошло в сценах.
14. Каждое число (суммы, войска, расстояния) пиши в Летописи один раз, в самом подходящем разделе; не дублируй его в ЖУРНАЛЕ, ДОСЬЕ и ОТКРЫТЫХ НИТЯХ.
15. Если в событиях игры цифра или факт изменились (игрок переиграл сцену, персонаж уточнил), бери последнюю версию из событий.

${GEO}`;

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
        const staleNote = d.stale ? '\n\nВНИМАНИЕ: прежняя Летопись могла забежать вперёд — игрок удалил или переиграл часть сообщений. Истина — СОБЫТИЯ ИГРЫ ниже. Убери из Летописи всё, чего в них нет или что им противоречит; дату выставь по событиям (сдвиг назад здесь допустим).' : '';
        const prompt = `ПРЕЖНЯЯ ЛЕТОПИСЬ:\n${sub(d.text)}\n\nНОВЫЕ СОБЫТИЯ ИГРЫ:\n${events}${staleNote}\n\nВыведи обновлённую Летопись целиком.`;
        const oldDay = parseDate(d.text) ?? SUMMON_DAY;
        const lore = await loreFor(`${d.text}\n${events}`);
        const systemPrompt = `${sub(CHRONICLER)}\n\n${timelineText(oldDay)}\n\nСПРАВКА ЛОРБУКА (истина мира; Летопись не может ей противоречить):\n${lore}`;
        let result = await c.generateRaw({ prompt, systemPrompt, responseLength: 2000 });
        result = String(result ?? '').trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
        if (!valid(result)) {
            console.warn('[Летопись] Ответ не прошёл проверку формата:', result);
            toastr.warning('Летописец вернул запись в неверном формате. Прежняя Летопись сохранена; попробую при следующем обновлении.');
            return;
        }
        const newDay = parseDate(result);
        if (!d.stale && newDay !== null && newDay < oldDay) {
            toastr.warning('Летописец отмотал дату назад. Прежняя Летопись сохранена.');
            return;
        }
        const early = earlyEvent(d.text, result, newDay ?? oldDay);
        if (early) {
            console.warn('[Летопись] Событие раньше срока:', early, result);
            toastr.warning(`Летописец запустил «${early}» раньше срока. Прежняя Летопись сохранена.`);
            return;
        }
        snapshot(d);
        d.text = result;
        d.stale = false;
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
    snapshot(d);
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
    if (typeof prev.lastIndex === 'number') d.lastIndex = Math.min(prev.lastIndex, ctx().chat.length - 1);
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

function snapshot(d) {
    d.history.unshift({ text: d.text, at: d.updatedAt, lastIndex: d.lastIndex });
    d.history = d.history.slice(0, MAX_HISTORY);
}

// Летопись не должна знать о сообщениях, которых в чате больше нет.
// limit — индекс первого изменённого сообщения (или длина чата после удаления).
async function rewind(limit) {
    if (!isOurChat()) return;
    const d = data();
    if (d.lastIndex < limit) return;
    const i = d.history.findIndex(h => typeof h.lastIndex === 'number' && h.lastIndex < limit);
    if (i >= 0) {
        const h = d.history[i];
        d.text = h.text;
        d.updatedAt = h.at;
        d.lastIndex = h.lastIndex;
        d.history = d.history.slice(i + 1);
        d.stale = false;
        toastr.info('Летопись откатилась вслед за чатом.');
    } else {
        // Подходящей версии нет (старые записи без индекса): сверим с чатом при обновлении.
        d.lastIndex = Math.max(-1, limit - 1 - MAX_MESSAGES);
        d.stale = true;
    }
    d.turns = 0;
    await save();
    inject();
    if (d.stale) update();
}

async function onDeleted(newLength) {
    await rewind(Number(newLength ?? ctx().chat.length));
}

async function onChangedAt(index) {
    const i = Number(index);
    if (Number.isFinite(i)) await rewind(i);
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
    if (isOurChat()) {
        data();
        rewind(ctx().chat.length);
    }
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
    eventSource.on(event_types.MESSAGE_DELETED, onDeleted);
    eventSource.on(event_types.MESSAGE_SWIPED, onChangedAt);
    eventSource.on(event_types.MESSAGE_EDITED, onChangedAt);
    onChatChanged();
});
