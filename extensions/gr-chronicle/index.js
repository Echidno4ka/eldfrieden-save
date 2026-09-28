// Летопись Эльфридена: безликий хронист, который ведёт состояние сюжета, досье и тайное, и тихо передаёт их рассказчику.
// Одно состояние мира — «колодец» — на все чаты игры: «Хроники» (живые сцены) и «Кабинет» (стратегия).
// Летописец разделён: Счётчик (дата, место, эффекты — часто и узко) и Хроникёр (текст Летописи — реже).
// Реакцию сословий, казну и отношения считает код; модели только объявляют события.
import { INITIAL_STATE } from './initial.js';
import { MERA } from './mera.data.js';
import { REACTION } from './reaction.data.js';
import { initWorld, parseEffects, applyEffects, advance, summary, cloneWorld } from './reaction.js';
import { PEOPLE } from './people.data.js';
import { peopleSummary } from './people.js';
import { ecoSummary, economyGuard, ecoLog } from './economy.js';
import { initAll, upgrade, commitBatch, advanceWorld } from './world.js';
import { newWell, replay, addBatch, removeFrom, beyondCheckpoint, pushText, loadWell, saveWell } from './well.js';

const MODULE = 'gr_chronicle';
const TAIL = MODULE + '_tail';      // короткое напоминание на глубине 0 — прямо перед ответом
const MODES = { 'Хроники Эльфридена': 'scene', 'Кабинет Эльфридена': 'strategy' };
const MODE_NAME = { scene: 'Хроники', strategy: 'Кабинет' };
const INJECT_DEPTH = 4;
const MAX_MESSAGES = 16;
const CHRONICLE_TOKENS = 4000;      // Летопись ~900 слов: у DeepSeek русский текст дороже в токенах, 2200 обрезало её
const ALREADY_BATCHES = 6;         // «уже учтено»: сколько последних пачек показывать Счётчику и стратегу
const ALREADY_LINES = 24;
const BRIDGE_FRESH_LINES = 8;       // новому чату — только последние строки журнала
const MAX_MESSAGE_CHARS = 2000;
const SECTIONS = ['СОСТОЯНИЕ', 'ДОСЬЕ', 'ТАЙНОЕ'];
const REGISTRY = 'УСТАНОВЛЕНО';
const EFFECTS = 'ЭФФЕКТЫ';
const MONEY = 'ДЕНЬГИ';

const GEO = `КАРТА (неизменна, сверяйся всегда):
— Эльфриден на юго-востоке Ландии. Столица Парнам в центре. Южнее Парнама Лес под защитой богов.
— Хлебные районы на юго-западе (бывшие земли Амидонии).
— Герцог Кармин (Георг) — Рандель, северо-запад, у амидонской границы. Сухопутная армия.
— Герцог Варгас (Кастор) — Город Красного Дракона, горы на севере. Воздушные силы.
— Герцогиня Уолтер (Экселл) — Лагуна-Сити, северо-восточное побережье. Флот.
— Крепость Альтомура у хребта Урсула, граница с Амидонией.
Расстояния между местами — только в днях пути и только по «Карте и путям» из «Меры мира» и по справке пути; размеры предметов можно в метрах. Не выдумывай новые города, замки и расстояния; не переноси персонажей и владения без события в сюжете.`;

// ---- Лорбук: каждый процесс получает свою часть ----
const LORE_BOOKS = [
    'ГР — Быт и культура', 'ГР — Военное дело', 'ГР — География', 'ГР — Государства', 'ГР — История',
    'ГР — Канон · узлы сюжета', 'ГР — Локации', 'ГР — Лор и магия', 'ГР — Персонажи · Амидония',
    'ГР — Персонажи · двор Парнама', 'ГР — Персонажи · Империя', 'ГР — Персонажи · правила',
    'ГР — Персонажи · прочие страны', 'ГР — Персонажи · скрытые таланты', 'ГР — Персонажи · три герцогства',
    'ГР — Политика', 'ГР — Расы', 'ГР — Экономика', 'ГР — Уклад мира', 'ГР — Мера мира',
];
// Хроникёр: карта, узлы канона, календарь и темп, устройство государства; плюс записи по ключам (персонажи, места).
const LORE_CHRONICLE = {
    books: ['ГР — География', 'ГР — Канон · узлы сюжета'],
    entries: ['Континентальный календарь', 'Время и темп игры', 'Сколько занимают дела', 'Вести и связь', 'Мера мира: правила чисел', 'Карта и пути', 'Скорости', 'Население', 'Государство: совет и канцелярия', 'Государство: финансы и подати', 'Государство: суд и провинции', 'Государство: армия, флот и небо', 'Государство: королевский дом', 'Как движутся дела', 'Безликие исполнители'],
    keywords: true, budget: 30000,
};
// Счётчик: только то, что нужно для дат, мест и сумм.
const LORE_COUNTER = {
    books: [],
    entries: ['Континентальный календарь', 'Время и темп игры', 'Сколько занимают дела', 'Мера мира: правила чисел', 'Карта и пути', 'Скорости', 'Цены и жалованье', 'Хозяйство и казна', 'Казна в деле', 'Дела короны', 'Государство: финансы и подати'],
    keywords: false, budget: 16000,
};

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

