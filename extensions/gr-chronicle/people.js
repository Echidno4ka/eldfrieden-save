// «Отношения»: ключевые персонажи и их отношение к {{user}} — доверие (дело) и приязнь (лично).
// Живёт в том же мире, что «Реакция мира»: вести о переменах в стране приходят с задержкой гонца,
// а личное доверие герцогов входит в их ступень (world.personal).
import { PEOPLE } from './people.data.js';
import { REACTION } from './reaction.data.js';
import { advance, attitude } from './reaction.js';

const T = PEOPLE.tempo;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const byId = Object.fromEntries(PEOPLE.people.map(p => [p.id, p]));
const DIMS = { 'Доверие': 'trust', 'Приязнь': 'like' };

export const peopleList = () => PEOPLE.people;

export function band(v) {
    const a = Math.abs(v);
    let s = 0;
    for (let i = 0; i < T.thresholds.length; i++) if (a >= T.thresholds[i]) s = i + 1;
    return Math.sign(v) * s;
}

export function initPeople(world, day) {
    world.people = {};
    world.axesLog = world.axesLog || [];
    world.personal = world.personal || {};
    for (const p of PEOPLE.people) {
        world.people[p.id] = {
            level: { trust: p.start.trust, like: p.start.like },   // постоянный след поступков
            mem: { trust: 0, like: 0 },                             // свежесть событий, остывает
            seen: {}, cursor: world.axesLog.length,                // что из перемен в стране уже дошло
            band: { trust: { s: 0, since: day }, like: { s: 0, since: day } },
            met: p.met, provoked: null, last: [],
        };
    }
    // Второй проход: связи читают уже созданных персонажей.
    for (const p of PEOPLE.people) syncPersonal(world, p.id);
    for (const p of PEOPLE.people) {
        const st = world.people[p.id];
        for (const k of ['trust', 'like']) st.band[k].s = band(value(world, p.id, k));
    }
    world.peopleDay = day;
    world.peopleBase = day;
    // Перемены, начатые раньше получения власти (в т.ч. их откаты и отложенные следствия), персонажи {{user}} в вину или заслугу не ставят.
    world.peopleBaseSeq = world.axesLog.length;
    return world;
}

// Интересы: как перемены в стране с момента получения власти бьют по тому, что дорого персонажу.
function interests(world, id) {
    const p = byId[id], st = world.people[id];
    if (!p.interests) return 0;
    let s = 0, w = 0;
    for (const [axis, k] of Object.entries(p.interests)) { s += k * (st.seen[axis] || 0); w += Math.abs(k); }
    return T.interestScale * 2 * s / w;
}

// Личное доверие без связей (для герцогов — это надбавка к их ступени).
function ownTrust(world, id) {
    const st = world.people[id];
    return st.level.trust + st.mem.trust + interests(world, id);
}

// Доверие источника связи: у герцога — его отношение в «Реакции мира», у прочих — своё доверие.
function sourceTrust(world, id) {
    const p = byId[id];
    if (!p) return 0;
    if (p.actor) {
        const a = REACTION.actors.find(x => x.id === p.actor);
        return a && !world.removed.includes(a.id) ? clamp(attitude(world, a), -T.levelMax, T.levelMax) : 0;
    }
    return clamp(ownTrust(world, id), -T.levelMax, T.levelMax);
}

export function value(world, id, dim) {
    const p = byId[id], st = world.people[id];
    if (dim === 'like') return clamp(st.level.like + st.mem.like, -T.levelMax, T.levelMax);
    let v = ownTrust(world, id);
    for (const [src, k] of Object.entries(p.ties || {})) v += k * sourceTrust(world, src);
    if (p.actor) {
        // Дело герцога — его ступень в «Реакции мира» (там уже учтено личное доверие); здесь — для показа.
        const a = REACTION.actors.find(x => x.id === p.actor);
        if (a && !world.removed.includes(a.id)) return clamp(attitude(world, a), -T.levelMax, T.levelMax);
    }
    return clamp(v, -T.levelMax, T.levelMax);
}

function syncPersonal(world, id) {
    const p = byId[id];
    // Личное доверие герцога входит в его ступень с половинным весом: герцог — и человек, и институт.
    if (p.actor) world.personal[p.actor] = T.dukePersonal * (ownTrust(world, id) + Object.entries(p.ties || {}).reduce((s, [src, k]) => s + k * sourceTrust(world, src), 0));
}

// Разбор строк персонажей из раздела ЭФФЕКТЫ:
//   «Лисия: Доверие −2; Приязнь +1 — причина»   «ЗНАКОМСТВО: Айша»   «ТРЕБОВАНИЕ: Маркс» (требование — общий разбор мира)
export function parsePeople(text) {
    const out = [], meet = [], unknown = [];
    const norm = s => String(s).replace(/\s*[·•]\s*/g, '·').replace(/[–—]/g, '−');
    for (const raw of String(text).split('\n')) {
        const line = norm(raw);
        const mm = line.match(/ЗНАКОМСТВО:\s*(.+)/);
        if (mm) { for (const n of mm[1].split(/[,;]\s*/)) { const id = findId(n.trim()); if (id) meet.push(id); } continue; }
        if (!/Доверие|Приязнь/.test(line)) continue;
        const who = line.match(/^\s*(?:НА\s+\d+[^:]*:\s*|ЧЕРЕЗ\s+\d+[^:]*:\s*)?([^:]+):/);
        const id = who && findId(who[1].trim());
        if (!id) { unknown.push(line.trim()); continue; }
        const d = { id, trust: 0, like: 0, note: (line.split(/\s[−-]\s|—/).slice(1).join(' ').trim() || '').slice(0, 120) };
        for (const m of line.matchAll(/(Доверие|Приязнь)\s*([+−\-])\s*(\d+(?:[.,]\d+)?)/g)) {
            d[DIMS[m[1]]] += (m[2] === '+' ? 1 : -1) * clamp(parseFloat(m[3].replace(',', '.')), 0, 3);
        }
        if (d.trust || d.like) out.push(d);
    }
    return { events: out, meet, unknown };
}

