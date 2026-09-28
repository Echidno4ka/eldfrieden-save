// «Хозяйство»: казна короны в G и дела короны. Числа — только из «Меры мира» (mera.data.js → economy).
// Летописец объявляет решения (КАЗНА, СОКРОВИЩНИЦА, ЕЖЕМЕСЯЧНО, ДОЛГ, ДЕЛО), код считает деньги, сроки и сбыт,
// а ось «Ресурсы» в «Реакции мира» выводит из остатка казны.
import { MERA } from './mera.data.js';
import { REACTION } from './reaction.data.js';
import { applyEffects } from './reaction.js';

const E = MERA.economy, L = E.ledger;
const MONTH = 32;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const armyMonth = () => E.armyYear / E.monthsYear;
const otherMonth = () => E.otherYear / E.monthsYear;
const spendMonth = () => armyMonth() + otherMonth();
const P = Object.fromEntries(MERA.places.map(p => [p.id, p]));
const km = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * ((a.road + b.road) / 2);

// ---- деньги в тексте ----
export function fmtG(v) {
    const s = v < 0 ? '−' : '';
    const a = Math.abs(v);
    const n = (x, d) => x.toFixed(d).replace('.', ',').replace(/,0+$/, '');
    if (a >= 1e9) return `${s}${n(a / 1e9, 2)} млрд G`;
    if (a >= 1e6) return `${s}${n(a / 1e6, a >= 1e8 ? 0 : 1)} млн G`;
    const r = a >= 10000 ? Math.round(a / 1000) * 1000 : Math.round(a);     // мелкие суммы (жалованье) — без округления до нуля
    return `${s}${String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} G`;
}
function parseG(num, unit) {
    const v = parseFloat(String(num).replace(/[\s ]/g, '').replace(',', '.'));
    if (!isFinite(v)) return null;
    const u = String(unit || '').toLowerCase();
    const k = /млрд|миллиард/.test(u) ? 1e9 : /млн|миллион/.test(u) ? 1e6 : /тыс/.test(u) ? 1e3 : 1;
    return v * k;
}
const MONEY = /([+−\-–]?)\s*(\d[\d\s ]*(?:[.,]\d+)?)\s*(тыс\.?|тысяч\w*|млн|миллион\w*|млрд|миллиард\w*)?\s*G?/i;
const sign = s => (s === '−' || s === '-' || s === '–') ? -1 : 1;

// ---- состояние ----
function resourcesOf(eco) {
    const runway = (eco.cash - eco.debt - eco.arrears - (eco.loan || 0)) / spendMonth();
    return clamp(runway / L.runwayUnit, -REACTION.tempo.axisMax, REACTION.tempo.axisMax);
}

// Казна заводится так, чтобы остаток соответствовал текущим «Ресурсам» мира (для старта и старых сохранений).
export function initEconomy(world, day) {
    const debt = E.tribute;
    const res = world.axes['Ресурсы'] ?? 0;
    world.eco = {
        cash: res * L.runwayUnit * spendMonth() + debt, hoard: E.hoard, debt, arrears: 0,
        recurring: {}, ent: [], scheduled: [], log: [], start: day, lastDay: day, lastIncome: E.revenueYear / E.monthsYear,
    };
    return world;
}

// Сбор податей в месяц: от перемен с момента призыва (подати, сытость, порядок, власть).
export function incomeMonth(world) {
    let m = 1;
    for (const [axis, s] of Object.entries(L.taxSens)) m *= 1 + s * ((world.axes[axis] ?? 0) - (REACTION.initialAxes[axis] ?? 0));
    return E.revenueYear / E.monthsYear * Math.max(L.taxFloor, m);
}

