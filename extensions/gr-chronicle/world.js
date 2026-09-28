// Единый порядок мира: разбор раздела ЭФФЕКТЫ по трём модулям и шаг дня.
//   страна («Реакция мира») → казна («Хозяйство») → люди («Отношения»).
// Им пользуются и Летопись, и проверки — один путь для игры и для тестов.
import { parseEffects, applyEffects, advance } from './reaction.js';
import { PEOPLE } from './people.data.js';
import { initPeople, parsePeople, applyPeople, stepPeople, findId } from './people.js';
import { initEconomy, parseEconomy, applyEconomy, stepEconomy } from './economy.js';

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
export function applyBatch(world, text, day, delays, note = '') {
    const lines = String(text).split('\n');
    const peopleText = lines.filter(l => PEOPLE_LINE.test(l)).join('\n');
    const ecoText = lines.filter(l => ECO_LINE.test(l)).join('\n');
    const countryText = lines.filter(l => !PEOPLE_LINE.test(l) && !ECO_LINE.test(l)).join('\n');
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
    try { people = parsePeople(peopleText); if (world.people) applyPeople(world, people, day, demandNames, delays.person); }
    catch (e) { errors.push('отношения: ' + (e?.message || e)); }
    return { unknownAxes: parsed.unknown, unknownEco: eco.unknown, unknownPeople: people.unknown, errors, resourcesWritten: notes.includes('Ресурсы') || (fallback && (fallback.later.length || fallback.temp.length) > 0) };
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
