// Единый порядок мира: разбор раздела ЭФФЕКТЫ по трём модулям и шаг дня.
//   страна («Реакция мира») → казна («Хозяйство») → люди («Отношения»).
// Им пользуются и Летопись, и проверки — один путь для игры и для тестов.
import { parseEffects, applyEffects, advance } from './reaction.js';
import { PEOPLE } from './people.data.js';
import { initPeople, parsePeople, applyPeople, stepPeople, findId } from './people.js';
import { initEconomy, parseEconomy, applyEconomy, stepEconomy, chargeGifts } from './economy.js';

export const PEOPLE_LINE = /Доверие|Приязнь|Влечение|ЗНАКОМСТВО|^\s*ЖЕСТ:/;
// (\b с кириллицей в JS не работает — граница задаётся явно)
export const ECO_LINE = /^\s*(КАЗНА|СОКРОВИЩНИЦА|ЕЖЕМЕСЯЧНО|ДОЛГ ВОЙСКУ|ДОЛГ|ДЕЛО ЗАКРЫТЬ|ДЕЛО)\s*:/;

export function initAll(world, day) {
    initPeople(world, day);
    initEconomy(world, day);
    return world;
}

// Старые сохранения: догрузить то, чего в них ещё нет.
export function upgrade(world) {
    if (!world.people) initPeople(world, world.lastDay);
    if (!world.eco) initEconomy(world, world.lastDay);
    return world;
}

// ТРЕБОВАНИЕ «Кастор» — это требование герцогу Варгасу в «Реакции мира».
function demandActors(names) {
    return names.map(n => { const id = findId(n); const p = id && PEOPLE.people.find(x => x.id === id); return p?.actor || n; });
}

// «Ресурсы» теперь ведёт казна: строки «Ресурсы ±n» Летописца переводятся в деньги (и не трогают ось напрямую).
function takeResources(parsed) {
    const fb = { now: 0, later: [], temp: [] };
    if (parsed.deltas['Ресурсы']) { fb.now = parsed.deltas['Ресурсы']; delete parsed.deltas['Ресурсы']; }
    parsed.later = (parsed.later || []).filter(l => {
        if (!l.deltas['Ресурсы']) return true;
        fb.later.push({ days: l.days, points: l.deltas['Ресурсы'], note: l.note });
        delete l.deltas['Ресурсы'];
        return Object.keys(l.deltas).length > 0;
    });
    parsed.temp = (parsed.temp || []).filter(t => {
        if (!t.deltas['Ресурсы']) return true;
        fb.temp.push({ days: t.days, points: t.deltas['Ресурсы'], note: t.note });
        delete t.deltas['Ресурсы'];
        return Object.keys(t.deltas).length > 0;
    });
    return fb;
}

// Применить раздел ЭФФЕКТЫ в день `day`. delays: { actor(a), person(id) }. Возвращает то, что не разобрано.
// Деньги в вольной форме («причина: Казна: −N G — …», «Казна:» строчными) — к строке хозяйства.
const ECO_LOOSE = /(?:^|:\s*)(казна|сокровищница|ежемесячно)\s*:\s*(.+)$/i;
const normEco = l => {
    if (PEOPLE_LINE.test(l) || ECO_LINE.test(l)) return l;
    const m = l.match(ECO_LOOSE);
    return m ? `${m[1].toUpperCase()}: ${m[2].trim()}` : l;
};

export function applyBatch(world, text, day, delays, note = '') {
    // «…: Порядок +1; ЧЕРЕЗ 8: …» в одной строке (так пишет DeepSeek) — отложенное с новой строки.
    const lines = String(text).split('\n').flatMap(l => l.split(/;\s*(?=(?:ЧЕРЕЗ|НА)\s+\d+\s*:)/)).map(normEco);
    const peopleText = lines.filter(l => PEOPLE_LINE.test(l)).join('\n');
    const ecoText = lines.filter(l => ECO_LINE.test(l)).join('\n');
    // Денежная строка с показателями в хвосте («СОКРОВИЩНИЦА: продать треть — …: Порядок +1») идёт и в хозяйство, и в показатели.
    const hasAxes = l => [...l.matchAll(/([А-ЯЁ][а-яё]+(?:·[А-ЯЁа-яё]+)?)\s*[+−-]\s*\d/g)].some(m => m[1] in world.axes);
    const countryText = lines.filter(l => !PEOPLE_LINE.test(l) && (!ECO_LINE.test(l) || hasAxes(l))).join('\n');
    const parsed = parseEffects(countryText);
    const demandNames = parsed.demand.slice();
    parsed.demand = demandActors(parsed.demand);
    const fallback = world.eco ? takeResources(parsed) : null;
    applyEffects(world, parsed, day, delays.actor, note);
    // Сбой одного модуля не должен ронять всё обновление Летописи: модуль пропускается, остальное применяется.
    const errors = [];
    let eco = { unknown: [] }, notes = [], people = { unknown: [] };
    try { eco = parseEconomy(ecoText); notes = world.eco ? applyEconomy(world, eco, day, fallback, delays.actor) : []; }
    catch (e) { errors.push('хозяйство: ' + (e?.message || e)); }
    try { people = parsePeople(peopleText); if (world.people) applyPeople(world, people, day, demandNames, delays.person); if (world.eco) chargeGifts(world, people.gestures, day); }
    catch (e) { errors.push('отношения: ' + (e?.message || e)); }
    return { unknownAxes: parsed.unknown, unknownEco: eco.unknown, unknownPeople: people.unknown, errors, repeats: notes.filter(n => n === 'повтор').length, resourcesWritten: notes.includes('Ресурсы') || (fallback && (fallback.later.length || fallback.temp.length) > 0) };
}

// Зафиксировать пачку эффектов в день `day` — один и тот же порядок для игры и для пересчёта колодца:
// сначала прожить дни до решения, потом решение, потом сам день. Так пересчёт журнала даёт тот же мир.
export function commitBatch(world, text, day, delays, note = '') {
    const d = Math.max(day, world.lastDay);
    if (d - 1 > world.lastDay) advanceWorld(world, d - 1, delays);
    const r = applyBatch(world, text, d, delays, note);
    advanceWorld(world, d, delays);
    return r;
}

// Продвинуть весь мир до дня `toDay`, день за днём.
export function advanceWorld(world, toDay, delays) {
    for (let d = world.lastDay + 1; d <= toDay; d++) {
        advance(world, d);
        if (world.eco) stepEconomy(world, d, delays.actor);
        if (world.people) stepPeople(world, d, delays.person);
    }
    return world;
}