// ---- разбор строк Летописца ----
//   КАЗНА: −250 000 000 G — дань Империи           разовый приход (+) или расход (−)
//   СОКРОВИЩНИЦА: продать треть | 33%                сокровища в деньги (навсегда)
//   ЕЖЕМЕСЯЧНО: −600 000 G — сборщики лома           постоянная статья; «0 G — имя» отменяет
//   ДОЛГ: −250 000 000 G — дань Империи               погасить долг Империи (или «ДОЛГ: погасить»)
//   ДОЛГ ВОЙСКУ: выплатить                            погасить задержанное жалованье
//   ДЕЛО: мастерская линз · ремесло · малое · сбыт: знать, Зем
//   ДЕЛО ЗАКРЫТЬ: мастерская линз
export function parseEconomy(text) {
    const r = { cash: [], hoard: [], recurring: [], debt: [], armyPay: false, ent: [], close: [], unknown: [] };
    for (const raw of String(text).split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        let m;
        if ((m = line.match(/^ДЕЛО ЗАКРЫТЬ:\s*(.+)$/))) { r.close.push(m[1].trim()); continue; }
        if ((m = line.match(/^ДЕЛО:\s*(.+)$/))) {
            const parts = m[1].split('·').map(s => s.trim());
            const name = parts[0];
            const kind = Object.keys(E.templates).find(k => parts.some(p => p.toLowerCase().startsWith(k.slice(0, 5))));
            const size = E.sizes.find(s => parts.some(p => p.toLowerCase().startsWith(s.slice(0, 4))));
            const sb = (parts.find(p => /^сбыт/i.test(p)) || '').replace(/^сбыт:?\s*/i, '');
            const markets = sb.split(/[,;]\s*/).map(s => s.trim().toLowerCase()).filter(Boolean)
                .map(s => Object.keys(E.markets).find(k => s.startsWith(k.toLowerCase().slice(0, 4)))).filter(Boolean);
            // Вид не из списка («шлифовальное»), но размер назван — это мастерская: считаем ремеслом. Без размера — не дело короны.
            const kindOr = kind || (size && E.templates['ремесло'] ? 'ремесло' : null);
            if (!name || !kindOr) { r.unknown.push(line); continue; }
            r.ent.push({ name, kind: kindOr, size: size || E.sizes[0], markets: markets.length ? [...new Set(markets)] : ['города'] });
            continue;
        }
        if (/^ДОЛГ ВОЙСКУ:/.test(line)) { r.armyPay = true; continue; }
        if (/^ДОЛГ:\s*(отказ|не\s*призна|аннулир)/i.test(line)) { r.repudiate = true; continue; }
        if ((m = line.match(/^ДОЛГ:\s*(.*)$/))) {
            const mm = m[1].match(MONEY);
            const g = mm && /\d/.test(mm[2]) ? parseG(mm[2], mm[3]) : Infinity;
            r.debt.push({ g, note: m[1].split(/\s[—–-]\s/).slice(1).join(' — ').trim() });
            continue;
        }
        if ((m = line.match(/^СОКРОВИЩНИЦА:\s*(.*)$/))) {
            const t = m[1].toLowerCase();
            const pct = t.match(/(\d+(?:[.,]\d+)?)\s*%/);
            const share = pct ? parseFloat(pct[1].replace(',', '.')) / 100 : /половин/.test(t) ? 0.5 : /треть/.test(t) ? 1 / 3 : /четверт/.test(t) ? 0.25 : /пят/.test(t) ? 0.2 : /вс[её]/.test(t) ? 1 : null;
            if (share === null) { r.unknown.push(line); continue; }
            r.hoard.push({ share: clamp(share, 0, 1), note: m[1] });
            continue;
        }
        if ((m = line.match(/^(КАЗНА|ЕЖЕМЕСЯЧНО):\s*(.*)$/))) {
            const mm = m[2].match(MONEY);
            if (!mm || !/\d/.test(mm[2])) { r.unknown.push(line); continue; }
            const g = sign(mm[1]) * parseG(mm[2], mm[3]);
            const note = m[2].split(/\s[—–-]\s/).slice(1).join(' — ').trim() || m[2];
            (m[1] === 'КАЗНА' ? r.cash : r.recurring).push({ g, note });
            continue;
        }
        r.unknown.push(line);
    }
    return r;
}

function logEco(eco, day, text) { eco.log.push({ day, text }); eco.log = eco.log.slice(-40); }
const fromNow = (day, n) => day + n;

