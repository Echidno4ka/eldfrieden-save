// Летопись Эльфридена: безликий хронист, который ведёт состояние сюжета,
// досье персонажей и тайное, и тихо передаёт их рассказчику.
// Реакцию черни, знати, войска, герцогов и соседей считает код («Реакция мира») по показателям, а не Летописец.
import { INITIAL_STATE } from './initial.js';
import { MERA } from './mera.data.js';
import { REACTION } from './reaction.data.js';
import { initWorld, parseEffects, applyEffects, advance, summary, cloneWorld } from './reaction.js';

const MODULE = 'gr_chronicle';
const NARRATOR = 'Хроники Эльфридена';
const INJECT_DEPTH = 4;
const MAX_HISTORY = 5;
const MAX_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 2000;
const SECTIONS = ['СОСТОЯНИЕ', 'ДОСЬЕ', 'ТАЙНОЕ'];
const REGISTRY = 'УСТАНОВЛЕНО';

const GEO = `КАРТА (неизменна, сверяйся всегда):
— Эльфриден на юго-востоке Ландии. Столица Парнам в центре. Южнее Парнама Лес под защитой богов.
— Хлебные районы на юго-западе (бывшие земли Амидонии).
— Герцог Кармин (Георг) — Рандель, северо-запад, у амидонской границы. Сухопутная армия.
— Герцог Варгас (Кастор) — Город Красного Дракона, горы на севере. Воздушные силы.
— Герцогиня Уолтер (Экселл) — Лагуна-Сити, северо-восточное побережье. Флот.
— Крепость Альтомура у хребта Урсула, граница с Амидонией.
Расстояния между местами — только в днях пути и только по «Карте и путям» из «Меры мира» и по справке пути; размеры предметов можно в метрах. Не выдумывай новые города, замки и расстояния; не переноси персонажей и владения без события в сюжете.`;

// ---- Лорбук: Летописец сверяется с ним, а не сочиняет ----
const LORE_BOOKS = [
    'ГР — Быт и культура', 'ГР — Военное дело', 'ГР — География', 'ГР — Государства', 'ГР — История',
    'ГР — Канон · узлы сюжета', 'ГР — Локации', 'ГР — Лор и магия', 'ГР — Персонажи · Амидония',
    'ГР — Персонажи · двор Парнама', 'ГР — Персонажи · Империя', 'ГР — Персонажи · правила',
    'ГР — Персонажи · прочие страны', 'ГР — Персонажи · скрытые таланты', 'ГР — Персонажи · три герцогства',
    'ГР — Политика', 'ГР — Расы', 'ГР — Экономика', 'ГР — Уклад мира', 'ГР — Мера мира',
];
// Эти книги Летописец видит всегда целиком: карта и узлы сюжета. Плюс запись календаря.
const LORE_ALWAYS = ['ГР — География', 'ГР — Канон · узлы сюжета'];
const LORE_ALWAYS_ENTRIES = ['Континентальный календарь', 'Время и темп игры', 'Сколько занимают дела', 'Вести и связь', 'Мера мира: правила чисел', 'Карта и пути', 'Скорости', 'Цены и жалованье', 'Население', 'Хозяйство и казна', 'Государство: совет и канцелярия', 'Государство: финансы и подати', 'Государство: суд и провинции', 'Государство: армия, флот и небо', 'Государство: королевский дом', 'Как движутся дела', 'Безликие исполнители'];
const LORE_BUDGET = 34000; // символов справки на одно обновление

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

// ---- Календарь и таймлайн: природные и чужие события не наступают раньше своего срока ----
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

