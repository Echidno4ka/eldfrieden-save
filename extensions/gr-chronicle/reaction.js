// «Реакция мира»: детерминированный движок. Чистые функции, без случайностей.
// Мир хранит фактические оси, восприятие каждого актора (весть доходит с задержкой), память обид и ступени реакций.
import { REACTION } from './reaction.data.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = o => JSON.parse(JSON.stringify(o));
const R = REACTION;
const T = R.tempo;
const MAX = () => T.axisMax;

export function allAxes() {
    return Object.keys(R.initialAxes);
}

function weightSum(a) { return Object.values(a.watch).reduce((s, w) => s + Math.abs(w), 0); }

export function attitude(world, a) {
    const axes = world.perceived[a.id];
    let s = 0;
    for (const [axis, w] of Object.entries(a.watch)) s += w * (axes[axis] ?? 0);
    // follows — за кем идёт актор: недовольство знати уводит офицеров-дворян (только худшее, и без цепочек).
    let f = 0;
    for (const [id, k] of Object.entries(a.follows || {})) {
        const b = R.actors.find(x => x.id === id);
        if (b && !b.follows && !world.removed.includes(id)) f += k * Math.min(0, attitude(world, b));
    }
    // Репутация {{user}}: как о нём говорят — в той мере, в какой это важно актору (весть дошла с гонцом).
    let r = 0;
    for (const [facet, k] of Object.entries(R.reputation?.actors?.[a.id] || {})) r += k * (axes[REP + facet] ?? 0);
    // world.personal — личное доверие к {{user}} (для герцогов, из «Отношений»); grievance — застарелая нужда.
    return a.base + 2 * s / weightSum(a) + f + r + (world.memory[a.id] || 0) + (world.grievance?.[a.id] || 0) + (world.personal?.[a.id] || 0);
}

export const REP = 'Репутация·';
// Разнести слух о {{user}}: треть — навсегда, остальное — свежий слух, остынет через fresh дней. Весть идёт с гонцами.
export function repute(world, deltas, day, delayOf, note = '') {
    const keep = R.reputation.keep, fresh = R.reputation.fresh;
    const perm = {}, temp = {};
    for (const [facet, v] of Object.entries(deltas)) { if (!v) continue; perm[REP + facet] = v * keep; temp[REP + facet] = v * (1 - keep); }
    if (!Object.keys(perm).length) return world;
    return applyEffects(world, { deltas: perm, temp: [{ days: fresh, deltas: temp, note: 'слух остывает: ' + note }], remove: [], demand: [] }, day, delayOf, note);
}

function targetStage(att) {
    let st = 0;
    for (let i = 0; i < T.thresholds.length; i++) if (att < T.thresholds[i]) st = i + 1;
    return st;
}

const activeActors = world => R.actors.filter(a => !world.removed.includes(a.id));
const isExt = a => a.kind === 'external';
const upDays = (a, st) => st.max != null && st.s + 1 <= st.max ? T.reclimbDays : (isExt(a) ? T.upExternal : T.upInternal)[st.s];

export function initWorld(day) {
    const world = { axes: clone(R.initialAxes), perceived: {}, memory: {}, stage: {}, queue: [], removed: [], scheduled: [], provoked: {}, lastDay: day, log: [] };
    for (const a of R.actors) {
        world.perceived[a.id] = clone(R.initialAxes);
        world.memory[a.id] = 0;
        // Исходная ступень — по состоянию мира на момент призыва; следующий шаг требует полного срока от этого дня.
        world.stage[a.id] = { s: targetStage(attitude(world, a)), since: day };
    }
    return world;
}

// Разбор раздела ЭФФЕКТЫ. Строки:
//   «причина: Ось ±n; Ось ±n»          — сразу;
//   «НА N: причина: Ось ±n»            — сразу и само откатывается через N дней (толпы разошлись);
//   «ЧЕРЕЗ N: причина: Ось ±n»         — наступит через N дней (истощение, урожай);
//   «ТРЕБОВАНИЕ: Кармин, Варгас»       — прямое требование, на которое актор ответит через несколько дней;
//   «УПРАЗДНИТЬ: Кармин»               — герцогство упразднено.
export function parseEffects(text) {
    const deltas = {}, remove = [], unknown = [], demand = [], later = [], temp = [];
    const known = new Set(allAxes());
    const norm = s => String(s).replace(/\s*[·•]\s*/g, '·').replace(/[–—]/g, '−');
    for (const raw of String(text).split('\n')) {
        const line = norm(raw);
        const tm = line.match(/^\s*НА\s+(\d+)[^:]*:\s*(.*)$/);
        if (tm) {
            const sub = parseEffects(tm[2]);
            if (Object.keys(sub.deltas).length) temp.push({ days: Math.min(384, +tm[1]), deltas: sub.deltas, note: tm[2].split(':')[0].trim() });
            unknown.push(...sub.unknown);
            continue;
        }
        const lm = line.match(/^\s*ЧЕРЕЗ\s+(\d+)[^:]*:\s*(.*)$/);
        if (lm) {
            const sub = parseEffects(lm[2]);
            if (Object.keys(sub.deltas).length) later.push({ days: Math.min(384, +lm[1]), deltas: sub.deltas, note: lm[2].split(':')[0].trim() });
            unknown.push(...sub.unknown);
            continue;
        }
        const dm = line.match(/ТРЕБОВАНИЕ:\s*(.+)/);
        if (dm) { for (const id of dm[1].split(/[,;]\s*/).map(x => x.trim()).filter(Boolean)) demand.push(id); continue; }
        const rm = line.match(/УПРАЗДНИТЬ:\s*([А-ЯЁа-яё]+)/);
        if (rm) { remove.push(rm[1]); continue; }
        for (const m of line.matchAll(/([А-ЯЁ][а-яё]+(?:·[А-ЯЁа-яё]+)?)\s*([+−\-])\s*(\d+(?:[.,]\d+)?)/g)) {
            const axis = m[1];
            const v = (m[2] === '+' ? 1 : -1) * parseFloat(m[3].replace(',', '.'));
            if (!known.has(axis)) { unknown.push(axis); continue; }
            deltas[axis] = (deltas[axis] || 0) + clamp(v, -3, 3);
        }
    }
    return { deltas, remove, unknown, demand, later, temp };
}

