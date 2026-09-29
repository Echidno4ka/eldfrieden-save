// «Колодец»: одно состояние мира на все чаты игры (сцены и кабинет).
// Хранится файлом в данных Таверны (user/files/gr-well.json) и ездит через git вместе с остальным.
// Мир — это пересчёт журнала пачек эффектов: откат в одном чате убирает только его пачки, чужие остаются.
import { cloneWorld } from './reaction.js';
import { commitBatch, advanceWorld } from './world.js';

export const WELL_FILE = 'gr-well.json';
export const WELL_VERSION = 2;
const KEEP = 40, SLACK = 20;          // после 60 пачек старые 20 сворачиваются в контрольную точку
const MAX_TEXTS = 8;                   // версий текста Летописи для откатов

export function newWell(text, world) {
    return { v: WELL_VERSION, text, updatedAt: null, history: [], batches: [], seq: 0, checkpoint: { n: 0, world: cloneWorld(world) }, world, chats: {} };
}

// Пересчитать мир: контрольная точка + все пачки журнала по порядку, потом дожить до `toDay`.
export function replay(well, delaysOf, toDay) {
    const w = cloneWorld(well.checkpoint.world);
    for (const b of well.batches) commitBatch(w, b.text, b.day, delaysOf(b.seats));
    if (toDay != null) advanceWorld(w, toDay, delaysOf(null));
    return w;
}

export function addBatch(well, batch, delaysOf) {
    batch.n = ++well.seq;
    well.batches.push(batch);
    if (well.batches.length > KEEP + SLACK) {
        const cut = well.batches.length - KEEP;
        const w = cloneWorld(well.checkpoint.world);
        well.checkpointChats = well.checkpointChats || {};
        for (const b of well.batches.slice(0, cut)) {
            commitBatch(w, b.text, b.day, delaysOf(b.seats));
            well.checkpointChats[b.chat] = Math.max(well.checkpointChats[b.chat] ?? -1, b.idx);
        }
        well.checkpoint = { n: well.batches[cut - 1].n, world: w };
        well.batches = well.batches.slice(cut);
    }
    return batch;
}

// Убрать пачки чата `chat` с сообщения `idx` и дальше. Возвращает { removed, others } — others: пачки других чатов позже удалённых.
export function removeFrom(well, chat, idx) {
    const removed = well.batches.filter(b => b.chat === chat && b.idx >= idx);
    if (!removed.length) return { removed, others: [] };
    const first = Math.min(...removed.map(b => b.n));
    well.batches = well.batches.filter(b => !(b.chat === chat && b.idx >= idx));
    const others = well.batches.filter(b => b.chat !== chat && b.n > first);
    return { removed, others };
}
// Было ли что-то из этого чата свёрнуто в контрольную точку позже `idx` (такие пачки уже не убрать).
export const beyondCheckpoint = (well, chat, idx) => (well.checkpointChats?.[chat] ?? -1) >= idx;

// Версии текста Летописи: { text, at, chat, idx, seq }.
export function pushText(well, entry) {
    well.history.unshift(entry);
    well.history = well.history.slice(0, MAX_TEXTS);
}

// ---- хранение ----
function b64(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}
// null — колодца ещё нет (новая игра или перенос старой Летописи). Любая другая беда — исключение:
// нельзя принять сбой чтения за «колодца нет» и записать поверх игры новый мир.
export async function loadWell() {
    const r = await fetch(`/user/files/${WELL_FILE}?t=${Date.now()}`, { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`колодец не прочитан (ответ сервера ${r.status})`);
    let w;
    try { w = await r.json(); } catch { throw new Error('файл колодца повреждён'); }
    if (!w || typeof w !== 'object' || !w.world || !Array.isArray(w.batches)) throw new Error('файл колодца повреждён');
    if (w.v !== WELL_VERSION) throw new Error(`колодец другой версии (${w.v}), расширение ждёт ${WELL_VERSION}`);
    return w;
}
export async function saveWell(well, headers) {
    const r = await fetch('/api/files/upload', { method: 'POST', headers, body: JSON.stringify({ name: WELL_FILE, data: b64(JSON.stringify(well)) }) });
    if (!r.ok) throw new Error(`колодец не сохранён (${r.status})`);
}