// Только события природы и чужих стран, не зависящие от решений двора. Мятежи, бунты, вторжения, ультиматумы
// здесь не задаются: их ступени считает «Реакция мира». earliest — день, раньше которого событие невозможно.
const TIMELINE = [
    { name: 'Оползень в Лесу под защитой богов', earliest: SUMMON_DAY + 16,
      rule: 'через несколько недель после призыва и только после затяжных дождей, показанных в сюжете или ЗА КАДРОМ' },
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
ТАЙМЛАЙН КАНОНА (сроки природных и чужих событий жёсткие):
${lines.join('\n')}
— Бунты, мятежи, вторжения, ультиматумы: только по ступеням «Реакции мира», не по датам.
— Демоны: северный фронт в тупике уже годы, демоны не продвигаются. Никаких нападений демонов или орд монстров на Эльфриден. Отдельные монстры возможны только в подземельях и глуши.`;
}

// Слова, по которым видно, что Летописец запустил событие раньше срока.
const LOCK_MARKERS = [
    { idx: 1, re: /буря|Звёздн[а-яё]* Дракон/i },
    { idx: 2, re: /волн[аыу] монстр|нашестви|орд[аыу] монстр/i },
];
// Слова тяжёлых реакций и ступень названного актора, без которой они невозможны (ступени считает «Реакция мира»).
// Проверяется каждая новая строка журнала: сначала точные маркеры (кто назван), общий «мятеж» — только если никто не назван.
const REACTION_MARKERS = [
    { name: 'Вторжение Амидонии', re: /Гай[^.\n]{0,40}(выступ|вторг|перешёл|ведёт|осад)|вторжени[ея] Амидони|Амидони[^.\n]{0,30}(вторг|осад)/i, need: [['Амидония', 5]] },
    { name: 'Ультиматум Империи', re: /ультиматум[^\n]*(Импери|Гран Хаос|Жанн|Мари)|(Импери|Гран Хаос)[^\n]*ультиматум/i, need: [['Империя', 3]] },
    { name: 'Бунт черни', re: /(бунт|восстани|жакери)[^\n]*(черн|крестьян|горожан|предмест|голодн)|(черн|крестьян)[^\n]*(бунт|восста)/i, need: [['чернь', 3]] },
    { name: 'Мятеж войска', re: /мятеж[^\n]*(рот|войск|солдат|гарнизон|армии)|(рот|солдат|гарнизон)[^\n]*взбунт/i, need: [['войско', 4]] },
    { name: 'Мятеж Кармина', re: /(мятеж|восста|отказ[а-я]* от присяги)[^\n]*(Кармин|Георг)|(Кармин|Георг)[^\n]*(восстал|мятеж|отказал[а-я]* от присяги)/i, need: [['Кармин', 4]] },
    { name: 'Мятеж Варгаса', re: /(мятеж|восста|отказ[а-я]* от присяги)[^\n]*(Варгас|Кастор)|(Варгас|Кастор)[^\n]*(восстал|мятеж|отказал[а-я]* от присяги)/i, need: [['Варгас', 4]] },
    { name: 'Мятеж Уолтер', re: /(мятеж|восста|отказ[а-я]* от присяги)[^\n]*(Уолтер|Экселл)|(Уолтер|Экселл)[^\n]*(восстал|мятеж|отказал[а-я]* от присяги)/i, need: [['Уолтер', 4]] },
    { name: 'Мятеж знати', re: /мятеж[^\n]*знат|знать[^\n]*(восстал|мятеж)/i, need: [['знать', 5]] },
    { name: 'Мятеж', re: /мятеж|восстал[иа]?|восстани/i, need: 'any4' },
];
const ANY4 = ['чернь', 'знать', 'войско', 'Кармин', 'Уолтер', 'Варгас', 'духовенство'];
const markerOk = (m, w) => m.need === 'any4' ? ANY4.some(id => stageOf(w, id) >= 4) : m.need.every(([id, s]) => stageOf(w, id) >= s);
const actorName = id => REACTION.actors.find(a => a.id === id)?.name || id;
function markerWhy(m, w) {
    if (m.need === 'any4') return 'ни одно сословие, войско или герцог ещё не дошли до ступени 4';
    return m.need.filter(([id, s]) => stageOf(w, id) < s).map(([id, s]) => `${actorName(id)} сейчас на ступени ${stageOf(w, id)} («${REACTION.actors.find(a => a.id === id)?.ladder[stageOf(w, id)]}»), а для этого нужна ступень ${s}`).join('; ');
}
function journal(text) {
    const m = String(text).match(/ЖУРНАЛ:\s*\n([\s\S]*?)(?=\n===|$)/);
    return m ? m[1] : '';
}
// Возвращает { name, why } или null.
function earlyEvent(oldText, newText, day, world) {
    const oldJ = journal(oldText), newJ = journal(newText);
    for (const { idx, re } of LOCK_MARKERS) {
        const t = TIMELINE[idx];
        if (day < t.earliest && re.test(newJ) && !re.test(oldJ)) return { name: t.name, why: `это событие невозможно раньше ${fmt(t.earliest)}` };
    }
    const oldLines = new Set(oldJ.split('\n').map(l => l.trim()));
    // «Ранее: …» — сжатые старые строки; маркер, уже бывший в прежнем журнале, — продолжение, а не новое событие.
    for (const line of newJ.split('\n').map(l => l.trim()).filter(l => l && !oldLines.has(l) && !/^Ранее/i.test(l))) {
        const hit = REACTION_MARKERS.filter(m => m.re.test(line) && !m.re.test(oldJ));
        const exact = hit.filter(m => m.need !== 'any4');
        for (const m of exact.length ? exact : hit) if (!markerOk(m, world)) return { name: m.name, why: markerWhy(m, world), line };
    }
    return null;
}

// ---- «Реакция мира»: сословия, герцоги и соседи отвечают на показатели, а не на отдельные события ----
const EFFECTS = 'ЭФФЕКТЫ';
const COURIER = MERA.speeds.find(s => s.id === 'courier').kmDay;
function stageOf(world, id) { return world.removed.includes(id) ? 0 : world.stage[id]?.s ?? 0; }
// Весть из Парнама доходит до престола актора за дни пути курьера (+1 день на сборы).
function delayOf(actor) {
    const from = MERA.places.find(p => p.id === 'parnam');
    const to = MERA.places.find(p => p.id === actor.seat) || from;
    return Math.ceil(kmBetween(from, to) / COURIER) + 1;
}
// Игра начинается с получения власти: отречение Альберта — первое событие мира, вести о нём расходятся с гонцами.
const OPENING_DAY = abs(1546, 4, 32);
const OPENING_EFFECTS = [
    'отречение в пользу чужака без обряда и совета пэров: Устои −3',
    'помолвка с наследницей и публичное одобрение Альберта: Устои +1',
    'НА 32: смена власти, чиновники не знают, чьих приказов держаться: Власть −1',
    'призванный стал правителем, а не выдан Империи: Угроза·Империя +1',
].join('\n');
function freshWorld() {
    const w = initWorld(SUMMON_DAY);
    advance(w, OPENING_DAY - 1);
    applyEffects(w, parseEffects(OPENING_EFFECTS), OPENING_DAY, delayOf, 'отречение Альберта и помолвка с Лисией');
    advance(w, OPENING_DAY);
    return w;
}
function worldOf(d) {
    if (!d.world) {
        d.world = freshWorld();
        advance(d.world, parseDate(d.text) ?? OPENING_DAY);
    }
    return d.world;
}
function stripEffects(text) {
    return String(text).replace(new RegExp(`\\n?===\\s*${EFFECTS}\\s*===[\\s\\S]*?(?=\\n===\\s*[А-ЯЁ ]+\\s*===|$)`), '').trim();
}
function reactionText(world, withScheduled = true) {
    return summary(world, fmt, withScheduled);
}
const AXES_HELP = (() => {
    const R = REACTION;
    return `Общие: ${R.common.join(', ')} (Ресурсы — казна и хлеб; Сила — войска короны; Власть — сила трона над провинциями; Порядок — закон и спокойствие на дорогах и в городах; Устои — законность власти и верность обычаю).
По сословиям: ${R.groupAxes.join(', ')} · ${R.groups.join(' / ')}, пиши «Бремя·чернь» (Достаток — сыты и при деньгах; Бремя — подати и повинности; Статус — права, почёт, место при дворе).
Герцоги: Статус · ${R.dukes.join(' / ')}, пиши «Статус·Кармин».
Соседи: ${R.neighborAxes.join(', ')} · ${R.neighbors.join(' / ')}, пиши «Выгода·Империя» (Угроза — насколько Эльфриден угрожает этому соседу; Выгода — что сосед получает от Эльфридена).
Акторы для ТРЕБОВАНИЕ: ${R.actors.map(a => a.id).join(', ')}.`;
})();

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

// ---- «Мера мира»: справка пути от текущего места героя (считает код, не модель) ----
function placeOf(text) {
    const line = (String(text).match(/МЕСТО[^:\n]*:([^\n]*)/) || [])[1] || '';
    const low = line.toLowerCase();
    return MERA.places.find(p => [p.name, ...p.aliases].some(a => a && low.includes(a.toLowerCase()))) || MERA.places.find(p => p.id === 'parnam');
}
function kmBetween(a, b) { return Math.round(Math.hypot(a.x - b.x, a.y - b.y) * ((a.road + b.road) / 2)); }
function fmtTime(days) {
    if (days < 0.08) return 'меньше часа';
    if (days < 0.8) return '~' + Math.max(1, Math.round(days * 10)) + ' ч';
    const d = Math.round(days * 2) / 2;
    return '~' + String(d).replace('.', ',') + ' ' + (d === 1 ? 'день' : d < 5 ? 'дня' : 'дней');
}
function travelNote(text) {
    const here = placeOf(text);
    const sp = Object.fromEntries(MERA.speeds.map(x => [x.id, x.kmDay]));
    const rows = MERA.places.filter(p => p.id !== here.id && (p.main || !p.rough)).map(p => {
        const d = kmBetween(here, p);
        return `${p.name}: ${d} км · армия ${fmtTime(d / sp.march)} · всадник ${fmtTime(d / sp.rider)} · курьер ${fmtTime(d / sp.courier)} · виверна ${fmtTime(d / sp.wyvern)}`;
    });
    return `[Справка пути от места «${here.name}» — посчитано по «Мере мира»; сутки пути ≈ 10 часов]\n${rows.join('\n')}`;
}

// ---- реестр «Установлено»: строки нельзя молча удалить ----
function registryLines(text) {
    return section(text, REGISTRY).split('\n').map(l => l.trim()).filter(Boolean);
}
function withRegistry(text, lines) {
    const body = lines.join('\n');
    const re = new RegExp(`(===\\s*${REGISTRY}\\s*===\\s*\\n)[\\s\\S]*?(?=\\n===\\s*[А-ЯЁ ]+\\s*===|$)`);
    return re.test(text) ? text.replace(re, `$1${body}`) : `${text.trim()}\n\n=== ${REGISTRY} ===\n${body}`;
}
function keepRegistry(oldText, newText) {
    const oldL = registryLines(oldText);
    if (!oldL.length) return newText;
    const newL = registryLines(newText);
    const norm = l => l.replace(/^[—\-•*\s]+/, '').toLowerCase();
    const have = new Set(newL.map(norm));
    const lost = oldL.filter(l => !have.has(norm(l)));
    return lost.length ? withRegistry(newText, [...newL, ...lost]) : newText;
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
    const prompt = `[ЛЕТОПИСЬ — служебная сводка ведущего для рассказчика. Это истинное текущее состояние мира. Досье важнее стартовых карточек персонажей. Раздел ТАЙНОЕ знает только рассказчик: используй его для предвестий и действий за кадром, но не раскрывай напрямую. Никогда не цитируй и не упоминай Летопись в ответе. Не пересказывай ТАЙНОЕ и сводку устами персонажей: не больше одного предвестия за сцену, NPC не зачитывают списки угроз. Если Летопись расходится с картой ниже, верна карта. Летопись — фон, а не сценарий: всё из ЖУРНАЛА уже произошло и уже показано в чате. Не разыгрывай это заново, не повторяй цифры и доклады; продолжай сцену с последнего сообщения игрока.${data().stale ? ' Летопись сейчас может опережать чат (игрок удалил или переиграл сообщения): если она расходится с чатом, верен чат.' : ''}]\n${GEO}\n\n${timelineText(parseDate(data().text))}\nСобытия со статусом ЗАБЛОКИРОВАНО не происходят и не упоминаются как текущие. Раздел УСТАНОВЛЕНО — закреплённые факты игры: имена, места, суммы, цены; повторяй их точно.\n\n${sub(data().text)}\n\n${travelNote(data().text)}\n\n[РЕАКЦИЯ МИРА — посчитано кодом по показателям страны; тайное, персонажи знают только то, что видели сами. Сословия, герцоги и соседи ведут себя по своей текущей ступени: её проявления уместны в сцене и за кадром, но ничего выше текущей ступени не происходит. Смена ступени — дело недель и месяцев, не одной сцены.]\n${reactionText(worldOf(data()), false)}`;
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

const CHRONICLER = `You are the Chronicler: a faceless bookkeeper of a role-play set in the world of the light novel "How a Realist Hero Rebuilt the Kingdom" (Elfrieden, Landia, year 1546). You are not the narrator and not a character. You keep an exact record of the world state.

TASK: take the previous Chronicle and the new game events; output the full updated Chronicle.

OUTPUT FORMAT
- Output ONLY the Chronicle, in Russian, in exactly the same format with the same sections: === СОСТОЯНИЕ ===, === ДОСЬЕ ===, === ТАЙНОЕ ===, === УСТАНОВЛЕНО ===, and last === ЭФФЕКТЫ === (see WORLD STATE). No explanations, no prose, no dialogue, no preamble.
- Keep the whole Chronicle under 900 words. Write every number (sums, troops, distances) once, in the most fitting section; do not repeat it in ЖУРНАЛ, ДОСЬЕ or ОТКРЫТЫЕ НИТИ.
- ЖУРНАЛ: one short dated line per significant event; keep the last 15 lines, compress older ones into "Ранее: …".
- A fourth section === УСТАНОВЛЕНО === goes last: the registry of facts first stated in play — new people (name, role), new places (with a distance to the nearest known place), sums, prices, numbered promises. One line per fact. Never delete or rephrase a line (the code restores deleted lines); if play explicitly retcons a fact, add a new line "Исправлено: …".

TIME (most important)
- Advance ДАТА only by the time that actually passed in the scenes. A normal scene is minutes or hours. Days pass only when the events show travel, sleep, waiting or an explicit time skip by the player.
- Use the reference entries "Время и темп игры" and "Сколько занимают дела": a task that takes days is not finished before those days have passed. Record it as in progress (e.g. "опись: день 1 из ~3").
- ДАТА never goes backwards and never jumps further than the scenes justify. Calendar: week 8 days, month 32 days, year 12 months.

FACTS
- Never invent. Every fact about a person, place, distance, date, title, name or sum comes from the LORE REFERENCE (section "СПРАВКА ЛОРБУКА") or from the game events. If there is no source, omit it or write "неизвестно".
- Distances and travel times: only from "Карта и пути" / "Скорости" (section "Мера мира") and the travel note. Money: only from "Цены и жалованье", "Хозяйство и казна" or the registry УСТАНОВЛЕНО.
- UNKNOWN VALUES: if a number is missing, derive it from «Мера мира» (prices in days of a labourer's wage of 100 G; travel via speeds; population via the tiers) and pin it in УСТАНОВЛЕНО. Never invent a number without such a derivation.
- WHO DOES WHAT: routine work is done by faceless executors of the responsible office (entries "Государство: …" and "Как движутся дела"); named characters only decide, receive reports, or act when the matter needs their authority.
- A character learns news only when a courier could physically have brought it (see "Вести и связь").
- If the previous Chronicle contradicts the reference or the latest game events, correct it. If the events changed a fact (the player replayed a scene), take the latest version.

WORLD STATE
- Change scales, reforms and relationships only because of events; give a reason for every relationship change. Reforms move through стадии: идея → принята → внедряется N% → действует; they need money, people and time and have opponents.
- Natural and foreign events follow the TIMELINE (section "ТАЙМЛАЙН КАНОНА"); an event marked ЗАБЛОКИРОВАНО cannot happen before its date.
- WORLD REACTION (section "РЕАКЦИЯ МИРА") is computed by code: the commoners, clergy, nobility, army, dukes and neighbours each sit on a stage of their ladder. Never write threat clocks or moods of these actors yourself, and never record in ЖУРНАЛ or ЗА КАДРОМ an action above an actor's current stage (no revolt, rebellion, invasion or ultimatum unless its stage has been reached). Show the current stage off-screen when it fits.
- EFFECTS: after the Chronicle add a section === ЭФФЕКТЫ === listing how the decisions and one-off events of THIS batch shifted the country's abstract indicators. Indicators run −10…+10, 0 is normal. Line formats:
  "<short cause>: Ось ±n; Ось ±n" — takes effect now;
  "НА <days>: <cause>: Ось ±n" — temporary, the code reverts it after <days> (crowds disperse, offices hire new clerks, rumours die down);
  "ЧЕРЕЗ <days>: <cause>: Ось ±n" — a delayed consequence (a harvest, depleted fishing grounds, lost income from sold domains);
  "ТРЕБОВАНИЕ: <actor>, <actor>" — a direct demand that requires an answer (ultimatum, summons to court, demand for troops or hostages); the actor answers within days;
  "УПРАЗДНИТЬ: <duke>" — a duke's house abolished by unification; "нет" — nothing shifted.
  n is 1 (noticeable), 2 (strong) or 3 (drastic). Calibration: one township's grievance 1; appointing a commoner or non-human over nobles 2; a new tax on the hungry 3; stripping a duke of his army 3; paying a whole year's tribute 3; admitting the dynasty's guilt in public 1.
  Record only decisions that took effect in play (an edict announced, taxes collected, troops paid, a treaty signed) and one-off events (a harvest, a lost battle, a disaster). Not plans, talk or rumours. Do NOT record the slow worsening of an unsolved problem (hunger goes on, a debt stays unpaid): the code accrues that by itself. Do not record again what is listed as already scheduled.
  HIDDEN COST — for every decision write its side effects as separate lines, not only its purpose. Ask: who loses money, rank, work or face; who is passed over or made to do work beneath them; how it looks to the hungry, to soldiers, to priests; what it does to trade, prices and roads; what it causes in 1–3 months (depletion, black market, imitation, flight). Examples: noble soldiers set to dig sewers → Статус·войско −2; a feast or fried delicacies shown in a famine → Статус·чернь −1; everyone catches octopus at once → "ЧЕРЕЗ 96: отмели выбраны: Достаток·чернь −1"; half the officials purged → "НА 64: канцелярии пусты: Порядок −2".
  Use ONLY these indicators:
${AXES_HELP}
- ЗА КАДРОМ: advance the agendas of absent characters and factions according to their goals and character, limited by the speed of couriers and marches.
- ДОСЬЕ: only characters who appeared in play or act off-screen. For each: Где, Состояние, Отношение к {{user}} (number and reason), Знает о {{user}}, Обещания и долги, Сейчас занят, Изменилось. Move the dead to a line "Выбыли". Characters know only what they saw or heard.
- СОСТОЯНИЕ holds only what {{user}} and the court know. Everything {{user}} does not know (true motives, hidden moves) goes to ТАЙНОЕ.

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
        const basePrompt = `ПРЕЖНЯЯ ЛЕТОПИСЬ:\n${sub(d.text)}\n\nНОВЫЕ СОБЫТИЯ ИГРЫ:\n${events}${staleNote}\n\nВыведи обновлённую Летопись целиком.`;
        const oldDay = parseDate(d.text) ?? SUMMON_DAY;
        const lore = await loreFor(`${d.text}\n${events}`);
        const systemPrompt = `${sub(CHRONICLER)}\n\n${timelineText(oldDay)}\n\nРЕАКЦИЯ МИРА (посчитано кодом на ${fmt(worldOf(d).lastDay)}):\n${reactionText(worldOf(d))}\n\nСПРАВКА ЛОРБУКА (истина мира; Летопись не может ей противоречить):\n${lore}`;
        // Одна попытка: запрос, разбор, эффекты, проверка стража. Возвращает готовую запись или причину отказа.
        const attempt = async (note) => {
            let result = await c.generateRaw({ prompt: basePrompt + note, systemPrompt, responseLength: 2400 });
            result = String(result ?? '').trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
            const effectsText = section(result, EFFECTS);
            result = stripEffects(result);
            if (!valid(result)) return { fail: 'format', raw: result };
            const newDay = parseDate(result);
            if (!d.stale && newDay !== null && newDay < oldDay) return { fail: 'date' };
            // Решения этой пачки сдвигают показатели в день новой записи; вести расходятся со скоростью курьера.
            const day = Math.max(newDay ?? oldDay, worldOf(d).lastDay);
            const world = cloneWorld(worldOf(d));
            const parsed = parseEffects(effectsText);
            if (parsed.unknown.length) console.warn('[Летопись] Неизвестные показатели отброшены:', parsed.unknown);
            applyEffects(world, parsed, day, delayOf, effectsText.slice(0, 300));
            advance(world, day);
            const early = earlyEvent(d.text, result, newDay ?? oldDay, world);
            if (early) return { fail: 'early', early, raw: result };
            return { result, world };
        };
        let got = await attempt('');
        // Отказ стража: один повтор с объяснением, что именно невозможно и почему.
        if (got.fail === 'early') {
            console.warn('[Летопись] Событие раньше, чем мир к нему пришёл:', got.early, got.raw);
            const e = got.early;
            got = await attempt(`\n\nПРОШЛЫЙ ВАРИАНТ ОТКЛОНЁН: «${e.name}» сейчас невозможно — ${e.why}.${e.line ? ` Строка: «${e.line}».` : ''} Перепиши Летопись: это событие не происходит; покажи вместо него текущую ступень (подготовку, слухи, переписку, сбор сил). Остальное сохрани.`);
        }
        if (got.fail) {
            if (got.fail === 'format') {
                console.warn('[Летопись] Ответ не прошёл проверку формата:', got.raw);
                toastr.warning('Летописец вернул запись в неверном формате. Прежняя Летопись сохранена; попробую при следующем обновлении.');
            } else if (got.fail === 'date') {
                toastr.warning('Летописец отмотал дату назад. Прежняя Летопись сохранена.');
            } else {
                console.warn('[Летопись] Повтор тоже отклонён:', got.early, got.raw);
                toastr.warning(`Летописец дважды запустил «${got.early.name}» раньше, чем мир к этому пришёл. Прежняя Летопись сохранена.`);
            }
            return;
        }
        let { result, world } = got;
        if (!d.stale) result = keepRegistry(d.text, result);
        snapshot(d);
        d.world = world;
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
    let body = section(sub(d.text), name) || '—';
    if (name === 'СОСТОЯНИЕ') { const reg = section(sub(d.text), REGISTRY); if (reg) body += '\n\nУСТАНОВЛЕНО\n' + reg; }
    if (name === 'ТАЙНОЕ') {
        const w = worldOf(d);
        const log = w.log.slice(-8).map(e => `${fmt(e.day)}: ${Object.entries(e.deltas).map(([k, v]) => `${k} ${v > 0 ? '+' : '−'}${Math.abs(v)}`).join('; ')}${e.remove.length ? ' · упразднены: ' + e.remove.join(', ') : ''}`);
        body += `\n\nРЕАКЦИЯ МИРА (на ${fmt(w.lastDay)})\n${reactionText(w)}${log.length ? '\n\nПОСЛЕДНИЕ СДВИГИ\n' + log.join('\n') : ''}`;
    }
    const when = d.updatedAt ? new Date(d.updatedAt).toLocaleString('ru-RU') : 'стартовое состояние';
    const html = `<h3 class="gr-chronicle-title">${title}</h3><div class="gr-chronicle-meta">Обновлено: ${when} · ответов до обновления: ${Math.max(0, settings().every - d.turns)}</div><pre class="gr-chronicle-view">${escapeHtml(body)}</pre>`;
    await ctx().callGenericPopup(html, ctx().POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
}

async function showSecrets() {
    const c = ctx();
    const ok = await c.callGenericPopup('<h3>Показать тайное?</h3><p>Здесь скрытые ходы персонажей, реакция сословий и соседей и то, чего ваш герой не знает. Это спойлеры к вашей же игре.</p>', c.POPUP_TYPE.CONFIRM, '', { okButton: 'Показать', cancelButton: 'Не надо' });
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
    if (prev.world) d.world = prev.world;
    if (typeof prev.lastIndex === 'number') d.lastIndex = Math.min(prev.lastIndex, ctx().chat.length - 1);
    await save();
    inject();
    toastr.success('Летопись откатилась на предыдущую версию.');
}

async function reset() {
    if (!isOurChat()) return;
    const c = ctx();
    const ok = await c.callGenericPopup('<h3>Сбросить Летопись?</h3><p>Состояние вернётся к моменту получения власти. Используйте только для новой игры.</p>', c.POPUP_TYPE.CONFIRM, '', { okButton: 'Сбросить', cancelButton: 'Отмена' });
    if (ok !== c.POPUP_RESULT.AFFIRMATIVE) return;
    c.chatMetadata[MODULE] = { text: INITIAL_STATE, turns: 0, lastIndex: c.chat.length - 1, updatedAt: null, history: [], world: freshWorld() };
    await save();
    inject();
    toastr.success('Летопись сброшена к моменту получения власти.');
}

function snapshot(d) {
    d.history.unshift({ text: d.text, at: d.updatedAt, lastIndex: d.lastIndex, world: cloneWorld(worldOf(d)) });
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
        if (h.world) d.world = h.world;
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
    cmd('chronicle-reset', reset, 'Сбросить Летопись к моменту получения власти (новая игра).');
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