function schedule(world, day, days, deltas, note, quiet, delayOf) {
    world.scheduled = world.scheduled || [];
    // origin — номер записи журнала осей, от которой пошло это последствие (для отсечки у персонажей).
    world.scheduled.push({ at: day + days, from: day, origin: (world.axesLog || []).length, deltas, note, quiet, arrive: Object.fromEntries(activeActors(world).map(a => [a.id, delayOf(a)])) });
}

// Журнал фактических изменений осей: по нему персонажи узнают о переменах (с задержкой по месту). from — день решения.
function logAxes(world, day, from, applied, origin) {
    const d = Object.fromEntries(Object.entries(applied).filter(([, v]) => v));
    if (!Object.keys(d).length) return;
    world.axesLog = world.axesLog || [];
    world.axesLog.push({ day, from, origin: origin ?? world.axesLog.length, d });
}
function addAxes(world, deltas) {
    const applied = {};
    for (const [axis, v] of Object.entries(deltas)) {
        const before = world.axes[axis] ?? 0;
        world.axes[axis] = clamp(before + v, -MAX(), MAX());
        applied[axis] = world.axes[axis] - before;
    }
    return applied;
}

// Применить сдвиги в день `day`. delayOf(actor) — дни, за которые весть дойдёт до актора.
export function applyEffects(world, parsed, day, delayOf, note = '') {
    const { deltas, remove } = parsed;
    const demand = parsed.demand || [];
    for (const l of parsed.later || []) schedule(world, day, l.days, l.deltas, l.note, false, delayOf);
    // Временное: применяем сразу, откат — ровно на то, что реально применилось (у края шкалы — меньше).
    const news = { ...deltas };
    for (const t of parsed.temp || []) {
        const applied = addAxes(world, t.deltas);
        logAxes(world, day, day, applied);
        for (const [axis, v] of Object.entries(t.deltas)) news[axis] = (news[axis] || 0) + v;
        const back = Object.fromEntries(Object.entries(applied).filter(([, v]) => v).map(([k, v]) => [k, -v]));
        if (Object.keys(back).length) schedule(world, day, t.days, back, 'прошло: ' + t.note, true, delayOf);
    }
    if (!Object.keys(news).length && !remove.length && !demand.length) return world;
    logAxes(world, day, day, addAxes(world, deltas));
    for (const id of remove) if (R.actors.some(a => a.id === id && a.removable) && !world.removed.includes(id)) world.removed.push(id);
    for (const a of activeActors(world)) world.queue.push({ actor: a.id, deltas: news, arrive: day + delayOf(a), demand: demand.includes(a.id) || demand.includes(a.name) });
    world.log.push({ day, deltas: news, remove, note });
    world.log = world.log.slice(-30);
    return world;
}