function marketLag(market) {
    const m = E.markets[market];
    return Math.ceil(km(P.parnam, P[m.place] || P.parnam) / E.templates['торговля'][0].cartKmDay);
}

// fallback — «Ресурсы ±n», которые Летописец написал вместо суммы: { now, later:[{days, points, note}], temp:[{days, points, note}] }.
const TRADE_LOSSES_STOP = 2;    // столько убыточных рейсов подряд — и торговое дело встаёт
const ARREARS_HIT_MAX = 3;     // сколько раз невозвращённый долг жалованья ударит по войску сверх самой задержки
// Защита от повторов: доклады и пропуски времени пересказывают прошлые решения — второй раз их не считаем.
const HOARD_REPEAT_DAYS = 96;                                   // вторая продажа за сезон — только явно («ещё», «снова»)
const HOARD_AGAIN = /ещ[её]|дополнительн|снова|повторн|втор/i;
const HOARD_PROCEEDS = /сокровищ|ценност|драгоцен|распрода/i;   // выручку от продажи сокровищ код уже зачислил
// Правдоподобие сумм (доли годового дохода короны из «Меры»): модель не может напечатать деньги или разорить корону одной строкой.
const ONE_OFF_FREE = 0.05;      // разовый доход без названного источника — не больше
const ONE_OFF_SOURCED = 0.5;    // с источником (конфискация, продажа, пошлины…) — не больше
const LOAN_MAX = 0.5;           // долг банкирам всего — не больше
const RECUR_IN = 0.2, RECUR_OUT = 0.3;   // постоянная статья — доля месячного дохода
const INCOME_SOURCE = /конфиск|изъят|прода|выкуп|трофе|контрибуц|пошлин|налог|подат|сбор|пожертв|откуп|аренд|выручк|доход с|рейс/i;
const LOAN = /за[её]м|займ|кредит|в долг у|банкир|менял/i;
// Потратить не больше, чем дадут казна и банкиры; вернуть, сколько реально ушло.
function spend(eco, day, g, note, notes) {
    const avail = Math.max(0, eco.cash + E.credit);
    if (g <= avail) { eco.cash -= g; return g; }
    eco.cash -= avail;
    logEco(eco, day, `не хватило денег: ${note} — оплачено ${fmtG(avail)} из ${fmtG(g)}`);
    notes.push('урезано');
    return avail;
}
const DEBT_NOTE =/дан[ьиью]|долг[а-я]* импери|импери[а-я]* долг|погашени[а-я]* долга/i;
const entKey = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"'„“]/g, '').replace(/\s+/g, ' ').trim();

