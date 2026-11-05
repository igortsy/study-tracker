/* Study Tracker data model. Also usable from Node for independent verification. */
(function (root) {
  'use strict';
  const FOCUS = 1500, BREAK = 300;
  const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const seconds = v => Number.isSafeInteger(v) && v >= 0;
  const sum = values => values.reduce((n, v) => n + v, 0);
  const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const fromDate = key => new Date(`${key}T12:00:00`);
  const validDate = key => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(fromDate(key).getTime()) && dateKey(fromDate(key)) === key;
  const validTimestamp = v => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)));
  const assert = (condition, text) => { if (!condition) throw new Error(text); };
  const freshSession = (mode = 'focus') => ({mode, activityId:null, remaining:mode === 'focus' ? FOCUS : BREAK, pending:{}, startedAt:null, note:''});
  const createState = () => ({version:3, activities:[], totals:{}, days:{}, selectedId:null, settings:{dailyGoal:7200}, history:[], historicalData:false, session:freshSession()});
  const active = state => state.activities.filter(a => !a.archived);
  const pendingTotal = state => sum(Object.values(state.session.pending));
  const nextId = items => { const id = items.reduce((n,a) => Math.max(n,a.id),0)+1; assert(Number.isSafeInteger(id),'No more IDs are available.'); return id; };
  function validateState(value) {
    assert(record(value) && value.version === 3 && Array.isArray(value.activities),'Unsupported data format.');
    const ids = new Set(), names = new Set();
    for (const a of value.activities) {
      assert(record(a) && Number.isSafeInteger(a.id) && a.id > 0 && !ids.has(a.id) && typeof a.name === 'string' && a.name.trim().length > 0 && typeof a.archived === 'boolean','Invalid activities.');
      ids.add(a.id);
      if (!a.archived) { const name = a.name.trim().toLocaleLowerCase(); assert(!names.has(name),'Duplicate activity names.'); names.add(name); }
    }
    const stats = obj => {
      assert(record(obj) && Object.entries(obj).every(([id,n]) => ids.has(Number(id)) && String(Number(id)) === id && seconds(n)), 'Invalid statistics.');
      assert(seconds(sum(Object.values(obj))),'Study time is too large.');
    };
    const parts = obj => { assert(record(obj),'Invalid session dates.'); for (const [day,n] of Object.entries(obj)) assert(validDate(day) && seconds(n),'Invalid session date or duration.'); assert(seconds(sum(Object.values(obj))),'Invalid duration.'); };
    stats(value.totals); assert(record(value.days),'Invalid daily statistics.');
    for (const [day,values] of Object.entries(value.days)) { assert(validDate(day),'Invalid date.'); stats(values); }
    assert(value.selectedId === null || active(value).some(a => a.id === value.selectedId),'Invalid selected activity.');
    assert(record(value.settings) && Number.isSafeInteger(value.settings.dailyGoal) && value.settings.dailyGoal >= 60 && value.settings.dailyGoal <= 86400,'Invalid daily goal.');
    assert(typeof value.historicalData === 'boolean' && Array.isArray(value.history),'Invalid history.');
    const historyIds = new Set(), loggedTotals = {}, loggedDays = {};
    for (const h of value.history) {
      assert(record(h) && Number.isSafeInteger(h.id) && h.id > 0 && !historyIds.has(h.id) && ids.has(h.activityId),'Invalid history entry.'); historyIds.add(h.id);
      parts(h.parts);
      assert(seconds(h.duration) && h.duration > 0 && h.duration === sum(Object.values(h.parts)) && h.duration <= (h.source === 'manual' ? 86400 : FOCUS),'Invalid history duration.');
      assert(['timer','manual','recovered'].includes(h.source) && typeof h.note === 'string' && h.note.length <= 500 && validTimestamp(h.startedAt) && validTimestamp(h.endedAt),'Invalid session details.');
      if (h.startedAt && h.endedAt) assert(Date.parse(h.endedAt) >= Date.parse(h.startedAt),'Invalid session times.');
      loggedTotals[h.activityId] = (loggedTotals[h.activityId] ?? 0)+h.duration;
      for (const [day,n] of Object.entries(h.parts)) { loggedDays[day] ??= {}; loggedDays[day][h.activityId] = (loggedDays[day][h.activityId] ?? 0)+n; }
    }
    for (const [id,n] of Object.entries(loggedTotals)) assert(seconds(n) && n <= (value.totals[id] ?? 0),'History exceeds recorded totals.');
    for (const [day,values] of Object.entries(loggedDays)) for (const [id,n] of Object.entries(values)) assert(n <= (value.days[day]?.[id] ?? 0),'History exceeds daily totals.');
    const s = value.session;
    assert(record(s) && ['focus','break'].includes(s.mode) && seconds(s.remaining) && s.remaining <= (s.mode === 'focus' ? FOCUS : BREAK),'Invalid timer.');
    parts(s.pending);
    assert(typeof s.note === 'string' && s.note.length <= 500 && validTimestamp(s.startedAt),'Invalid current session.');
    assert(pendingTotal(value) + s.remaining <= (s.mode === 'focus' ? FOCUS : BREAK),'Invalid current duration.');
    if (s.mode === 'break') assert(s.activityId === null && pendingTotal(value) === 0,'Breaks cannot contain study time.');
    else {
      assert(s.activityId === null || active(value).some(a => a.id === s.activityId),'Invalid current activity.');
      assert(!pendingTotal(value) || s.activityId !== null,'Session activity is missing.');
      assert(s.activityId === null || s.activityId === value.selectedId,'Session selection mismatch.');
      assert(s.remaining === 0 || s.remaining === FOCUS || s.activityId !== null,'Session activity is missing.');
    }
    assert(seconds(sum(Object.values(value.totals))+pendingTotal(value)),'Study time is too large.');
    return value;
  }
  function migrateV2(old) {
    assert(record(old) && old.version === 2,'Unsupported backup format.');
    const state = {...old, version:3, settings:{dailyGoal:7200}, history:[], historicalData:true, session:{...old.session, mode:'focus', startedAt:null, note:''}};
    validateState(state);
    if (state.session.remaining === 0) { commitSession(state,Date.now()); state.session = freshSession('break'); }
    return validateState(state);
  }
  function migrateLegacy(get, now = Date.now()) {
    const state = createState(), byName = new Map();
    const parse = (key,fallback) => get(key) === null ? fallback : JSON.parse(get(key));
    const activities = parse('activities',[]), totals = parse('studyStats',{}), days = parse('dailyStats',{});
    assert(Array.isArray(activities) && record(totals) && record(days),'Invalid old data.');
    const find = (name, archived = true) => {
      assert(typeof name === 'string' && name.trim(),'Invalid old activity.');
      if (!byName.has(name)) { const a = {id:byName.size+1,name,archived}; byName.set(name,a); state.activities.push(a); }
      if (!archived) byName.get(name).archived = false;
      return byName.get(name).id;
    };
    for (const a of activities) { assert(record(a),'Invalid old activity.'); find(a.name,false); }
    for (const [name,n] of Object.entries(totals)) state.totals[find(name)] = n;
    for (const [day,values] of Object.entries(days)) { assert(record(values),'Invalid old day.'); state.days[day] = {}; for (const [name,n] of Object.entries(values)) state.days[day][find(name)] = n; }
    const oldSelected = byName.get(get('currentSubject')) ?? (active(state).length === 1 ? active(state)[0] : null);
    const pending = Number(get('sessionTime') ?? 0), remaining = Number(get('timeLeft') ?? FOCUS);
    assert(seconds(pending) && seconds(remaining) && pending+remaining <= FOCUS,'Invalid old session.');
    if (pending) {
      assert(oldSelected,'The old session has no activity.');
      const day = dateKey(new Date(now));
      state.totals[oldSelected.id] = (state.totals[oldSelected.id] ?? 0)+pending;
      state.days[day] ??= {}; state.days[day][oldSelected.id] = (state.days[day][oldSelected.id] ?? 0)+pending;
    }
    state.selectedId = oldSelected && !oldSelected.archived ? oldSelected.id : active(state)[0]?.id ?? null;
    state.session.remaining = state.selectedId === null ? FOCUS : remaining;
    state.session.activityId = remaining > 0 && remaining < FOCUS && state.selectedId !== null ? state.selectedId : null;
    if (remaining === 0 && state.selectedId !== null) state.session = freshSession('break');
    state.historicalData = Object.values(state.totals).some(n => n > 0);
    return validateState(state);
  }
  const parseState = value => value?.version === 2 ? migrateV2(value) : validateState(value);
  function addActivity(state, rawName) {
    const name = rawName.trim(); assert(name.length >= 2 && name.length <= 60,'Use between 2 and 60 characters.');
    assert(!active(state).some(a => a.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()),'This activity already exists.');
    let activity = state.activities.find(a => a.archived && a.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
    if (activity) activity.archived = false;
    else { activity = {id:nextId(state.activities),name,archived:false}; state.activities.push(activity); state.totals[activity.id] = 0; }
    if (state.session.activityId === null) state.selectedId = activity.id;
    return activity;
  }
  function archiveActivity(state, id) {
    assert(state.session.activityId !== id,'Reset the current session before deleting this activity.');
    const a = active(state).find(a => a.id === id); assert(a,'Activity not found.'); a.archived = true;
    if (state.selectedId === id) state.selectedId = active(state)[0]?.id ?? null;
  }
  function recordEntry(state, entry) {
    assert(seconds(sum(Object.values(state.totals))+pendingTotal(state)+entry.duration),'Study time is too large.');
    const result = {...entry,id:nextId(state.history)};
    state.totals[result.activityId] = (state.totals[result.activityId] ?? 0)+result.duration;
    for (const [day,n] of Object.entries(result.parts)) { state.days[day] ??= {}; state.days[day][result.activityId] = (state.days[day][result.activityId] ?? 0)+n; }
    state.history.push(result); return result;
  }
  function commitSession(state, now) {
    const s = state.session, duration = pendingTotal(state);
    if (s.mode !== 'focus' || !duration) return null;
    const parts = {...s.pending}; s.pending = {};
    return recordEntry(state,{activityId:s.activityId,parts,duration,note:s.note,source:s.startedAt ? 'timer' : 'recovered',startedAt:s.startedAt,endedAt:s.startedAt ? new Date(now).toISOString() : null});
  }
  function start(state, now) {
    const s = state.session;
    assert(s.remaining > 0,'Reset the timer before starting.');
    if (s.mode === 'focus') { assert(active(state).some(a => a.id === state.selectedId),'Add an activity first.'); s.activityId = state.selectedId; }
    if (s.startedAt === null) s.startedAt = new Date(now).toISOString();
  }
  function advance(state, lastTick, now) {
    if (now < lastTick) return {lastTick:now,changed:false,completed:false};
    const s = state.session;
    let elapsed = Math.min(s.remaining,Math.floor((now-lastTick)/1000));
    const changed = elapsed > 0;
    while (elapsed > 0) {
      const end = lastTick+1000, date = new Date(end), day = dateKey(date), midnight = new Date(date); midnight.setHours(24,0,0,0);
      const n = Math.min(elapsed,Math.ceil((midnight-end)/1000));
      if (s.mode === 'focus') s.pending[day] = (s.pending[day] ?? 0)+n;
      s.remaining -= n; lastTick += n*1000; elapsed -= n;
    }
    return {lastTick,changed,completed:changed && s.remaining === 0};
  }
  function complete(state, now) {
    const mode = state.session.mode;
    const entry = mode === 'focus' ? commitSession(state,now) : null;
    state.session = freshSession(mode === 'focus' ? 'break' : 'focus');
    return {mode,entry};
  }
  function reset(state, now) { const entry = commitSession(state,now); state.session = freshSession(); return entry; }
  function addManual(state,{activityId,day,minutes,note}, now = Date.now()) {
    assert(active(state).some(a => a.id === activityId),'Choose an active activity.');
    assert(validDate(day) && day <= dateKey(new Date(now)),'Choose today or an earlier date.');
    assert(Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440,'Use between 1 and 1440 whole minutes.');
    assert(typeof note === 'string' && note.length <= 500,'Use at most 500 characters for a note.');
    return recordEntry(state,{activityId,parts:{[day]:minutes*60},duration:minutes*60,note:note.trim(),source:'manual',startedAt:null,endedAt:null});
  }
  function totals(state) {
    const result = {...state.totals};
    if (state.session.activityId !== null) result[state.session.activityId] = (result[state.session.activityId] ?? 0)+pendingTotal(state);
    return result;
  }
  function dayStats(state, day) {
    const result = {...state.days[day]};
    if (state.session.activityId !== null && state.session.pending[day]) result[state.session.activityId] = (result[state.session.activityId] ?? 0)+state.session.pending[day];
    return result;
  }
  const dayTotal = (state,day) => sum(Object.values(dayStats(state,day)));
  const heatLevel = n => n === 0 ? 0 : n < 1800 ? 1 : n < 3600 ? 2 : n < 7200 ? 3 : 4;
  function periodRange(anchor, type) {
    const start = fromDate(dateKey(anchor));
    if (type === 'week') start.setDate(start.getDate()-(start.getDay()+6)%7); else start.setDate(1);
    const end = new Date(start);
    if (type === 'week') end.setDate(end.getDate()+7); else end.setMonth(end.getMonth()+1);
    const dates = [];
    for (const d = new Date(start); d < end; d.setDate(d.getDate()+1)) dates.push(dateKey(d));
    return {start,end,dates};
  }
  function periodSummary(state, anchor, type) {
    const range = periodRange(anchor,type), byActivity = {}, daily = [];
    for (const day of range.dates) { const stats = dayStats(state,day); for (const [id,n] of Object.entries(stats)) byActivity[id] = (byActivity[id] ?? 0)+n; daily.push({day,seconds:sum(Object.values(stats))}); }
    return {...range,byActivity,daily,total:sum(Object.values(byActivity))};
  }
  const api = {FOCUS,BREAK,sum,dateKey,fromDate,validDate,createState,validateState,parseState,migrateLegacy,active,pendingTotal,addActivity,archiveActivity,start,advance,complete,reset,addManual,totals,dayStats,dayTotal,heatLevel,periodRange,periodSummary};
  root.TrackerCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