async function loreFor(scanText, preset) {
    const always = [], matched = [];
    for (const name of await bookNames()) {
        let book;
        try { book = await ctx().loadWorldInfo(name); } catch { continue; }
        if (!book?.entries) continue;
        for (const e of Object.values(book.entries)) {
            if (e.disable || !e.content) continue;
            const item = `[${name.replace('ГР — ', '')} · ${e.comment || (e.key || [])[0] || 'запись'}]\n${e.content.trim()}`;
            if (preset.books.includes(name) || preset.entries.includes(e.comment)) always.push(item);
            else if (preset.keywords && (e.key || []).some(k => keyMatches(k, scanText))) matched.push(item);
        }
    }
    const out = [];
    let size = 0;
    for (const item of [...always, ...matched]) {
        if (size + item.length > preset.budget) continue;
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
const journalLines = text => journal(text).split('\n').map(l => l.trim()).filter(Boolean);
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

// ---- «Реакция мира», «Отношения», «Хозяйство»: мир, задержки вестей ----
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
// Где персонаж сейчас (по досье Летописи) — туда и идут вести.
function personSeat(text, p) {
    const lines = section(String(text), 'ДОСЬЕ').split('\n');
    const i = lines.findIndex(l => !/^\s/.test(l) && p.aliases.some(a => l.toUpperCase().startsWith(a.toUpperCase())));
    if (i < 0) return p.seat;
    const where = lines.slice(i, i + 4).find(l => /Где:/.test(l)) || '';
    const low = where.toLowerCase();
    const place = MERA.places.find(pl => [pl.name, ...pl.aliases].some(a => a && low.includes(a.toLowerCase())));
    return place ? place.id : p.seat;
}
const seatsNow = text => Object.fromEntries(PEOPLE.people.map(p => [p.id, personSeat(text, p)]));
// Задержки вестей по местам персонажей на момент пачки (хранятся в пачке — пересчёт журнала даёт тот же мир).
const delaysOf = seats => ({ actor: delayOf, person: id => delayOf({ seat: seats?.[id] || PEOPLE.people.find(p => p.id === id).seat }) });
function peopleText(world) { return peopleSummary(world, fmt); }
function ecoText(world, full = true) { return ecoSummary(world, fmt, full); }
function reactionText(world, withScheduled = true) { return summary(world, fmt, withScheduled); }
// Что доносят двору о сословиях, герцогах и соседях: видимые дела, без чисел отношения.
function visibleReaction(world) {
    return REACTION.actors.filter(a => !world.removed.includes(a.id)).map(a => `${a.name}: ${a.ladder[world.stage[a.id].s]}`).join('\n');
}

function freshWorld() {
    const w = initWorld(SUMMON_DAY);
    advance(w, OPENING_DAY - 1);
    applyEffects(w, parseEffects(OPENING_EFFECTS), OPENING_DAY, delayOf, 'отречение Альберта и помолвка с Лисией');
    advance(w, OPENING_DAY);
    initAll(w, OPENING_DAY);
    return w;
}
function stripEffects(text) {
    return String(text).replace(new RegExp(`\\n?===\\s*${EFFECTS}\\s*===[\\s\\S]*?(?=\\n===\\s*[А-ЯЁ ]+\\s*===|$)`), '').trim();
}
const AXES_HELP = (() => {
    const R = REACTION;
    return `Общие: ${R.common.join(', ')} (Ресурсы — казна короны: её считает код по суммам, НЕ пиши Ресурсы сам; Сила — войска короны; Власть — сила трона над провинциями; Порядок — закон и спокойствие на дорогах и в городах; Устои — законность власти и верность обычаю).
По сословиям: ${R.groupAxes.join(', ')} · ${R.groups.join(' / ')}, пиши «Бремя·чернь» (Достаток — сыты и при деньгах; Бремя — подати и повинности; Статус — права, почёт, место при дворе).
Герцоги: Статус · ${R.dukes.join(' / ')}, пиши «Статус·Кармин».
Соседи: ${R.neighborAxes.join(', ')} · ${R.neighbors.join(' / ')}, пиши «Выгода·Империя» (Угроза — насколько Эльфриден угрожает этому соседу; Выгода — что сосед получает от Эльфридена).
Акторы для ТРЕБОВАНИЕ: ${R.actors.map(a => a.id).join(', ')}.`;
})();

const defaults = { every: 4, chronEvery: 8, stratChronEvery: 3, enabled: true };
let busy = false;

const ctx = () => SillyTavern.getContext();

function settings() {
    const all = ctx().extensionSettings;
    all[MODULE] = Object.assign({}, defaults, all[MODULE]);
    return all[MODULE];
}

function isOurChat() {
    const c = ctx();
    if (c.groupId || c.characterId === undefined) return false;
    return Boolean(MODES[c.name2]) || Boolean(c.chatMetadata?.[MODULE]);
}
const modeOf = () => MODES[ctx().name2] || 'scene';
const chatId = () => ctx().getCurrentChatId?.() || 'default';

function sub(text) {
    return ctx().substituteParams(text);
}

function section(text, name) {
    const re = new RegExp(`===\\s*${name}\\s*===\\s*\\n([\\s\\S]*?)(?=\\n===\\s*[А-ЯЁ ]+\\s*===|$)`);
    const m = String(text).match(re);
    return m ? m[1].trim() : '';
}
const withoutSecret = text => String(text).replace(/\n?===\s*ТАЙНОЕ\s*===[\s\S]*?(?=\n===\s*[А-ЯЁ ]+\s*===|$)/, '').trim();

// ---- колодец ----
// WELL.world — мир ровно на момент последней пачки (так пересчёт журнала совпадает с ним по определению).
// «Сегодня» для сводок и стражей — копия, дожитая до даты Летописи (view).
let WELL = null, loading = null, VIEW = null;
function view() {
    const day = currentDay();
    if (day <= WELL.world.lastDay) return WELL.world;
    if (VIEW && VIEW.base === WELL.world && VIEW.day === day) return VIEW.w;
    const w = cloneWorld(WELL.world);
    advanceWorld(w, day, delaysOf(seatsNow(WELL.text)));
    VIEW = { base: WELL.world, day, w };
    return w;
}

async function persist() {
    try { await saveWell(WELL, ctx().getRequestHeaders()); }
    catch (e) { console.error('[Летопись] колодец не сохранён', e); toastr.error(`Летопись: ${e.message}. Изменения живут до перезагрузки.`); }
}
// Старая Летопись, жившая в метаданных чата, переезжает в колодец (сам чат не трогаем).
function migrateOrNew() {
    const c = ctx();
    const meta = c.chatMetadata?.[MODULE];
    if (meta?.text && !meta.well) {
        const world = meta.world || freshWorld();
        upgrade(world);
        const w = newWell(meta.text, world);
        w.updatedAt = meta.updatedAt || null;
        w.chats[chatId()] = { mode: modeOf(), countIdx: meta.lastIndex ?? -1, chronIdx: meta.lastIndex ?? -1, seenDay: parseDate(meta.text) ?? OPENING_DAY, seenJournal: journalLines(meta.text), turns: meta.turns || 0, chronTurns: meta.turns || 0 };
        console.info('[Летопись] Летопись чата перенесена в общий колодец');
        return w;
    }
    return newWell(INITIAL_STATE, freshWorld());
}
const untouched = w => !w.batches.length && !w.history.length && w.checkpoint.n === 0 && w.text === INITIAL_STATE;
async function ensureWell() {
    if (WELL) return WELL;
    if (!loading) loading = (async () => {
        let w = await loadWell();
        const fresh = !w;
        if (!w) w = migrateOrNew();
        upgrade(w.world);
        WELL = w;
        if (fresh) await persist();
        return WELL;
    })();
    return loading;
}
const currentDay = () => parseDate(WELL.text) ?? OPENING_DAY;
const currentPlace = () => (String(WELL.text).match(/МЕСТО[^:\n]*:([^\n]*)/) || [])[1]?.trim() || '';

// Указатели чата в колодце: до какого сообщения учтено, какой день он видел в последний раз.
function state() {
    const c = ctx(), id = chatId();
    if (!WELL.chats[id]) {
        // Новый чат (только вступление), а мир уже ушёл от дня получения власти: вступление устарело — нужен мост.
        const fresh = c.chat.length <= 1 && currentDay() > OPENING_DAY;
        WELL.chats[id] = { mode: modeOf(), countIdx: c.chat.length - 1, chronIdx: c.chat.length - 1, seenDay: fresh ? OPENING_DAY : currentDay(), seenJournal: fresh ? [] : journalLines(WELL.text), turns: 0, chronTurns: 0, fresh };
    }
    const st = WELL.chats[id];
    st.mode = modeOf();
    return st;
}
function markChat() {
    const c = ctx();
    if (!c.chatMetadata[MODULE]?.well) {
        c.chatMetadata[MODULE] = Object.assign({}, c.chatMetadata[MODULE] || {}, { well: true });
        c.saveMetadata?.();
    }
}

// Зафиксировать пачку эффектов этого чата (после сообщения idx) в день `day`.
const lineKey = l => l.toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();
// Убрать из пачки пустые строки «решение: нет» и дословные повторы строк из недавних пачек (доклады их пересказывают).
function dropRepeats(text) {
    const seen = new Set(WELL.batches.slice(-ALREADY_BATCHES).flatMap(b => String(b.text).split('\n').map(lineKey)).filter(Boolean));
    const lines = String(text).split('\n').map(s => s.trim()).filter(Boolean);
    const kept = lines.filter(l => !/:\s*нет\.?$/i.test(l) && !seen.has(lineKey(l)) && !(lines.length > 1 && /^нет\.?$/i.test(l)));
    const dropped = lines.length - kept.length;
    if (dropped && !(lines.length === 1 && /^нет\.?$/i.test(lines[0]))) console.warn(`[Летопись] Отброшено строк-повторов и «: нет»: ${dropped}`);
    return kept.join('\n');
}
function commit(effectsText, day, idx) {
    const text = dropRepeats(String(effectsText || '').trim()).trim();
    if (!text || /^нет\.?$/i.test(text)) return null;       // время идёт в дате Летописи; мир доживёт его в view()
    const seats = seatsNow(WELL.text);
    const prev = { day: currentDay(), place: currentPlace() };   // что было до пачки — вернуть при откате
    const w = cloneWorld(WELL.world);
    upgrade(w);
    const r = commitBatch(w, text, day, delaysOf(seats), text.slice(0, 300));
    if (r.unknownAxes.length) console.warn('[Летопись] Неизвестные показатели отброшены:', r.unknownAxes);
    if (r.unknownEco.length) console.warn('[Летопись] Строки хозяйства не разобраны:', r.unknownEco);
    if (r.unknownPeople.length) console.warn('[Летопись] Строки отношений без известного персонажа или жеста:', r.unknownPeople);
    if (r.errors?.length) console.error('[Летопись] Часть эффектов не применена из-за ошибки модуля:', r.errors);
    if (r.repeats) console.warn(`[Летопись] Повторы уже учтённых решений не посчитаны: ${r.repeats}`);
    if (r.resourcesWritten) console.warn('[Летопись] «Ресурсы» вместо суммы — переведено в деньги по курсу «Меры мира».');
    WELL.world = w;
    VIEW = null;
    addBatch(WELL, { chat: chatId(), idx, day: w.lastDay, text, seats, prev }, delaysOf);
    return r;
}
// Дату и место ведёт Счётчик (или стратег); в тексте Летописи код правит их сам.
function setDatePlace(text, day, place) {
    let t = String(text).replace(/ДАТА:[^\n]*/, `ДАТА: ${fmt(day)} · прошло с призыва: ${day - SUMMON_DAY} дн.`);
    if (place) t = t.replace(/(МЕСТО[^:\n]*:)[^\n]*/, `$1 ${place}`);
    return t;
}
const placeLine = raw => (String(raw).match(/МЕСТО[^:\n]*:([^\n]*)/) || [])[1]?.trim() || '';

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

// ---- мост: чат давно не играли, мир ушёл вперёд ----
function bridge(st) {
    const now = currentDay();
    const seen = new Set(st.seenJournal || []);
    let lines = journalLines(WELL.text).filter(l => !seen.has(l));
    if (st.fresh) lines = lines.slice(-BRIDGE_FRESH_LINES);
    const parts = [];
    if (st.fresh && now > OPENING_DAY) parts.push(`Это новый чат. Его вступительное сообщение описывает день получения власти (${fmt(OPENING_DAY)}), но сейчас ${fmt(now)}: вступление устарело, не продолжай его время и не повторяй его доклады.`);
    else if (now > st.seenDay) parts.push(`С прошлой сцены в этом чате прошло ${now - st.seenDay} дн. (с ${fmt(st.seenDay)} по ${fmt(now)}).`);
    if (lines.length) parts.push(`Что случилось за это время (из Летописи):\n${lines.join('\n')}`);
    if (st.warn) parts.push(st.warn);
    if (!parts.length) return '';
    return `\n\n[МОСТ — мир ушёл вперёд, пока этот чат не играли. ${parts.join('\n')}\nНачни ответ уже в новом времени и месте: первой фразой обозначь, сколько прошло времени или какой сейчас день и пора. Решения, принятые до перерыва, всё это время исполнялись: показывай их ход или итог на сегодня, а не начало. Пропущенное не разыгрывай подробно.]`;
}

// Последние записанные эффекты (обоих чатов) — чтобы доклады и пропуски времени не записывали их второй раз.
function alreadyText() {
    const lines = [];
    for (const b of WELL.batches.slice(-ALREADY_BATCHES).reverse()) {
        for (const l of String(b.text).split('\n').map(s => s.trim()).filter(Boolean).reverse()) lines.push(`${fmt(b.day)} · ${l}`);
        if (lines.length >= ALREADY_LINES) break;
    }
    const body = lines.slice(0, ALREADY_LINES).reverse().join('\n') || '—';
    return `[УЖЕ УЧТЕНО — последние записанные эффекты обоих чатов; код их уже посчитал, не записывай их снова:]\n${body}`;
}

// Напоминание в конце сводки: поближе к ответу оно действует сильнее, чем в карточке.
const ANSWER_FORM = '[ФОРМА ОТВЕТА: ответ заканчивается действием, образом или репликой-утверждением. Не заканчивай вопросом к {{user}}, выбором вариантов или приглашением действовать. Без оборотов «не X, а Y».]';
const STRAT_TAIL = '[ОБЯЗАТЕЛЬНО: в самом конце ответа — служебный блок: строка «=== ЭФФЕКТЫ ===», затем ДАТА, МЕСТО {{user}} и строки эффектов по правилам из сводки (или «нет»). Деньги — строками КАЗНА / СОКРОВИЩНИЦА / ДЕЛО с числом в G. Без блока ответ не засчитается.]';

// ---- правила эффектов (общие для Счётчика и стратега) ----
const EFFECT_RULES = `EFFECTS — how the decisions and one-off events shifted the country's abstract indicators. Indicators run −10…+10, 0 is normal. Line formats:
  "<short cause>: Ось ±n; Ось ±n" — takes effect now;
  "НА <days>: <cause>: Ось ±n" — temporary, the code reverts it after <days> (crowds disperse, offices hire new clerks, rumours die down);
  "ЧЕРЕЗ <days>: <cause>: Ось ±n" — a delayed consequence (a harvest, depleted fishing grounds);
  "ТРЕБОВАНИЕ: <actor>, <actor>" — a direct demand that requires an answer (ultimatum, summons to court, demand for troops or hostages); the actor answers within days;
  "УПРАЗДНИТЬ: <duke>" — a duke's house abolished by unification; "нет" — nothing shifted.
  n is 1 (noticeable), 2 (strong) or 3 (drastic). Calibration: one township's grievance 1; appointing a commoner or non-human over nobles 2; a new tax on the hungry 3; stripping a duke of his army 3; paying a whole year's tribute 3; admitting the dynasty's guilt in public 1.
  Record only decisions that took effect in play (an edict announced, taxes collected, troops paid, a treaty signed) and one-off events (a harvest, a lost battle, a disaster). Not plans, talk or rumours. Do NOT record the slow worsening of an unsolved problem (hunger goes on, a debt stays unpaid): the code accrues that by itself. Do not record again what is listed as already scheduled.
  An order of the ruler takes effect when it is given: record it in the same reply (money moves at once; the code handles delivery and timing). Never write "<decision>: нет" — "нет" is the whole section and only when nothing at all shifted; every decision that was made has effect lines.
  ONCE ONLY: every decision and event is recorded once, in the reply where it happened. Reports, reminders, summaries and time skips do NOT repeat lines already listed in «УЖЕ УЧТЕНО» or decisions made earlier; write only what is new (what happened during the skipped time, a new decision). The proceeds of a СОКРОВИЩНИЦА sale are credited by the code — never add them as КАЗНА. An enterprise already listed in ХОЗЯЙСТВО is never started again, and its setup cost is charged by the code — do not add КАЗНА for it.
  HIDDEN COST — for every decision write its side effects as separate lines, not only its purpose. Ask: who loses money, rank, work or face; who is passed over or made to do work beneath them; how it looks to the hungry, to soldiers, to priests; what it does to trade, prices and roads; what it causes in 1–3 months (depletion, black market, imitation, flight). Examples: noble soldiers set to dig sewers → Статус·войско −2; a feast or fried delicacies shown in a famine → Статус·чернь −1; everyone catches octopus at once → "ЧЕРЕЗ 96: отмели выбраны: Достаток·чернь −1"; half the officials purged → "НА 64: канцелярии пусты: Порядок −2".
  Use ONLY these indicators:
${AXES_HELP}
MONEY (section "ХОЗЯЙСТВО", computed by code). Never write "Ресурсы ±n" — the treasury sets it. A money line STARTS with its keyword and always has a number: "КАЗНА: −3 000 000 G — хлеб из Зема", never "<cause>: Казна: …" and never "+… G". Write sums in G derived from «Мера мира» (wages, prices, «Казна в деле», «Дела короны»):
  "КАЗНА: ±N G — <why>" (one-off income or spending); "СОКРОВИЩНИЦА: продать треть | N%" (treasures into money, forever; a NEW sale after an earlier one must say so: "СОКРОВИЩНИЦА: продать ещё N%"); "ЕЖЕМЕСЯЧНО: ±N G — <name>" (a standing item; "0 G — <name>" cancels it); "ДОЛГ: −N G — <whom>" or "ДОЛГ: погасить" (the Empire's tribute); "ДОЛГ ВОЙСКУ: выплатить" (pay the army's arrears);
  "ДЕЛО: <name> · <ремесло|мануфактура|промысел|торговля> · <малое|среднее|большое> · сбыт: <знать, города, Зем, Амидония, Империя, Тургис, Лунария, Союз>" (the crown starts an enterprise; the code computes cost, time, output and sales); "ДЕЛО ЗАКРЫТЬ: <name>".
  Taxes (Бремя·чернь), famine and disorder change the crown's income by themselves. An enterprise sells nothing before the date in ХОЗЯЙСТВО.
PEOPLE (computed by code): for the tracked characters add lines whenever the events touched them personally: "<name>: Доверие ±n; Приязнь ±n — <reason>". Доверие = do they believe in {{user}}'s rule (competence, fairness, respect for their office and people); Приязнь = personal feeling. They can move apart: a humiliated but competent ruler loses Приязнь, not Доверие. n is 1 (a word, a small favour or slight), 2 (a real service, a public slight, a broken promise), 3 (saving a life or honour, a betrayal, a humiliation before everyone). The effects of national policy on them are counted by the code from their interests; do not duplicate them. Write "ЗНАКОМСТВО: <name>" when {{user}} meets a tracked character for the first time. "ТРЕБОВАНИЕ: <name>" also works for tracked characters. Tracked: ${PEOPLE.people.map(p => p.name).join(', ')}.
  GESTURES — small signs of attention: "ЖЕСТ: <name> · <kind>[ · <what>][ · <sum> G][ · наедине] — <what happened>", kinds: комплимент, флирт, подарок, внимание (time, talk, care), совет (asking their advice), дело (helping their cause or people). Example: "ЖЕСТ: Томоэ · подарок · сладости · 300 G — купил на рынке". The code weighs them by tastes, by the gift's price against rank, and repeated gestures count less; do not add Доверие/Приязнь for the same gesture. "наедине" = nobody else saw it. Влечение (romance) exists only for adults free for romance in canon; write "<name>: Влечение ±n — reason" only for big romantic turns. Tomoe is a child: no romance, no flirting, ever.`;

const TIME_RULES = `TIME (most important)
- Advance ДАТА only by the time that actually passed. A normal scene is minutes or hours. Days pass only when the events show travel, sleep, waiting or an explicit time skip by the player.
- Use "Время и темп игры" and "Сколько занимают дела": a task that takes days is not finished before those days have passed.
- ДАТА never goes backwards. Calendar: week 8 days, month 32 days, year 12 months.`;

// Счётчик: дата, место, эффекты — часто и узко.
const COUNTER = `You are the Counter of a role-play set in the world of the light novel "How a Realist Hero Rebuilt the Kingdom" (Elfrieden, Landia, 1546). You are not the narrator and not a character. From the new game events you output ONLY this, in Russian, nothing else:
ДАТА: <year> г., <month>-й месяц, <day>-й день
МЕСТО {{user}}: <where {{user}} is now>
=== ДЕНЬГИ ===
<every movement of the crown's money in the new events, one line each: an order to spend or buy → "КАЗНА: −N G — what"; income → "КАЗНА: +N G — from what"; selling the royal treasures → "СОКРОВИЩНИЦА: продать треть" (the code credits the money); a standing expense → "ЕЖЕМЕСЯЧНО: …"; tribute → "ДОЛГ: …"; a crown enterprise → "ДЕЛО: …". If the ruler ordered a sale or a purchase, the line is here even if the goods are not delivered yet. "нет" only if no money moved or was committed.>
=== ЭФФЕКТЫ ===
<the other effects, one per line, or "нет">

${TIME_RULES}
- Distances and travel times: only from "Карта и пути" / "Скорости". Sums: only derived from «Мера мира».

${EFFECT_RULES}

${GEO}`;

// Хроникёр: текст Летописи — реже, с лором персонажей.
const CHRONICLE = `You are the Chronicler: a faceless bookkeeper of a role-play set in the world of the light novel "How a Realist Hero Rebuilt the Kingdom" (Elfrieden, Landia, year 1546). You are not the narrator and not a character. You keep an exact record of the world state.

TASK: take the previous Chronicle and the new game events; output the full updated Chronicle.

OUTPUT FORMAT
- Output ONLY the Chronicle, in Russian, in exactly the same format with the same sections: === СОСТОЯНИЕ ===, === ДОСЬЕ ===, === ТАЙНОЕ ===, and last === УСТАНОВЛЕНО ===. No explanations, no prose, no dialogue, no preamble. Do NOT write effects: another process (the Counter) keeps them.
- ДАТА and МЕСТО are kept by the code: copy those two lines exactly as they are in the previous Chronicle.
- Keep the whole Chronicle under 900 words. Write every number (sums, troops, distances) once, in the most fitting section; money of the crown lives in section ХОЗЯЙСТВО (computed by code) — do not copy it.
- ЖУРНАЛ: one short dated line per significant event; keep the last 15 lines, compress older ones into "Ранее: …".
- УСТАНОВЛЕНО: the registry of facts first stated in play — new people (name, role), new places (with a distance to the nearest known place), sums, prices, numbered promises. One line per fact. Never delete or rephrase a line (the code restores deleted lines); if play explicitly retcons a fact, add a new line "Исправлено: …".

FACTS
- Never invent. Every fact about a person, place, distance, date, title, name or sum comes from the LORE REFERENCE (section "СПРАВКА ЛОРБУКА") or from the game events. If there is no source, omit it or write "неизвестно".
- WHO DOES WHAT: routine work is done by faceless executors of the responsible office (entries "Государство: …" and "Как движутся дела"); named characters only decide, receive reports, or act when the matter needs their authority.
- A character learns news only when a courier could physically have brought it (see "Вести и связь").
- The game has two chats that share this Chronicle: «Хроники» (scenes) and «Кабинет» (strategy). Events from the other chat are already in the Chronicle — keep them.
- If the previous Chronicle contradicts the reference or the latest game events of this chat, correct it.

WORLD STATE
- Reforms move through стадии: идея → принята → внедряется N% → действует; they need money, people and time and have opponents.
- Natural and foreign events follow the TIMELINE (section "ТАЙМЛАЙН КАНОНА"); an event marked ЗАБЛОКИРОВАНО cannot happen before its date.
- WORLD REACTION (section "РЕАКЦИЯ МИРА") is computed by code: never write moods of the commoners, clergy, nobility, army, dukes or neighbours yourself, and never record in ЖУРНАЛ or ЗА КАДРОМ an action above an actor's current stage (no revolt, rebellion, invasion or ultimatum unless its stage has been reached). Show the current stage off-screen when it fits.
- ЗА КАДРОМ: advance the agendas of absent characters and factions according to their goals and character, limited by the speed of couriers and marches. The deeds of tracked characters follow their grades in ОТНОШЕНИЯ (a hostile one works against {{user}} by the means of his office and nature, a loyal one helps).
- ДОСЬЕ: only characters who appeared in play or act off-screen. For each: Где (a named place when possible — news reach characters there), Состояние, Отношение к {{user}}, Знает о {{user}}, Обещания и долги, Сейчас занят, Изменилось. For the tracked characters listed in section "ОТНОШЕНИЯ" do NOT write numbers or grades of their attitude: the code keeps them; write only the facts. For other characters write Отношение к {{user}} as a number −5…+5 with the reason. Move the dead to a line "Выбыли". Characters know only what they saw or heard.
- СОСТОЯНИЕ holds only what {{user}} and the court know. Everything {{user}} does not know (true motives, hidden moves) goes to ТАЙНОЕ.

${GEO}`;

// Правила для стратега: служебный блок в конце каждого ответа (код его вырежет).
const STRAT_EFFECTS = `[СЛУЖЕБНЫЙ БЛОК — в самом конце КАЖДОГО ответа, после текста, добавь блок; код вырежет его до того, как игрок увидит ответ:
=== ЭФФЕКТЫ ===
ДАТА: <год> г., <месяц>-й месяц, <день>-й день — дата на конец твоего ответа (время идёт вперёд так, как прошло в ответе; пропуск недель — только если его объявил игрок или его требуют дела)
МЕСТО {{user}}: <где {{user}} сейчас>
<сначала деньги — каждая трата, покупка, доход, продажа сокровищ, новое дело короны, по строке: «КАЗНА: −N G — что», «СОКРОВИЩНИЦА: продать треть», «ДЕЛО: …»; приказ купить или продать — строка сразу, даже если товар ещё в пути>
<затем остальные строки эффектов; если ничего не сдвинулось — одно слово «нет»>
${EFFECT_RULES}]`;

async function generate(prompt, systemPrompt, responseLength) {
    const raw = await ctx().generateRaw({ prompt, systemPrompt, responseLength });
    return String(raw ?? '').trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
}
function transcript(fromIndex, toIndex = null) {
    const c = ctx();
    const end = toIndex == null ? c.chat.length : toIndex + 1;
    const start = Math.max(fromIndex + 1, end - MAX_MESSAGES);
    return c.chat.slice(start, end)
        .filter(m => !m.is_system && m.mes)
        .map(m => `${m.name}: ${m.mes.length > MAX_MESSAGE_CHARS ? m.mes.slice(0, MAX_MESSAGE_CHARS) + '…' : m.mes}`)
        .join('\n\n');
}
const staleNote = '\n\nВНИМАНИЕ: прежняя Летопись могла забежать вперёд — игрок удалил или переиграл часть сообщений этого чата. Истина — СОБЫТИЯ ИГРЫ ниже и события другого чата, уже записанные в Летописи. Убери из Летописи то, что было только в удалённых сообщениях этого чата.';

// ---- Счётчик ----
async function count({ manual = false } = {}) {
    const c = ctx(), st = state();
    const events = transcript(st.countIdx);
    if (!events.trim()) { if (manual) toastr.info('Нет новых событий для счёта.'); return false; }
    const w = view();
    const oldDay = currentDay();
    const lore = await loreFor(`${section(WELL.text, 'СОСТОЯНИЕ')}\n${events}`, LORE_COUNTER);
    const systemPrompt = `${sub(COUNTER)}\n\n${timelineText(oldDay)}\n\nРЕАКЦИЯ МИРА (посчитано кодом):\n${reactionText(w)}\n\nОТНОШЕНИЯ (посчитано кодом):\n${peopleText(w)}\n\nХОЗЯЙСТВО (посчитано кодом):\n${ecoText(w)}\n\n${alreadyText()}\n\nСПРАВКА ЛОРБУКА:\n${lore}`;
    const prompt = `ТЕКУЩЕЕ СОСТОЯНИЕ (из Летописи):\n${sub(section(WELL.text, 'СОСТОЯНИЕ'))}\n\nУСТАНОВЛЕНО:\n${sub(section(WELL.text, REGISTRY)) || '—'}\n\nНОВЫЕ СОБЫТИЯ ИГРЫ:\n${events}${st.stale ? staleNote : ''}\n\nВыведи ДАТА, МЕСТО и ЭФФЕКТЫ.`;
    const raw = await generate(prompt, systemPrompt, 900);
    // Деньги — отдельным разделом: слабые модели иначе пишут одни настроения и забывают суммы.
    const effects = [section(raw, MONEY), section(raw, EFFECTS) || (raw.split(/===\s*ЭФФЕКТЫ\s*===/)[1] || '').trim()]
        .map(s => String(s || '').trim()).filter(s => s && !/^нет\.?$/i.test(s)).join('\n');
    let day = parseDate(raw) ?? oldDay;
    if (day < oldDay) day = oldDay;                    // время только вперёд
    commit(effects, day, c.chat.length - 1);
    WELL.text = setDatePlace(WELL.text, Math.max(day, WELL.world.lastDay), placeLine(raw));
    st.countIdx = c.chat.length - 1;
    st.turns = 0;
    return true;
}

// ---- Хроникёр ----
async function chronicle({ manual = false } = {}) {
    const c = ctx(), st = state();
    const events = transcript(st.chronIdx);
    if (!events.trim()) { if (manual) toastr.info('Нет новых событий для Летописи.'); return false; }
    const w = view();
    const day = currentDay(), place = currentPlace();
    const lore = await loreFor(`${WELL.text}\n${events}`, LORE_CHRONICLE);
    const basePrompt = `ПРЕЖНЯЯ ЛЕТОПИСЬ:\n${sub(WELL.text)}\n\nНОВЫЕ СОБЫТИЯ ИГРЫ (чат «${MODE_NAME[st.mode]}»):\n${events}${st.stale ? staleNote : ''}\n\nВыведи обновлённую Летопись целиком.`;
    const systemPrompt = `${sub(CHRONICLE)}\n\n${timelineText(day)}\n\nРЕАКЦИЯ МИРА (посчитано кодом на ${fmt(w.lastDay)}):\n${reactionText(w)}\n\nОТНОШЕНИЯ (посчитано кодом):\n${peopleText(w)}\n\nХОЗЯЙСТВО (посчитано кодом):\n${ecoText(w)}\n\nСПРАВКА ЛОРБУКА (истина мира; Летопись не может ей противоречить):\n${lore}`;
    const attempt = async (note) => {
        let result = await generate(basePrompt + note, systemPrompt, CHRONICLE_TOKENS);
        if (section(result, EFFECTS)) console.warn('[Летопись] Хроникёр написал эффекты — их ведёт Счётчик, отброшено.');
        result = stripEffects(result);
        if (!valid(result)) return { fail: 'format', raw: result };
        result = setDatePlace(result, day, place);
        const oldSet = new Set(journalLines(WELL.text));
        const newLines = journalLines(result).filter(l => !oldSet.has(l) && !/^Ранее/i.test(l));
        const early = earlyEvent(WELL.text, result, day, w) || economyGuard(w, newLines, day, fmt);
        if (early) return { fail: 'early', early, raw: result };
        return { result };
    };
    let got = await attempt('');
    if (got.fail === 'early') {
        console.warn('[Летопись] Событие раньше, чем мир к нему пришёл:', got.early, got.raw);
        const e = got.early;
        got = await attempt(`\n\nПРОШЛЫЙ ВАРИАНТ ОТКЛОНЁН: «${e.name}» сейчас невозможно — ${e.why}.${e.line ? ` Строка: «${e.line}».` : ''} Перепиши Летопись: это событие не происходит; покажи вместо него текущую ступень (подготовку, слухи, переписку, сбор сил). Остальное сохрани.`);
    }
    if (got.fail) {
        if (got.fail === 'format') { console.warn('[Летопись] Ответ не прошёл проверку формата:', got.raw); toastr.warning('Летописец вернул запись в неверном формате. Прежняя Летопись сохранена; попробую при следующем обновлении.'); }
        else { console.warn('[Летопись] Повтор тоже отклонён:', got.early, got.raw); toastr.warning(`Летописец дважды запустил «${got.early.name}» раньше, чем мир к этому пришёл. Прежняя Летопись сохранена.`); }
        return false;
    }
    let result = got.result;
    if (!st.stale) result = keepRegistry(WELL.text, result);
    pushText(WELL, { text: WELL.text, at: WELL.updatedAt, chat: chatId(), idx: c.chat.length - 1, seq: WELL.seq });
    WELL.text = result;
    WELL.updatedAt = new Date().toISOString();
    st.chronIdx = c.chat.length - 1;
    st.chronTurns = 0;
    st.stale = false;
    return true;
}

// Одна очередь: Счётчик, затем (если пора) Хроникёр.
async function runCycle({ manual = false, counter = true, chron = false } = {}) {
    if (!isOurChat()) { toastr.info('Летопись ведётся только в чатах «Хроники Эльфридена» и «Кабинет Эльфридена».'); return; }
    if (busy) { if (manual) toastr.info('Летопись уже обновляется.'); return; }
    await ensureWell();
    busy = true;
    const toast = toastr.info('Летописец обновляет записи…', '', { timeOut: 0, extendedTimeOut: 0 });
    try {
        if (counter) await count({ manual });
        if (chron) await chronicle({ manual });
        // Свои события этот чат знает из собственной истории — мост ему не нужен (он для другого чата).
        const st = state();
        st.seenDay = currentDay();
        st.seenJournal = journalLines(WELL.text);
        st.fresh = false;
        await persist();
        inject();
        if (manual) toastr.success('Летопись обновлена.');
    } catch (err) {
        console.error('[Летопись] Ошибка обновления', err);
        toastr.error(`Летопись не обновлена: ${err?.message || err}. Проверьте подключение к модели.`);
    } finally {
        busy = false;
        toastr.clear(toast);
    }
}

// ---- стратег: служебный блок в конце ответа ----
function extractBlock(mes) {
    const m = String(mes).match(/\n?\s*===\s*ЭФФЕКТЫ\s*===\s*\n?([\s\S]*)$/);
    if (!m) return null;
    const body = m[1];
    const effects = body.split('\n').filter(l => !/^\s*(ДАТА|МЕСТО)[^:\n]*:/.test(l)).join('\n').trim();
    return { clean: String(mes).slice(0, m.index).trim(), effects, day: parseDate(body), place: placeLine(body) };
}
async function onStrategyReply(index) {
    const c = ctx(), st = state();
    const msg = c.chat[index];
    const swipe = msg.swipe_id ?? 0;
    let fx = extractBlock(msg.mes);
    if (fx) {
        // Вырезать блок из показанного ответа, сохранить его при сообщении (для свайпов туда-обратно).
        msg.mes = fx.clean;
        if (Array.isArray(msg.swipes)) msg.swipes[swipe] = fx.clean;
        msg.extra = msg.extra || {};
        msg.extra.gr_fx = Object.assign({}, msg.extra.gr_fx, { [swipe]: { effects: fx.effects, day: fx.day, place: fx.place } });
        // Без стриминга сообщение ещё не отрисовано (MESSAGE_RECEIVED идёт до отрисовки) — Таверна сама покажет очищенный текст.
        if (globalThis.document?.querySelector(`#chat .mes[mesid="${index}"]`)) {
            try { c.updateMessageBlock?.(index, msg); } catch (e) { console.warn('[Летопись] не удалось перерисовать сообщение', e); }
        }
        await c.saveChat?.();
    } else if (msg.extra?.gr_fx?.[swipe]) {
        fx = msg.extra.gr_fx[swipe];
    }
    if (!fx) { await runCycle({ counter: true }); return; }       // стратег забыл блок — посчитает Счётчик
    let day = fx.day ?? currentDay();
    if (day < currentDay()) day = currentDay();
    commit(fx.effects, day, index);
    WELL.text = setDatePlace(WELL.text, Math.max(day, WELL.world.lastDay), fx.place);
    st.countIdx = index;
}

// ---- рассказчику ----
function inject() {
    const c = ctx();
    if (!WELL || !isOurChat() || !settings().enabled) {
        c.setExtensionPrompt(MODULE, '', 1, INJECT_DEPTH);
        c.setExtensionPrompt(TAIL, '', 1, 0);
        return;
    }
    const st = state();
    const w = view();
    let prompt;
    if (st.mode === 'strategy') {
        prompt = `[КАБИНЕТ — служебная сводка для ведущего стратегической партии. Это то, что знает двор: Летопись без тайного, казна, донесения о настроениях сословий, герцогов и соседей. Ты говоришь голосом совета, канцелярии, донесений и советников. Время идёт так, как решает игрок и как требуют дела: доклады приходят с задержкой гонца, дела занимают свои дни. Числа — только из сводок ниже. Не упоминай Летопись и сводки в ответе. Не пиши за {{user}}.]\n${GEO}\n\n${timelineText(currentDay())}\n\n${sub(withoutSecret(WELL.text))}\n\n${travelNote(WELL.text)}\n\n[ЧТО ДОНОСЯТ ДВОРУ — видимые дела сословий, герцогов и соседей:]\n${visibleReaction(w)}\n\n[ХОЗЯЙСТВО — казна и дела короны, посчитано кодом:]\n${ecoText(w, true)}\n\n${alreadyText()}${bridge(st)}\n\n${sub(STRAT_EFFECTS)}`;
    } else {
        prompt = `[ЛЕТОПИСЬ — служебная сводка ведущего для рассказчика. Это истинное текущее состояние мира. Досье важнее стартовых карточек персонажей. Раздел ТАЙНОЕ знает только рассказчик: используй его для предвестий и действий за кадром, но не раскрывай напрямую. Никогда не цитируй и не упоминай Летопись в ответе. Не пересказывай ТАЙНОЕ и сводку устами персонажей: не больше одного предвестия за сцену, NPC не зачитывают списки угроз. Если Летопись расходится с картой ниже, верна карта. Летопись — фон, а не сценарий: всё из ЖУРНАЛА уже произошло и уже показано. Не разыгрывай это заново, не повторяй цифры и доклады; продолжай сцену с последнего сообщения игрока.${st.stale ? ' Летопись сейчас может опережать чат (игрок удалил или переиграл сообщения): если она расходится с чатом, верен чат.' : ''}]\n${GEO}\n\n${timelineText(currentDay())}\nСобытия со статусом ЗАБЛОКИРОВАНО не происходят и не упоминаются как текущие. Раздел УСТАНОВЛЕНО — закреплённые факты игры: имена, места, суммы, цены; повторяй их точно.\n\n${sub(WELL.text)}\n\n${travelNote(WELL.text)}\n\n[РЕАКЦИЯ МИРА — посчитано кодом по показателям страны; тайное, персонажи знают только то, что видели сами. Сословия, герцоги и соседи ведут себя по своей текущей ступени: её проявления уместны в сцене и за кадром, но ничего выше текущей ступени не происходит. Смена ступени — дело недель и месяцев, не одной сцены.]\n${reactionText(w, false)}\n\n[ОТНОШЕНИЯ — посчитано кодом. «Дело» — насколько персонаж верит в правление {{user}} и как работает на {{user}} или против; «лично» — его чувства к {{user}}. Поступки персонажа следуют этим ступеням, а средства и манеру выбирай по его характеру, положению и возможностям из лорбука: кто-то действует открыто, кто-то тихо. Дело и лично могут расходиться. Ступень меняется за дни и недели; одна сцена сдвигает не больше чем на ступень. Незнакомые судят о {{user}} по слухам. Влечение есть только у взрослых, с кем возможен роман; ребёнка никто не обхаживает.]\n${peopleText(w)}\n\n[ХОЗЯЙСТВО — казна и дела короны, посчитано кодом. Суммы и сроки бери отсюда, не выдумывай; товар дела не продаётся раньше, чем сделан и довезён.]\n${ecoText(w, false)}${bridge(st)}`;
    }
    c.setExtensionPrompt(MODULE, prompt, 1, INJECT_DEPTH, false, 0);
    // Короткое напоминание прямо перед ответом: слабые модели забывают правила из глубины сводки.
    c.setExtensionPrompt(TAIL, st.mode === 'strategy' ? `${sub(STRAT_TAIL)}\n${ANSWER_FORM}` : ANSWER_FORM, 1, 0, false, 0);
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function show(name, title) {
    if (!isOurChat()) { toastr.info('Летопись ведётся только в чатах «Хроники Эльфридена» и «Кабинет Эльфридена».'); return; }
    await ensureWell();
    const st = state();
    let body = section(sub(WELL.text), name) || '—';
    if (name === 'СОСТОЯНИЕ') {
        const reg = section(sub(WELL.text), REGISTRY); if (reg) body += '\n\nУСТАНОВЛЕНО\n' + reg;
        body += `\n\nХОЗЯЙСТВО\n${ecoText(view())}`;
    }
    if (name === 'ТАЙНОЕ') {
        const w = view();
        body += `\n\nОТНОШЕНИЯ (дело · лично · влечение)\n${peopleText(w)}`;
        const ledger = ecoLog(w).slice(-10).map(e => `— ${fmt(e.day)}: ${e.text}`);
        if (ledger.length) body += `\n\nПОСЛЕДНИЕ ДВИЖЕНИЯ КАЗНЫ\n${ledger.join('\n')}`;
        const log = w.log.slice(-8).map(e => `${fmt(e.day)}: ${Object.entries(e.deltas).map(([k, v]) => `${k} ${v > 0 ? '+' : '−'}${Math.abs(v)}`).join('; ')}${e.remove.length ? ' · упразднены: ' + e.remove.join(', ') : ''}`);
        body += `\n\nРЕАКЦИЯ МИРА (на ${fmt(w.lastDay)})\n${reactionText(w)}${log.length ? '\n\nПОСЛЕДНИЕ СДВИГИ\n' + log.join('\n') : ''}`;
    }
    const s = settings();
    const when = WELL.updatedAt ? new Date(WELL.updatedAt).toLocaleString('ru-RU') : 'стартовое состояние';
    const next = st.mode === 'strategy'
        ? `чат «Кабинет»: эффекты — каждый ответ, Летопись — через ${Math.max(0, s.stratChronEvery - (st.chronTurns || 0))}`
        : `чат «Хроники»: счёт — через ${Math.max(0, s.every - (st.turns || 0))}, Летопись — через ${Math.max(0, s.chronEvery - (st.chronTurns || 0))}`;
    const html = `<h3 class="gr-chronicle-title">${title}</h3><div class="gr-chronicle-meta">Обновлено: ${when} · ${next} ответов</div><pre class="gr-chronicle-view">${escapeHtml(body)}</pre>`;
    await ctx().callGenericPopup(html, ctx().POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
}

async function showSecrets() {
    const c = ctx();
    const ok = await c.callGenericPopup('<h3>Показать тайное?</h3><p>Здесь скрытые ходы персонажей, их истинное отношение к герою, реакция сословий и соседей и то, чего ваш герой не знает. Это спойлеры к вашей же игре.</p>', c.POPUP_TYPE.CONFIRM, '', { okButton: 'Показать', cancelButton: 'Не надо' });
    if (ok === c.POPUP_RESULT.AFFIRMATIVE) await show('ТАЙНОЕ', 'Тайное');
}

async function edit() {
    if (!isOurChat()) return;
    await ensureWell();
    const c = ctx();
    const value = await c.callGenericPopup('<h3>Правка Летописи</h3><p>Сохраните разделы с заголовками === СОСТОЯНИЕ ===, === ДОСЬЕ ===, === ТАЙНОЕ ===. Летопись общая для «Хроник» и «Кабинета».</p>', c.POPUP_TYPE.INPUT, WELL.text, { rows: 25, wide: true, large: true, okButton: 'Сохранить', cancelButton: 'Отмена' });
    if (typeof value !== 'string' || value === WELL.text) return;
    if (!valid(value)) { toastr.error('Не сохранено: не хватает одного из разделов или строки ДАТА.'); return; }
    pushText(WELL, { text: WELL.text, at: WELL.updatedAt, chat: chatId(), idx: c.chat.length - 1, seq: WELL.seq });
    WELL.text = value;
    WELL.updatedAt = new Date().toISOString();
    await persist();
    inject();
    toastr.success('Летопись сохранена.');
}

// Откатить последнюю версию текста Летописи и пачки этого чата, сделанные после неё.
async function undo() {
    if (!isOurChat()) return;
    await ensureWell();
    const prev = WELL.history.shift();
    if (!prev) { toastr.info('Откатывать некуда.'); return; }
    WELL.text = prev.text;
    WELL.updatedAt = prev.at;
    const id = chatId();
    const before = WELL.batches.length;
    WELL.batches = WELL.batches.filter(b => !(b.chat === id && b.n > prev.seq));
    if (WELL.batches.length !== before) { WELL.world = replay(WELL, delaysOf, null); VIEW = null; }
    const st = state();
    st.countIdx = Math.min(st.countIdx, prev.idx);
    st.chronIdx = Math.min(st.chronIdx, prev.idx);
    await persist();
    inject();
    toastr.success('Летопись откатилась на предыдущую версию.');
}

async function reset() {
    if (!isOurChat()) return;
    const c = ctx();
    const ok = await c.callGenericPopup('<h3>Сбросить Летопись?</h3><p>Общее состояние мира вернётся к моменту получения власти — для обоих чатов («Хроники» и «Кабинет»). Используйте только для новой игры.</p>', c.POPUP_TYPE.CONFIRM, '', { okButton: 'Сбросить', cancelButton: 'Отмена' });
    if (ok !== c.POPUP_RESULT.AFFIRMATIVE) return;
    WELL = newWell(INITIAL_STATE, freshWorld());
    VIEW = null;
    loading = Promise.resolve(WELL);
    state();
    await persist();
    inject();
    toastr.success('Летопись сброшена к моменту получения власти.');
}

// Летопись не должна знать о сообщениях этого чата, которых больше нет. Пачки других чатов не трогаем.
// limit — индекс первого изменённого сообщения (или длина чата после удаления).
async function rewind(limit) {
    if (!isOurChat() || !WELL) return;
    const st = state(), id = chatId();
    if (st.countIdx < limit && st.chronIdx < limit) return;
    const { removed, others } = removeFrom(WELL, id, limit);
    // Текст: снять версии этого чата с верха; если между ними есть версии другого чата — чистого отката нет.
    let restored = null;
    while (WELL.history[0] && WELL.history[0].chat === id && WELL.history[0].idx >= limit) restored = WELL.history.shift();
    if (restored) { WELL.text = restored.text; WELL.updatedAt = restored.at; }
    // Дату и место, сдвинутые убранными пачками, вернуть — если после них мир не ушёл дальше в другом чате.
    if (removed.length && !restored && !others.length) {
        const first = removed.reduce((a, b) => (a.n < b.n ? a : b));
        if (first.prev) WELL.text = setDatePlace(WELL.text, first.prev.day, first.prev.place);
    }
    const tangled = WELL.history.some(h => h.chat === id && h.idx >= limit) || (st.chronIdx >= limit && !restored) || beyondCheckpoint(WELL, id, limit);
    if (removed.length || restored) { WELL.world = replay(WELL, delaysOf, null); VIEW = null; }
    st.countIdx = Math.min(st.countIdx, limit - 1);
    st.chronIdx = Math.min(st.chronIdx, limit - 1);
    st.turns = 0;
    st.chronTurns = 0;
    if (tangled) st.stale = true;
    // Другим чатам — пометка: их события остались, но опирались на то, что здесь переиграно.
    for (const ch of new Set(others.map(b => b.chat))) {
        if (WELL.chats[ch]) WELL.chats[ch].warn = `В чате «${MODE_NAME[st.mode]}» переиграны события, на которые мог опираться этот чат; если что-то здесь расходится с Летописью, верна Летопись.`;
    }
    if (removed.length || restored) toastr.info('Летопись откатилась вслед за чатом.');
    await persist();
    inject();
    if (st.stale) runCycle({ counter: true, chron: true });
}

async function onDeleted(newLength) {
    await rewind(Number(newLength ?? ctx().chat.length));
}

async function onChangedAt(index) {
    const i = Number(index);
    if (!Number.isFinite(i)) return;
    await rewind(i);
    // Стратег: свайп на уже виденный вариант — его эффекты хранятся при сообщении.
    const msg = ctx().chat[i];
    if (WELL && modeOf() === 'strategy' && msg && !msg.is_user && msg.extra?.gr_fx?.[msg.swipe_id ?? 0]) {
        await onStrategyReply(i);
        await persist();
        inject();
    }
}

async function onAiMessage(index, type) {
    if (!isOurChat() || !settings().enabled) return;
    if (['first_message', 'quiet', 'impersonate'].includes(type)) return;
    const c = ctx();
    const msg = c.chat[index];
    if (!msg || msg.is_user || msg.is_system) return;
    // Пустой ответ (бывает у DeepSeek): не считаем ходом и не зовём Счётчик по пустоте.
    if (!String(msg.mes || '').trim()) { toastr.warning('Модель вернула пустой ответ — сделайте свайп или повторите ход.'); return; }
    await ensureWell();
    const st = state();
    const s = settings();
    if (st.mode === 'strategy') {
        await onStrategyReply(index);
        st.chronTurns = (st.chronTurns || 0) + 1;
        if (st.chronTurns >= s.stratChronEvery) await runCycle({ counter: false, chron: true });
    } else {
        if (['swipe', 'regenerate'].includes(type)) return;   // переигранный ответ сцены посчитается вместе со следующими
        st.turns = (st.turns || 0) + 1;
        st.chronTurns = (st.chronTurns || 0) + 1;
        const doCount = st.turns >= s.every, doChron = st.chronTurns >= s.chronEvery;
        if (doCount || doChron) await runCycle({ counter: doCount || doChron, chron: doChron });
    }
    // Рассказчик этого чата уже видел мост — отметить, что чат «догнал» мир.
    st.seenDay = currentDay();
    st.seenJournal = journalLines(WELL.text);
    st.warn = null;
    st.fresh = false;
    await persist();
    inject();
}

async function onChatChanged() {
    if (isOurChat()) {
        await ensureWell();
        const meta = ctx().chatMetadata?.[MODULE];
        if (meta?.text && !meta.well && untouched(WELL)) { WELL = migrateOrNew(); VIEW = null; loading = Promise.resolve(WELL); await persist(); }
        markChat();
        const isNew = !WELL.chats[chatId()];
        state();
        if (isNew) await persist();
        await rewind(ctx().chat.length);
    }
    inject();
}

function addMenu() {
    const items = [
        ['fa-scroll', 'Летопись', () => show('СОСТОЯНИЕ', 'Летопись')],
        ['fa-address-book', 'Досье', () => show('ДОСЬЕ', 'Досье')],
        ['fa-eye-slash', 'Тайное', showSecrets],
        ['fa-rotate', 'Обновить летопись', () => runCycle({ manual: true, counter: true, chron: true })],
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
    cmd('chronicle-update', () => runCycle({ manual: true, counter: true, chron: true }), 'Посчитать эффекты и обновить Летопись сейчас.');
    cmd('chronicle-count', () => runCycle({ manual: true, counter: true, chron: false }), 'Только посчитать эффекты (дата, место, сдвиги) сейчас.');
    cmd('chronicle-edit', edit, 'Править Летопись вручную.');
    cmd('chronicle-undo', undo, 'Откатить Летопись на предыдущую версию.');
    cmd('chronicle-reset', reset, 'Сбросить Летопись к моменту получения власти (новая игра, оба чата).');
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