// Продвинуть мир до дня `toDay` (по одному дню: отложенное, вести, память, ступени).
export function advance(world, toDay) {
    const month = d => Math.floor(((d - 1) % 384) / 32) + 1;
    world.provoked = world.provoked || {};
    for (let day = world.lastDay + 1; day <= toDay; day++) {
        // отложенные последствия наступили
        for (const sc of (world.scheduled || []).filter(x => x.at === day)) {
            logAxes(world, day, sc.from ?? day, addAxes(world, sc.deltas), sc.origin);
            for (const a of activeActors(world)) world.queue.push({ actor: a.id, deltas: sc.deltas, arrive: day + (sc.arrive[a.id] ?? 1), quiet: sc.quiet });
            world.log.push({ day, deltas: sc.deltas, remove: [], note: (sc.quiet ? '' : 'наступило: ') + sc.note });
        }
        if (world.scheduled) world.scheduled = world.scheduled.filter(x => x.at > day);
        // вести дошли
        const arrived = world.queue.filter(q => q.arrive <= day);
        world.queue = world.queue.filter(q => q.arrive > day);
        for (const q of arrived) {
            const a = R.actors.find(x => x.id === q.actor);
            if (!a || world.removed.includes(a.id)) continue;
            let shock = 0;
            for (const [axis, v] of Object.entries(q.deltas)) {
                world.perceived[a.id][axis] = clamp((world.perceived[a.id][axis] ?? 0) + v, -MAX(), MAX());
                if (a.watch[axis]) shock += a.watch[axis] * v;
            }
            // Свежая обида или благодеяние; откат временного — угасание, а не новость.
            if (!q.quiet) world.memory[a.id] += 1.5 * shock / weightSum(a);
            if (q.demand) world.provoked[a.id] = day + T.provokeDays;
        }
        // память тает; застарелая нужда копит обиду; ступени движутся не быстрее темпа
        world.grievance = world.grievance || {};
        for (const a of activeActors(world)) {
            const half = Math.pow(0.5, 1 / (isExt(a) ? T.halfLifeExternal : T.halfLifeInternal));
            world.memory[a.id] *= half;
            let g = world.grievance[a.id] || 0;
            const stat = attitude(world, a) - world.memory[a.id] - g;
            if (stat < T.driftFrom) {
                // Беда не решена: обида копится и не тает, но не глубже предела, заданного самой бедой.
                const cap = (a.grievanceMax ?? T.grievanceMax ?? 1) * (stat - T.driftFrom);
                g = Math.max(cap, g + (isExt(a) ? T.driftExternal : T.driftInternal) * (stat - T.driftFrom));
            } else g *= half;                     // беды нет — старая обида остывает, как память
            world.grievance[a.id] = g;
            const st = world.stage[a.id];
            const att = attitude(world, a);
            const target = targetStage(att);
            const down = isExt(a) ? T.downExternal : T.downInternal;
            const seasonBlock = a.summerOnly && a.summerOnly.includes(st.s + 1) && (month(day) < 5 || month(day) > 9);
            // Ответ на прямое требование — без выдержки, но не выше разрыва: на войну нужны сборы.
            const prov = world.provoked[a.id] && day >= world.provoked[a.id] && st.s + 1 <= T.provokeMaxStage;
            if (target > st.s && (day - st.since >= upDays(a, st) || prov) && !seasonBlock) {
                st.s += 1; st.since = day;
                // Отказ на прямое требование — все видят, что приказ {{user}} можно не исполнить.
                if (prov) { delete world.provoked[a.id]; (world.repEvents = world.repEvents || []).push({ day, deltas: { 'Сила': -1 }, note: `${a.name}: отказ на требование` }); }
            } else {
                if (prov && target <= st.s) {
                    delete world.provoked[a.id];
                    // подчинился недовольный — слух о твёрдости {{user}}; послушание верного ничего не доказывает
                    if (st.s >= 1) (world.repEvents = world.repEvents || []).push({ day, deltas: { 'Сила': 1 }, note: `подчинение требованию: ${a.name}` });
                }
                // Остыть — только отойдя от порога с запасом (без дрожания на границе).
                if (targetStage(att - T.hysteresis) < st.s && day - st.since >= down) { st.s -= 1; st.since = day; }
            }
            // Пик: вернуться на уже взятую ступень можно быстро, пока опыт не забыт.
            if (st.max == null || st.s >= st.max) { st.max = st.s; st.maxDay = day; }
            else if (day - st.maxDay > T.demobilize) { st.max = st.s; st.maxDay = day; }
        }
    }
    world.lastDay = Math.max(world.lastDay, toDay);
    return world;
}

// Сводка для рассказчика и Летописца. withScheduled — показать запланированные последствия (Летописцу).
export function summary(world, fmtDate, withScheduled = true) {
    const lines = activeActors(world).map(a => {
        const att = attitude(world, a);
        const st = world.stage[a.id];
        const target = targetStage(att);
        let trend = '';
        if (target > st.s) trend = ` · нарастает к ступени ${target}; следующая ступень не раньше ${fmtDate(Math.max(world.lastDay + 1, st.since + upDays(a, st)))}`;
        else if (targetStage(att - T.hysteresis) < st.s) trend = ' · остывает';
        const pending = world.queue.filter(q => q.actor === a.id && !q.quiet).length;
        return `${a.name}: отношение ${att.toFixed(1).replace('.', ',')} · ступень ${st.s} — ${a.ladder[st.s]}${trend}${pending ? ` · вести ещё в пути: ${pending}` : ''}`;
    });
    const sch = withScheduled ? (world.scheduled || []).filter(x => !x.quiet).map(x => `— ${fmtDate(x.at)}: ${x.note}`) : [];
    return lines.join('\n') + (sch.length ? '\nУЖЕ ЗАПЛАНИРОВАНО КОДОМ (не записывай повторно, когда наступит):\n' + sch.join('\n') : '');
}

export { clone as cloneWorld };