export function applyEconomy(world, parsed, day, fallback = null, delayActor = () => 1) {
    const eco = world.eco;
    const notes = [];
    // Сначала сокровищница: её выручка оплачивает траты той же пачки.
    for (const h of parsed.hoard) {
        if (eco.lastHoardDay != null && day - eco.lastHoardDay < HOARD_REPEAT_DAYS && !HOARD_AGAIN.test(h.note)) { logEco(eco, day, `повтор не учтён: продажа сокровищницы уже была ${day - eco.lastHoardDay} дн. назад`); notes.push('повтор'); continue; }
        const g = eco.hoard * h.share;
        eco.hoard -= g; eco.cash += g;
        eco.lastHoardDay = day;
        logEco(eco, day, `продано из сокровищницы ${fmtG(g)} (${Math.round(h.share * 100)}%)`);
    }
    for (const c of parsed.cash) {
        if (c.g > 0 && eco.lastHoardDay != null && HOARD_PROCEEDS.test(c.note)) { logEco(eco, day, `повтор не учтён: ${fmtG(c.g)} — ${c.note} (выручка сокровищницы уже зачислена)`); notes.push('повтор'); continue; }
        // Заём у банкиров — не подарок: долг с процентами, не больше предела доверия банкиров.
        if (c.g > 0 && LOAN.test(c.note)) {
            const g = Math.min(c.g, Math.max(0, LOAN_MAX * E.revenueYear - (eco.loan || 0)));
            eco.loan = (eco.loan || 0) + g; eco.cash += g;
            logEco(eco, day, g < c.g ? `заём ${fmtG(g)} из ${fmtG(c.g)} — ${c.note} (больше банкиры не дают)` : `заём ${fmtG(g)} — ${c.note} (${Math.round(L.interestMonth * 100)}% в месяц)`);
            if (g < c.g) notes.push('урезано');
            continue;
        }
        // Правдоподобие: крупный доход — только из названного источника.
        if (c.g > 0) {
            const src = INCOME_SOURCE.test(c.note);
            const lim = (src ? ONE_OFF_SOURCED : ONE_OFF_FREE) * E.revenueYear;
            if (c.g > lim) { logEco(eco, day, `урезано: ${fmtG(c.g)} — ${c.note} → ${fmtG(lim)} (${src ? 'больше полугодового дохода короны' : 'без источника: конфискация, продажа, пошлины, заём'})`); notes.push('урезано'); c.g = lim; }
        }
        // Дань или долг, записанные тратой КАЗНА, гасят долг Империи — не больше самого долга (сумму берём из «Меры», не из фантазии).
        if (c.g < 0 && eco.debt > 0 && DEBT_NOTE.test(c.note)) {
            const g = spend(eco, day, Math.min(-c.g, eco.debt), c.note, notes);
            eco.debt -= g;
            logEco(eco, day, `погашено долга ${fmtG(g)} — ${c.note}${-c.g > g ? ` (записано ${fmtG(-c.g)})` : ''}`);
            continue;
        }
        if (c.g < 0) { const g = spend(eco, day, -c.g, c.note, notes); logEco(eco, day, `${fmtG(-g)} — ${c.note}`); continue; }
        eco.cash += c.g; logEco(eco, day, `${fmtG(c.g)} — ${c.note}`);
    }
    for (const d of parsed.debt) {
        if (LOAN.test(d.note) && eco.loan > 0) {            // вернуть банкирам
            const g = spend(eco, day, Math.min(d.g, eco.loan), d.note, notes);
            eco.loan -= g; logEco(eco, day, `возвращено банкирам ${fmtG(g)}`); continue;
        }
        const g = spend(eco, day, Math.min(d.g, eco.debt), d.note || 'дань Империи', notes);
        eco.debt -= g;
        logEco(eco, day, `погашено долга ${fmtG(g)}${d.note ? ' — ' + d.note : ''}`);
    }
    if (parsed.repudiate && eco.debt > 0) {
        logEco(eco, day, `долг Империи ${fmtG(eco.debt)} не признан`);
        eco.debt = 0;
        applyEffects(world, { deltas: { 'Выгода·Империя': -3, 'Угроза·Империя': 2, 'Устои': -1 }, remove: [], demand: [] }, day, delayActor, 'долг Империи не признан');
    }
    for (const rc of parsed.recurring) {
        // Постоянная статья не больше правдоподобной доли месячного дохода короны.
        const lim = (rc.g > 0 ? RECUR_IN : RECUR_OUT) * E.revenueYear / E.monthsYear;
        if (Math.abs(rc.g) > lim) { logEco(eco, day, `урезано: ежемесячно ${fmtG(rc.g)} — ${rc.note} → ${fmtG(Math.sign(rc.g) * lim)}`); notes.push('урезано'); rc.g = Math.sign(rc.g) * lim; }
        if (rc.g === 0) delete eco.recurring[rc.note]; else eco.recurring[rc.note] = rc.g;
        logEco(eco, day, `ежемесячно ${fmtG(rc.g)} — ${rc.note}`);
    }
    if (parsed.armyPay && eco.arrears > 0) {
        const pay = Math.min(eco.arrears, Math.max(0, eco.cash + E.credit));
        if (pay > 0) {
            const share = pay / eco.arrears;
            eco.cash -= pay; eco.arrears -= pay;
            const months = Math.max(1, Math.round(pay / armyMonth()));
            const back = Math.round((eco.arrearsHit || 0) * share);      // обида за «долг не возвращён» — в меру выплаченного
            eco.arrearsHit = (eco.arrearsHit || 0) - back;
            applyEffects(world, { deltas: { 'Достаток·войско': Math.min(3, months) + back }, remove: [], demand: [] }, day, delayActor, 'долг войску выплачен');
            logEco(eco, day, `выплачено задержанное жалованье ${fmtG(pay)}`);
        }
    }
    for (const n of parsed.close) {
        const e = eco.ent.find(x => x.open && x.name.toLowerCase() === n.toLowerCase());
        if (e) { e.open = false; logEco(eco, day, `закрыто дело «${e.name}»`); }
    }
    for (const spec of parsed.ent) {
        if (eco.ent.some(x => x.open && entKey(x.name) === entKey(spec.name))) { logEco(eco, day, `повтор не учтён: дело «${spec.name}» уже заведено`); notes.push('повтор'); continue; }
        const t =E.templates[spec.kind][Math.max(0, E.sizes.indexOf(spec.size))];
        const lag = Math.min(...spec.markets.map(marketLag));
        const e = { name: spec.name, kind: spec.kind, size: spec.size, markets: spec.markets, open: true, started: day, sold: 0, profit: 0 };
        const cost = t.capital || t.setup;
        if (eco.cash - cost < -E.credit) { logEco(eco, day, `дело «${spec.name}» не заведено: нет ${fmtG(cost)} даже в долг`); notes.push('урезано'); continue; }
        if (t.capital) {
            e.capital = t.capital; e.tripDays = 2 * lag; e.readyDay = day; e.firstSaleDay = day + e.tripDays; e.tripEnd = e.firstSaleDay;
            eco.cash -= t.capital;
            logEco(eco, day, `торговое дело «${e.name}»: закуплено товара на ${fmtG(t.capital)}, рейс ${e.tripDays} дн.`);
        } else {
            e.readyDay = fromNow(day, t.lead); e.firstSaleDay = e.readyDay + lag;
            eco.cash -= t.setup;
            logEco(eco, day, `заведено дело «${e.name}» (${spec.kind}, ${spec.size}): вложено ${fmtG(t.setup)}`);
        }
        eco.ent.push(e);
    }
    // «Ресурсы ±n» вместо суммы: переводим по курсу из «Меры» и предупреждаем.
    if (fallback) {
        const per = E.revenueYear * L.fallbackPerPoint;
        if (fallback.now) { eco.cash += fallback.now * per; logEco(eco, day, `≈${fmtG(fallback.now * per)} (записано как «Ресурсы ${fallback.now > 0 ? '+' : '−'}${Math.abs(fallback.now)}»)`); notes.push('Ресурсы'); }
        for (const l of fallback.later || []) eco.scheduled.push({ at: day + l.days, g: l.points * per, note: l.note });
        for (const t of fallback.temp || []) { eco.cash += t.points * per; eco.scheduled.push({ at: day + t.days, g: -t.points * per, note: 'прошло: ' + t.note }); }
    }
    return notes;
}