export function findId(name) {
    const n = String(name).replace(/[«»"]/g, '').trim().toLowerCase();
    for (const p of PEOPLE.people) if (p.aliases.some(a => n === a.toLowerCase() || n.startsWith(a.toLowerCase() + ' ') || n.endsWith(' ' + a.toLowerCase()))) return p.id;
    return null;
}

// Применить личные события в день `day`; demand — список id, кому предъявлено прямое требование.
export function applyPeople(world, parsed, day, demand = []) {
    for (const e of parsed.events) {
        const st = world.people[e.id];
        if (!st) continue;
        for (const k of ['trust', 'like']) {
            if (!e[k]) continue;
            st.level[k] = clamp(st.level[k] + e[k], -T.levelMax, T.levelMax);
            st.mem[k] += T.memoryShock * e[k];
        }
        st.met = true;
        st.last.unshift({ day, trust: e.trust, like: e.like, note: e.note });
        st.last = st.last.slice(0, 3);
    }
    for (const id of parsed.meet) if (world.people[id]) world.people[id].met = true;
    for (const raw of demand) {
        const id = findId(raw);
        if (id && world.people[id] && !byId[id].actor) world.people[id].provoked = day + 1;
    }
    for (const p of PEOPLE.people) syncPersonal(world, p.id);
    return world;
}

// Один день для персонажей: дошедшие вести, остывание, ступени.
function stepPeople(world, day, delayOf) {
    for (const p of PEOPLE.people) {
        const st = world.people[p.id];
        const delay = delayOf(p.id);
        while (st.cursor < world.axesLog.length && world.axesLog[st.cursor].day + delay <= day) {
            const e = world.axesLog[st.cursor];
            if ((e.origin ?? st.cursor) >= world.peopleBaseSeq) for (const [axis, v] of Object.entries(e.d)) st.seen[axis] = (st.seen[axis] || 0) + v;
            st.cursor++;
        }
        for (const k of ['trust', 'like']) {
            const hl = (k === 'trust' ? T.halfLifeTrust : T.halfLifeLike) * (p.proud ? T.proudFactor : 1);
            st.mem[k] *= Math.pow(0.5, 1 / hl);
        }
    }
    for (const p of PEOPLE.people) syncPersonal(world, p.id);
    for (const p of PEOPLE.people) {
        const st = world.people[p.id];
        for (const k of ['trust', 'like']) {
            const b = st.band[k];
            const v = value(world, p.id, k);
            const target = band(v);
            const toward = Math.sign(target - b.s);
            if (!toward) continue;
            const away = Math.abs(b.s + toward) > Math.abs(b.s);      // шаг от нуля (чувство крепнет)
            // Ответ на прямое требование — без выдержки, но не дальше неприязни/доверия (±2): вражда и преданность требуют времени.
            const prov = k === 'trust' && st.provoked && day >= st.provoked && Math.abs(b.s + toward) <= T.demandMaxBand;
            if (away) {
                const need = T.up[Math.abs(b.s + toward) - 1];
                if (day - b.since >= need || prov) { b.s += toward; b.since = day; if (prov) st.provoked = null; }
            } else if (band(v - Math.sign(b.s) * T.hysteresis) !== b.s && day - b.since >= T.down) {
                // к нулю — только отойдя от порога с запасом
                b.s += toward; b.since = day;
            }
        }
        if (st.provoked && day >= st.provoked + 1) st.provoked = null;
    }
    world.peopleDay = day;
}

// Продвинуть мир и персонажей вместе, день за днём.
export function advanceAll(world, toDay, delayOf) {
    if (!world.people) return advance(world, toDay);
    for (let day = Math.max(world.lastDay, world.peopleDay) + 1; day <= toDay; day++) {
        advance(world, day);
        stepPeople(world, day, delayOf);
    }
    return world;
}

const name = (id) => byId[id].name;
const fmtV = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',');

// Сводка для рассказчика: ступени дела и личного, тенденция, свежий повод.
export function peopleSummary(world, fmtDate) {
    return PEOPLE.people.map(p => {
        const st = world.people[p.id];
        const tv = value(world, p.id, 'trust'), lv = value(world, p.id, 'like');
        let deed;
        if (p.actor) {
            const a = REACTION.actors.find(x => x.id === p.actor);
            deed = world.removed.includes(p.actor) ? 'герцогство упразднено' : `ступень ${world.stage[p.actor].s} — ${a.ladder[world.stage[p.actor].s]}`;
        } else {
            deed = `${PEOPLE.ladders.trust[String(st.band.trust.s)]} (${fmtV(tv)})`;
            const tgt = band(tv);
            if (tgt !== st.band.trust.s) deed += tgt > st.band.trust.s ? ' · теплеет' : ' · холодеет';
        }
        let personal = `${PEOPLE.ladders.like[String(st.band.like.s)]} (${fmtV(lv)})`;
        const tl = band(lv);
        if (tl !== st.band.like.s) personal += tl > st.band.like.s ? ' · теплеет' : ' · остывает';
        const fresh = st.last[0] ? ` · свежее (${fmtDate(st.last[0].day)}): ${st.last[0].note || 'без пояснения'}` : '';
        if (!st.met) return `${p.name}: не знакомы; по слухам — дело: ${deed}`;
        return `${p.name}: дело — ${deed}; лично — ${personal}${fresh}`;
    }).join('\n');
}
