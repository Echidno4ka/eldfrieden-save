// «Отношения»: ключевые персонажи и их отношение к {{user}} — доверие (дело), приязнь (лично), влечение (у тех, с кем возможен роман).
// Живёт в том же мире, что «Реакция мира»: вести о переменах в стране приходят с задержкой гонца,
// а личное доверие герцогов входит в их ступень (world.personal).
import { PEOPLE } from './people.data.js';
import { REACTION } from './reaction.data.js';
import { MERA } from './mera.data.js';
import { advance, attitude, REP } from './reaction.js';

const T = PEOPLE.tempo, G = PEOPLE.gestures;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const byId = Object.fromEntries(PEOPLE.people.map(p => [p.id, p]));
const DIMS = { 'Доверие': 'trust', 'Приязнь': 'like', 'Влечение': 'love' };
const dimsOf = p => p.romance ? ['trust', 'like', 'love'] : ['trust', 'like'];

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
    world.peopleQueue = [];
    for (const p of PEOPLE.people) {
        world.people[p.id] = {
            level: { trust: p.start.trust, like: p.start.like, love: p.start.love || 0 },   // постоянный след поступков
            mem: { trust: 0, like: 0, love: 0 },                                             // свежесть событий, остывает
            seen: {}, cursor: world.axesLog.length,                                          // что из перемен в стране уже дошло
            band: { trust: { s: 0, since: day }, like: { s: 0, since: day }, love: { s: 0, since: day } },
            met: p.met, provoked: null, last: [], gestures: [],
        };
    }
    // Второй проход: связи читают уже созданных персонажей.
    for (const p of PEOPLE.people) syncPersonal(world, p.id);
    for (const p of PEOPLE.people) {
        const st = world.people[p.id];
        for (const k of dimsOf(p)) st.band[k].s = band(value(world, p.id, k));
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

// Характер персонажа (старые данные без него — обычный человек; «гордый» — злопамятен).
const TP = p => p.temper || { attention: 1, trusting: 1, sensitive: 1, grudge: p.proud ? 2 : 1, rep: {} };
const bandIdx = s => clamp(s, -3, 3) + 3;
// Что персонаж слышал о {{user}} — взвешено по тем граням, что важны ему (весть дошла с его задержкой).
export function repOf(world, id) {
    const p = byId[id], st = world.people[id];
    let r = 0;
    for (const [f, k] of Object.entries(TP(p).rep || {})) r += k * (st.seen[REP + f] || 0);
    return r;
}
// Добрые жесты и события от человека с доброй славой весят больше (±5 → ±40%).
const repMult = (world, id) => clamp(1 + (T.repMult ?? 0) * repOf(world, id), T.repMultMin ?? 1, T.repMultMax ?? 1);

export function value(world, id, dim) {
    const p = byId[id], st = world.people[id];
    if (dim === 'like' || dim === 'love') return p.romance || dim === 'like' ? clamp(st.level[dim] + st.mem[dim], -T.levelMax, T.levelMax) : 0;
    let v = ownTrust(world, id);
    // Слава {{user}}: знакомые судят больше по делам, незнакомые — только по слухам.
    v += (st.met ? (T.repTrustMet ?? 0) : (T.repTrustStranger ?? 0)) * repOf(world, id);
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

export function findId(name) {
    const n = String(name).replace(/[«»"]/g, '').trim().toLowerCase();
    for (const p of PEOPLE.people) if (p.aliases.some(a => n === a.toLowerCase() || n.startsWith(a.toLowerCase() + ' ') || n.endsWith(' ' + a.toLowerCase()))) return p.id;
    return null;
}

// Разбор строк персонажей из раздела ЭФФЕКТЫ:
//   «Лисия: Доверие −2; Приязнь +1; Влечение +1 — причина»   «ЗНАКОМСТВО: Айша»
//   «ЖЕСТ: Томоэ · подарок · сладости · 300 G — купил на рынке»   «ЖЕСТ: Джуна · флирт · наедине — …»
export function parsePeople(text) {
    const out = [], meet = [], gestures = [], unknown = [];
    for (const raw of String(text).split('\n')) {
        const line = String(raw).replace(/\s*[•]\s*/g, '·');
        const mm = line.match(/ЗНАКОМСТВО:\s*(.+)/);
        if (mm) { for (const n of mm[1].split(/[,;]\s*/)) { const id = findId(n.trim()); if (id) meet.push(id); } continue; }
        const gm = line.match(/^\s*ЖЕСТ:\s*(.+)$/);
        if (gm) {
            const [head, ...rest] = gm[1].split(/\s[—–-]\s/);
            const parts = head.split('·').map(s => s.trim()).filter(Boolean);
            const id = findId(parts[0] || '');
            const type = Object.keys(G.base).find(t => parts.slice(1).some(x => x.toLowerCase().startsWith(t.slice(0, 5))));
            if (!id || !type) { unknown.push(line.trim()); continue; }
            const money = parts.find(x => /\d/.test(x) && /G|тыс|млн/.test(x));
            let g = 0;
            if (money) {
                const m = money.match(/(\d[\d\s ]*(?:[.,]\d+)?)\s*(тыс\.?|тысяч\w*|млн|миллион\w*)?/i);
                g = parseFloat(m[1].replace(/[\s ]/g, '').replace(',', '.')) * (/млн|миллион/i.test(m[2] || '') ? 1e6 : /тыс/i.test(m[2] || '') ? 1e3 : 1);
            }
            const sub = parts.slice(1).find(x => !x.toLowerCase().startsWith(type.slice(0, 5)) && !/\d/.test(x) && !/наедине/i.test(x));
            gestures.push({ id, type, sub: sub ? sub.toLowerCase() : null, g, private: parts.some(x => /наедине/i.test(x)), note: rest.join(' — ').trim().slice(0, 120) });
            continue;
        }
        if (!/Доверие|Приязнь|Влечение/.test(line)) continue;
        const who = line.match(/^\s*(?:НА\s+\d+[^:]*:\s*|ЧЕРЕЗ\s+\d+[^:]*:\s*)?([^:]+):/);
        const id = who && findId(who[1].trim());
        if (!id) { unknown.push(line.trim()); continue; }
        const d = { id, trust: 0, like: 0, love: 0, note: (line.split(/\s[−–-]\s|—/).slice(1).join(' ').trim() || '').slice(0, 120) };
        for (const m of line.matchAll(/(Доверие|Приязнь|Влечение)\s*([+−–\-])\s*(\d+(?:[.,]\d+)?)/g)) {
            d[DIMS[m[1]]] += (m[2] === '+' ? 1 : -1) * clamp(parseFloat(m[3].replace(',', '.')), 0, 3);
        }
        if (d.trust || d.like || d.love) out.push(d);
    }
    return { events: out, meet, gestures, unknown };
}

// Вкус к жесту: «подарок:сладости» уточняет «подарок».
function taste(p, type, sub) {
    const t = p.tastes || {};
    if (sub) for (const [k, v] of Object.entries(t)) if (k.startsWith(type + ':') && sub.startsWith(k.split(':')[1].slice(0, 4))) return v;
    return t[type] ?? 1;
}

// Вес жеста по осям [приязнь, доверие, влечение] до привыкания.
function gestureWeight(world, p, gst) {
    const st = world.people[p.id];
    if (p.minor && (gst.type === 'флирт' || (gst.type === 'подарок' && /украшен|цвет|духи/.test(gst.sub || '')))) return [...G.minor];
    const tv = taste(p, gst.type, gst.sub);
    let [like, trust, love] = G.base[gst.type];
    if (gst.type === 'подарок') {
        const daily = MERA.economy.status[p.tier] * MERA.economy.WAGE;
        const r = gst.g / daily;
        like = (G.gift.find(([lim]) => lim != null && r < lim) || G.gift[G.gift.length - 1])[1];
        if (r < G.gift[0][0] && p.proud && MERA.economy.status[p.tier] >= MERA.economy.status['знать']) return [G.giftSlight, 0, 0];
        if (tv < 0) return r > G.bribeRatio ? [tv * 0.5, tv * 0.5, 0] : [0.2, 0, 0]; // не берёт подарков: мелочь — вежливость, дорогое — взятка
        love = p.romance && st.band.like.s >= 1 ? 0.3 : 0;
    }
    if (gst.type === 'флирт') {
        if (!p.romance) return [G.unwelcome * 0.6, 0, 0];                       // не к месту: занят, в браке, не тот человек
        if (st.band.like.s < 1) return [G.unwelcome, 0, G.unwelcome];          // навязчиво: ещё не тепло
    }
    const m = tv;
    return [like * m, trust * Math.max(0, m), p.romance ? love * Math.max(0, m) : 0];
}

// Применить личные события и жесты в день `day`; demand — имена, кому предъявлено прямое требование.
export function applyPeople(world, parsed, day, demand = [], delayOf = () => 1) {
    world.peopleQueue = world.peopleQueue || [];
    // Событие: постоянный след + свежесть поверх. Жест (keep < 1): весит ровно v — доля keep навсегда, остальное остывает.
    const put = (st, k, v, keep) => {
        if (keep >= 1) { st.level[k] = clamp(st.level[k] + v, -T.levelMax, T.levelMax); st.mem[k] += T.memoryShock * v; return; }
        st.level[k] = clamp(st.level[k] + v * keep, -T.levelMax, T.levelMax); st.mem[k] += v * (1 - keep);
    };
    for (const e of parsed.events) {
        const st = world.people[e.id];
        if (!st) continue;
        st.lastEv = st.lastEv || {};
        const tp = TP(byId[e.id]), bT = bandIdx(st.band.trust.s), rm = repMult(world, e.id);
        for (const k of ['trust', 'like', 'love']) {
            if (!e[k] || (k === 'love' && !byId[e.id].romance)) continue;
            // Зло помнится сильнее добра: тяжкая обида (−3: предал, унизил при всех) весит больше трёх мелочей,
            // а обида снова в течение месяца — уже курс, а не случай. Добрые дела — линейно.
            // Характер и нынешнее отношение: доверчивость и подозрительность врага — к добру; ранимость и близость — к обиде.
            const prev = st.lastEv[k];
            const f = e[k] >= 0
                ? rm * (k === 'trust' ? tp.trusting * (T.goodByTrust?.[bT] ?? 1) : 1)
                : (e[k] <= -3 ? (T.graveFactor ?? 1) : 1) * (prev && prev.v < 0 && day - prev.day <= (T.repeatWindow ?? 0) ? (T.repeatFactor ?? 1) : 1)
                  * tp.sensitive * (T.hurtByTrust?.[bT] ?? 1);
            put(st, k, e[k] * f, 1);
            st.lastEv[k] = { day, v: e[k] };
        }
        st.met = true;
        st.last.unshift({ day, trust: e.trust, like: e.like, love: e.love, note: e.note });
        st.last = st.last.slice(0, 3);
    }
    // Жесты: вкусы, привыкание, предел за сцену; на виду — ревность тех, кто влюблён в {{user}}.
    const batch = {};
    for (const gst of parsed.gestures || []) {
        const p = byId[gst.id], st = world.people[gst.id];
        if (!st) continue;
        st.gestures = (st.gestures || []).filter(x => day - x.day < G.habitWindow);
        const habit = Math.pow(G.habitMult, st.gestures.filter(x => x.type === gst.type).length);
        st.gestures.push({ day, type: gst.type });
        let [lk, tr, lv] = gestureWeight(world, p, gst).map(v => v * habit);
        // Характер и нынешнее отношение: чуткость × «как звучит от этого человека сейчас» × слава {{user}}; дурное — по ранимости.
        const tp = TP(p), aL = T.attentionByLike?.[bandIdx(st.band.like.s)] ?? 1, gT = T.goodByTrust?.[bandIdx(st.band.trust.s)] ?? 1, rm = repMult(world, p.id);
        lk = lk > 0 ? lk * tp.attention * aL * rm : lk * tp.sensitive;
        lv = lv > 0 ? lv * tp.attention * aL * rm : lv * tp.sensitive;
        tr = tr > 0 ? tr * tp.attention * tp.trusting * gT * rm : tr * tp.sensitive;
        const b = batch[gst.id] = batch[gst.id] || { like: 0, trust: 0, love: 0 };
        const cap = (k, v) => { const nv = clamp(b[k] + v, -G.batchCap, G.batchCap); const d = nv - b[k]; b[k] = nv; return d; };
        const dl = cap('like', lk), dt = cap('trust', tr), dv = cap('love', lv);
        if (dl) put(st, 'like', dl, G.keep);
        if (dt) put(st, 'trust', dt, G.keep);
        if (dv && p.romance) put(st, 'love', dv, G.keep);
        st.met = true;
        st.last.unshift({ day, trust: dt, like: dl, love: dv, note: `${gst.type}${gst.sub ? ' (' + gst.sub + ')' : ''}${gst.g ? ', ' + Math.round(gst.g) + ' G' : ''}${gst.note ? ': ' + gst.note : ''}` });
        st.last = st.last.slice(0, 3);
        const romantic = gst.type === 'флирт' || (gst.type === 'подарок' && lv > 0);
        if (romantic && !gst.private) {
            for (const q of PEOPLE.people) {
                if (q.id === gst.id || !q.romance) continue;
                const sq = world.people[q.id];
                if (sq.band.love.s < 2) continue;                                   // ревнуют влюблённые
                const hurt = -G.jealousy * (1 - (q.tolerance ?? 0.5));
                if (hurt) world.peopleQueue.push({ at: day + Math.max(0, delayOf(q.id) - 1), id: q.id, like: hurt, note: `ревность: {{user}} ухаживает за ${p.name}` });
            }
        }
    }
    for (const id of parsed.meet) if (world.people[id]) world.people[id].met = true;
    for (const raw of demand) {
        const id = findId(raw);
        if (id && world.people[id] && !byId[id].actor) world.people[id].provoked = day + 1;
    }
    for (const p of PEOPLE.people) syncPersonal(world, p.id);
    return world;
}

// Один день для персонажей: дошедшие вести и слухи, остывание, ступени.
export function stepPeople(world, day, delayOf) {
    if (day <= world.peopleDay) return;
    for (const q of (world.peopleQueue || []).filter(x => x.at <= day)) {
        const st = world.people[q.id];
        st.mem.like += q.like * (1 - G.keep);
        st.level.like = clamp(st.level.like + q.like * G.keep, -T.levelMax, T.levelMax);
        st.last.unshift({ day, like: q.like, note: q.note }); st.last = st.last.slice(0, 3);
    }
    if (world.peopleQueue) world.peopleQueue = world.peopleQueue.filter(x => x.at > day);
    for (const p of PEOPLE.people) {
        const st = world.people[p.id];
        const delay = delayOf(p.id);
        while (st.cursor < world.axesLog.length && world.axesLog[st.cursor].day + delay <= day) {
            const e = world.axesLog[st.cursor];
            if ((e.origin ?? st.cursor) >= world.peopleBaseSeq) for (const [axis, v] of Object.entries(e.d)) st.seen[axis] = (st.seen[axis] || 0) + v;
            st.cursor++;
        }
        for (const k of ['trust', 'like', 'love']) {
            // Свежая обида держится по злопамятности и отношению (друг прощает быстрее, враг копит); добро остывает обычно.
            const base = k === 'trust' ? T.halfLifeTrust : k === 'like' ? T.halfLifeLike : T.halfLifeLove;
            const hl = st.mem[k] < 0 ? base * TP(p).grudge * (T.grudgeByBand?.[bandIdx(st.band[k].s)] ?? 1) : base;
            st.mem[k] *= Math.pow(0.5, 1 / hl);
        }
    }
    for (const p of PEOPLE.people) syncPersonal(world, p.id);
    for (const p of PEOPLE.people) {
        const st = world.people[p.id];
        for (const k of dimsOf(p)) {
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

// Продвинуть мир и персонажей вместе, день за днём (без казны; полный порядок — world.js).
export function advanceAll(world, toDay, delayOf) {
    if (!world.people) return advance(world, toDay);
    for (let day = Math.max(world.lastDay, world.peopleDay) + 1; day <= toDay; day++) {
        advance(world, day);
        stepPeople(world, day, delayOf);
    }
    return world;
}

const fmtV = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',');

// Сводка для рассказчика: ступени дела, личного и влечения, тенденция, свежий повод.
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
        let love = '';
        if (p.romance && (st.band.love.s || Math.abs(value(world, p.id, 'love')) >= 0.5)) love = `; влечение — ${PEOPLE.ladders.love[String(st.band.love.s)]} (${fmtV(value(world, p.id, 'love'))})`;
        const fresh = st.last[0] ? ` · свежее (${fmtDate(st.last[0].day)}): ${st.last[0].note || 'без пояснения'}` : '';
        if (!st.met) return `${p.name}: не знакомы; по слухам — дело: ${deed}`;
        return `${p.name}: дело — ${deed}; лично — ${personal}${love}${p.minor ? ' · ребёнок: никаких ухаживаний' : ''}${fresh}`;
    }).join('\n');
}