// Подарки и траты в жестах идут из казны — как любые траты, не больше, чем дадут казна и банкиры.
export function chargeGifts(world, gestures, day) {
    const eco = world.eco;
    if (!eco) return 0;
    let total = 0;
    for (const g of gestures || []) {
        if (!(g.g > 0)) continue;
        const paid = spend(eco, day, g.g, `подарок (${g.id})`, []);
        total += paid;
        logEco(eco, day, `${fmtG(-paid)} — ${g.type}${g.sub ? ' (' + g.sub + ')' : ''}: ${g.id}`);
    }
    return total;
}

// Спрос рынка на дела короны: враждебный сосед не покупает, выгода от Эльфридена его расширяет.
function marketFactor(world, market) {
    const m = E.markets[market];
    if (!m.actor) return 1;
    const a = REACTION.actors.find(x => x.id === m.actor);
    if (!a || world.removed.includes(a.id)) return 1;
    const st = world.stage[a.id].s;
    if (st >= 3) return 0;
    const gain = world.axes[`Выгода·${m.actor}`] ?? 0;
    return (1 - 0.25 * st) * clamp(1 + 0.1 * gain, 0.5, 1.5);
}

// Один день казны: подати, расходы, проценты, армия (раз в месяц), дела, отложенное, «Ресурсы».
export function stepEconomy(world, day, delayActor) {
    const eco = world.eco;
    if (!eco || day <= eco.lastDay) return;
    const inc = incomeMonth(world);
    eco.lastIncome = inc;
    const rec = Object.values(eco.recurring).reduce((s, g) => s + g, 0);
    eco.cash += (inc - otherMonth() + rec) / MONTH;
    if (eco.cash < 0) eco.cash -= -eco.cash * L.interestMonth / MONTH;
    if (eco.loan > 0) eco.cash -= eco.loan * L.interestMonth / MONTH;      // проценты банкирам по займам
    // Армия получает раз в месяц; если казна пуста сверх займов — жалованье задерживают, и войско это помнит.
    if ((day - eco.start) % MONTH === 0) {
        const oldDebt = eco.arrears >= armyMonth() / 2;
        if (eco.cash - armyMonth() < -E.credit) {
            eco.arrears += armyMonth();
            applyEffects(world, { deltas: { 'Достаток·войско': -1 }, remove: [], demand: [] }, day, delayActor, 'казна пуста — жалованье войску задержано');
            logEco(eco, day, `казна пуста сверх займов — жалованье войску задержано (${fmtG(armyMonth())})`);
        } else eco.cash -= armyMonth();
        // Старый долг жалованья: пока не вернули, каждый месяц — ещё обида (не глубже ARREARS_HIT_MAX), при выплате вернётся.
        if (oldDebt && (eco.arrearsHit || 0) < Math.min(ARREARS_HIT_MAX, Math.ceil(eco.arrears / armyMonth()))) {   // месяц долга — не больше удара на месяц
            eco.arrearsHit = (eco.arrearsHit || 0) + 1;
            applyEffects(world, { deltas: { 'Достаток·войско': -1 }, remove: [], demand: [] }, day, delayActor, 'долг жалованья не возвращён');
            logEco(eco, day, `долг жалованья войску ${fmtG(eco.arrears)} не возвращён — войско помнит`);
        }
    }
    // Дела короны.
    const serving = {};
    for (const e of eco.ent) if (e.open) for (const mk of e.markets) serving[mk] = (serving[mk] || 0) + 1;
    for (const e of eco.ent) {
        if (!e.open) continue;
        const t = E.templates[e.kind][Math.max(0, E.sizes.indexOf(e.size))];
        const demand = e.markets.reduce((s, mk) => s + E.markets[mk].gMonth * marketFactor(world, mk) / serving[mk], 0);
        if (t.capital) {
            if (day >= e.tripEnd) {
                const want = t.capital * (1 + t.margin);
                const sold = Math.min(want, demand * e.tripDays / MONTH);
                const net = sold - t.capital * t.costs;
                eco.cash += net;               // капитал вернулся с прибылью (или меньше, если сбыт узок)
                e.sold += sold; e.profit += net - t.capital;
                logEco(eco, day, `рейс «${e.name}» вернулся: выручка ${fmtG(sold)}, чистыми ${fmtG(net - t.capital)}`);
                // Купец не возит в убыток вечно и не закупает товар на деньги, которых нет.
                e.losses = net < t.capital ? (e.losses || 0) + 1 : 0;
                if (e.losses >= TRADE_LOSSES_STOP) { e.open = false; logEco(eco, day, `дело «${e.name}» встало: ${e.losses} рейса подряд в убыток, товар не расходится`); continue; }
                if (eco.cash - t.capital < -E.credit) { e.tripEnd = day + MONTH; if (!e.waiting) logEco(eco, day, `дело «${e.name}» ждёт: нет денег на товар`); e.waiting = true; continue; }
                e.waiting = false;
                eco.cash -= t.capital;         // новый рейс
                e.tripEnd = day + e.tripDays;
            }
            continue;
        }
        eco.cash -= t.payMonth / MONTH;        // жалованье — с первого дня
        e.profit -= t.payMonth / MONTH;
        if (day >= e.firstSaleDay) {
            const sales = Math.min(t.valueMonth, demand) / MONTH;
            const net = sales * (1 - t.materials);
            eco.cash += net; e.sold += sales; e.profit += net;
            e.share = t.valueMonth > 0 ? Math.min(1, demand / t.valueMonth) : 0;
        }
    }
    // Отложенное (из «Ресурсы» вместо сумм).
    for (const s of eco.scheduled.filter(x => x.at === day)) { eco.cash += s.g; logEco(eco, day, `${fmtG(s.g)} — ${s.note}`); }
    eco.scheduled = eco.scheduled.filter(x => x.at > day);
    // «Ресурсы» следуют за казной: сдвиг целыми пунктами, когда разошлись на пункт и больше.
    const target = resourcesOf(eco);
    const cur = world.axes['Ресурсы'] ?? 0;
    if (Math.abs(target - cur) >= 1) {
        const d = Math.trunc(target - cur);
        applyEffects(world, { deltas: { 'Ресурсы': d }, remove: [], demand: [] }, day, delayActor, 'казна');
    }
    eco.lastDay = day;
}

