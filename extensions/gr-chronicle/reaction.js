// «Реакция мира»: детерминированный движок. Чистые функции, без случайностей.
// Мир хранит фактические оси, восприятие каждого актора (весть доходит с задержкой), память обид и ступени реакций.
import { REACTION } from './reaction.data.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = o => JSON.parse(JSON.stringify(o));
const R = REACTION;

export function allAxes() {
    return Object.keys(R.initialAxes);
}

function weightSum(a) { return Object.values(a.watch).reduce((s, w) => s + Math.abs(w), 0); }

export function attitude(world, a) {
    const axes = world.perceived[a.id];
    let s = 0;
    for (const [axis, w] of Object.entries(a.watch)) s += w * (axes[axis] ?? 0);
    return a.base + 2 * s / weightSum(a) + (world.memory[a.id] || 0);
}

function targetStage(att) {
    const t = R.tempo.thresholds;
    let st = 0;
    for (let i = 0; i < t.length; i++) if (att < t[i]) st = i + 1;
    return st;
}

const activeActors = world => R.actors.filter(a => !world.removed.includes(a.id));
const isExt = a => a.kind === 'external';

export function initWorld(day) {
    const world = { axes: clone(R.initialAxes), perceived: {}, memory: {}, stage: {}, queue: [], removed: [], lastDay: day, log: [] };
    for (const a of R.actors) {
        world.perceived[a.id] = clone(R.initialAxes);
        world.memory[a.id] = 0;
        // Исходная ступень — по состоянию мира на момент призыва; следующий шаг требует полного срока от этого дня.
        world.stage[a.id] = { s: targetStage(attitude(world, a)), since: day };
    }
    return world;
}

// Разбор строк раздела ЭФФЕКТЫ: «Ось·цель +2; Ось −1», «УПРАЗДНИТЬ: Кармин».
export function parseEffects(text) {
    const deltas = {};
    const remove = [];
    const unknown = [];
    const known = new Set(allAxes());
    for (const line of String(text).split('\n')) {
        const rm = line.match(/УПРАЗДНИТЬ:\s*([А-ЯЁа-яё]+)/);
        if (rm) { remove.push(rm[1]); continue; }
        for (const m of line.matchAll(/([А-ЯЁ][а-яё]+(?:·[А-ЯЁа-яё]+)?)\s*([+−\-])\s*(\d+(?:[.,]\d+)?)/g)) {
            const axis = m[1];
            const v = (m[2] === '+' ? 1 : -1) * parseFloat(m[3].replace(',', '.'));
            if (!known.has(axis)) { unknown.push(axis); continue; }
            deltas[axis] = (deltas[axis] || 0) + clamp(v, -3, 3);
        }
    }
    return { deltas, remove, unknown };
}

// Применить сдвиги в день `day`. delayOf(actor) — дни, за которые весть дойдёт до актора.
export function applyEffects(world, parsed, day, delayOf, note = '') {
    const { deltas, remove } = parsed;
    if (!Object.keys(deltas).length && !remove.length) return world;
    for (const [axis, v] of Object.entries(deltas)) world.axes[axis] = clamp((world.axes[axis] ?? 0) + v, -5, 5);
    for (const id of remove) if (R.actors.some(a => a.id === id && a.removable) && !world.removed.includes(id)) world.removed.push(id);
    for (const a of activeActors(world)) world.queue.push({ actor: a.id, deltas, arrive: day + delayOf(a) });
    world.log.push({ day, deltas, remove, note });
    world.log = world.log.slice(-30);
    return world;
}

// Продвинуть мир до дня `toDay` (по одному дню: вести, память, ступени).
export function advance(world, toDay) {
    const month = d => Math.floor(((d - 1) % 384) / 32) + 1;
    for (let day = world.lastDay + 1; day <= toDay; day++) {
        // вести дошли
        const arrived = world.queue.filter(q => q.arrive <= day);
        world.queue = world.queue.filter(q => q.arrive > day);
        for (const q of arrived) {
            const a = R.actors.find(x => x.id === q.actor);
            if (!a || world.removed.includes(a.id)) continue;
            let shock = 0;
            for (const [axis, v] of Object.entries(q.deltas)) {
                world.perceived[a.id][axis] = clamp((world.perceived[a.id][axis] ?? 0) + v, -5, 5);
                if (a.watch[axis]) shock += a.watch[axis] * v;
            }
            world.memory[a.id] += 1.5 * shock / weightSum(a); // свежая обида или благодеяние
        }
        // память тает, ступени движутся не быстрее темпа
        for (const a of activeActors(world)) {
            world.memory[a.id] *= Math.pow(0.5, 1 / (isExt(a) ? R.tempo.halfLifeExternal : R.tempo.halfLifeInternal));
            const st = world.stage[a.id];
            const target = targetStage(attitude(world, a));
            const up = (isExt(a) ? R.tempo.upExternal : R.tempo.upInternal)[st.s];
            const down = isExt(a) ? R.tempo.downExternal : R.tempo.downInternal;
            const seasonBlock = a.summerOnly && a.summerOnly.includes(st.s + 1) && (month(day) < 5 || month(day) > 9);
            if (target > st.s && day - st.since >= up && !seasonBlock) { st.s += 1; st.since = day; }
            else if (target < st.s && day - st.since >= down) { st.s -= 1; st.since = day; }
        }
    }
    world.lastDay = Math.max(world.lastDay, toDay);
    return world;
}

// Сводка для рассказчика и Летописца.
export function summary(world, fmtDate) {
    const lines = activeActors(world).map(a => {
        const att = attitude(world, a);
        const st = world.stage[a.id];
        const target = targetStage(att);
        let trend = '';
        if (target > st.s) {
            const up = (isExt(a) ? R.tempo.upExternal : R.tempo.upInternal)[st.s];
            trend = ` · нарастает к ступени ${target}; следующая ступень не раньше ${fmtDate(Math.max(world.lastDay + 1, st.since + up))}`;
        } else if (target < st.s) trend = ' · остывает';
        const pending = world.queue.filter(q => q.actor === a.id).length;
        return `${a.name}: отношение ${att.toFixed(1).replace('.', ',')} · ступень ${st.s} — ${a.ladder[st.s]}${trend}${pending ? ` · вести ещё в пути: ${pending}` : ''}`;
    });
    return lines.join('\n');
}

export { clone as cloneWorld };