// Страж: продажа товара дела раньше, чем он сделан и довезён.
export function economyGuard(world, newLines, day, fmtDate) {
    const eco = world.eco;
    if (!eco) return null;
    for (const e of eco.ent) {
        if (!e.open || day >= e.firstSaleDay) continue;
        const stem = e.name.toLowerCase().split(/\s+/).find(w => w.length >= 4) || e.name.toLowerCase();
        for (const line of newLines) {
            const low = line.toLowerCase();
            if (low.includes(stem.slice(0, Math.max(4, stem.length - 2))) && /продал|продан|продаж|выручк|доход|прибыл|перв\w* парти|отгруз/.test(low))
                return { name: `Продажа: ${e.name}`, why: `первый товар дела «${e.name}» будет у покупателя не раньше ${fmtDate(e.firstSaleDay)}`, line };
        }
    }
    return null;
}

// Сводка. full — для Летописца и «Тайного»; коротко — для рассказчика.
export function ecoSummary(world, fmtDate, full = true) {
    const eco = world.eco;
    if (!eco) return '';
    const rec = Object.values(eco.recurring).reduce((s, g) => s + g, 0);
    const runway = (eco.cash - eco.debt - eco.arrears - (eco.loan || 0)) / spendMonth();
    const lines = [`Казна: ${fmtG(eco.cash)}${eco.cash < 0 ? ' (в долг у банкиров)' : ''} · сокровищница ${fmtG(eco.hoard)} · долг Империи ${fmtG(eco.debt)}${eco.loan > 0 ? ` · займы у банкиров ${fmtG(eco.loan)}` : ''} · задержано жалованья войску ${fmtG(eco.arrears)} · запас ~${runway.toFixed(1).replace('.', ',')} мес. расходов`];
    if (full) lines.push(`В месяц: подати ${fmtG(eco.lastIncome)} · армия ${fmtG(armyMonth())} · двор и управление ${fmtG(otherMonth())}${rec ? ` · постоянные статьи ${fmtG(rec)} (${Object.entries(eco.recurring).map(([n, g]) => `${n}: ${fmtG(g)}`).join('; ')})` : ''} · займы до ${fmtG(E.credit)}`);
    for (const e of eco.ent.filter(x => x.open)) {
        const state = world.lastDay < e.firstSaleDay
            ? (e.capital ? `рейс в пути, вернётся не раньше ${fmtDate(e.firstSaleDay)}` : world.lastDay < e.readyDay ? `строится; первый товар не раньше ${fmtDate(e.readyDay)}, у покупателя — ${fmtDate(e.firstSaleDay)}` : `товар в пути к покупателю, продажи с ${fmtDate(e.firstSaleDay)}`)
            : e.capital ? `торгует, следующий рейс вернётся ${fmtDate(e.tripEnd)}` : `работает, сбыт ${Math.round((e.share ?? 0) * 100)}% выработки`;
        lines.push(`Дело «${e.name}» (${e.kind}, ${e.size}; сбыт: ${e.markets.join(', ')}): ${state}${full ? ` · итог с начала ${fmtG(e.profit)}` : ''}`);
    }
    return lines.join('\n');
}

export const ecoLog = world => (world.eco?.log || []);
