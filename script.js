'use strict';

const C = TrackerCore;
const t = I18n.t;
const STATE_KEY = 'studyTracker.v3';
const PREVIOUS_KEY = 'studyTracker.v2';
const LEGACY_KEYS = ['activities','studyStats','dailyStats','currentSubject','timeLeft','sessionTime'];
const $ = id => document.getElementById(id);
const formatTime = n => `${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n%3600/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const prettyDate = key => C.fromDate(key).toLocaleDateString(I18n.locale,{year:'numeric',month:'short',day:'numeric'});
const activityName = id => state.activities.find(a => a.id === id)?.name ?? t('Unknown activity');
let writable = true, storageNotice = '', status = '', statusValues = {}, soundFailed = false, state;
function message(text = status, values = statusValues) {
  status = text; statusValues = values;
  $('app_status').textContent = [t(status,values),t(storageNotice),soundFailed ? t('Sound could not be played.') : ''].filter(Boolean).join(' ');
  $('app_status').hidden = !$('app_status').textContent;
}
function formError(id, text = '') { const el = $(id); el.dataset.i18n = text; el.textContent = t(text); }
function disableSaving(text) { writable = false; storageNotice = text; message(); }
try {
  const raw = localStorage.getItem(STATE_KEY), previous = localStorage.getItem(PREVIOUS_KEY);
  if (raw !== null) state = C.parseState(JSON.parse(raw));
  else if (previous !== null) { state = C.parseState(JSON.parse(previous)); status = 'Your earlier data was upgraded. New sessions will now appear in history.'; }
  else {
    state = C.migrateLegacy(key => localStorage.getItem(key));
    if (Number(localStorage.getItem('sessionTime')) > 0) status = 'Old session time was recovered under today’s date: the old format did not store its date.';
  }
  if (state.session.remaining === 0) C.complete(state,Date.now());
} catch {
  state = C.createState();
  disableSaving('Saved data could not be read. Existing data is unchanged. This tab cannot save; export a backup before closing.');
}
let interval = null, lastTick = null, fraction = 0, lastSaved = 0;
let selectedDay = C.dateKey(new Date()), renderedToday = '', viewedMonth = new Date(new Date().getFullYear(),new Date().getMonth(),1);
let periodAnchor = new Date(), periodType = 'week', periodFollowsToday = true, historyPage = 0, noteEntryId = null;
const PAGE_SIZE = 10, calendarNodes = new Map(), statNodes = new Map(), dayNodes = new Map(), periodNodes = new Map(), chartNodes = new Map();
const locked = () => state.session.mode === 'focus' && state.session.activityId !== null;
function save(force = true) {
  const now = Date.now();
  if (!writable || (!force && now-lastSaved < 5000)) return;
  try { localStorage.setItem(STATE_KEY,JSON.stringify(state)); lastSaved = now; }
  catch { disableSaving('Saving failed. Export a backup before closing this tab.'); }
}
function stop() { if (interval !== null) clearInterval(interval); interval = null; lastTick = null; }
function updateControls() {
  const s = state.session, isBreak = s.mode === 'break';
  $('btn_start').disabled = interval !== null || (!isBreak && state.selectedId === null);
  $('start_label').textContent = t(interval !== null ? (isBreak ? 'Break' : 'Start') : s.startedAt !== null || locked() ? 'Resume' : isBreak ? 'Start break' : 'Start');
  $('btn_pause').disabled = interval === null;
  $('btn_reset').disabled = !isBreak && !locked() && s.remaining === C.FOCUS;
  $('subjects').disabled = locked() || isBreak || !C.active(state).length;
  $('skip_break').hidden = !isBreak;
  $('session_note_box').hidden = isBreak;
  $('session_label').textContent = t(isBreak ? 'Rest & recharge' : 'Focus session');
  $('timer_visual').dataset.mode = s.mode;
  const visual = interval !== null ? 'running' : s.startedAt !== null || locked() ? 'paused' : 'ready';
  $('timer_visual').dataset.state = visual;
  $('timer_state').textContent = t(isBreak ? (visual === 'running' ? 'Take a breath' : visual === 'paused' ? 'Break paused' : 'Break ready') : (visual === 'running' ? 'Stay focused' : visual === 'paused' ? 'On pause' : 'Ready to focus'));
  for (const button of $('activity_list').querySelectorAll('button.delete')) {
    button.disabled = state.session.activityId === Number(button.dataset.id);
    button.title = button.disabled ? t('Reset the current session before deleting this activity.') : '';
  }
  $('manual_entry').disabled = $('history_manual').disabled = !C.active(state).length;
}
function updateTime() {
  const s = state.session, duration = s.mode === 'focus' ? C.FOCUS : C.BREAK;
  const time = `${String(Math.floor(s.remaining/60)).padStart(2,'0')}:${String(s.remaining%60).padStart(2,'0')}`;
  document.querySelector('.timer_time').textContent = time;
  const progress = (duration-s.remaining)/duration*100;
  $('timer_ring_progress').style.strokeDashoffset = String(progress);
  $('timer_progress_text').textContent = t(s.mode === 'break' ? '{percent}% of break' : '{percent}% complete',{percent:Math.floor(progress)});
  document.title = `${time} · ${t(s.mode === 'break' ? 'Break' : 'Focus')}${interval === null && (locked() || s.startedAt) ? ` · ${t('Paused')}` : ''} | Study Tracker`;
  const totals = C.totals(state);
  for (const [id,node] of statNodes) node.textContent = formatTime(totals[id] ?? 0);
  $('study_time').textContent = formatTime(C.sum(Object.values(totals)));
}
function updateGoal() {
  const today = C.dateKey(new Date()), n = C.dayTotal(state,today), goal = state.settings.dailyGoal;
  $('goal_progress').max = goal; $('goal_progress').value = Math.min(goal,n);
  $('goal_progress').setAttribute('aria-valuetext',t('{time} studied; goal {goal}',{time:formatTime(n),goal:formatTime(goal)}));
  $('goal_summary').textContent = t('{time} of {goal} · {percent}%',{time:formatTime(n),goal:formatTime(goal),percent:Math.floor(n/goal*100)});
  $('goal_remaining').textContent = n >= goal ? t('Daily goal reached. Nice work!') : t('{time} to your goal.',{time:formatTime(goal-n)});
}
function createTimeRow(list, nameText) {
  const row = document.createElement('li'), name = document.createElement('span'), time = document.createElement('span');
  name.textContent = nameText; time.className = 'stat-time'; row.append(name,time); list.append(row);
  return {row,time};
}
function renderDayRows() {
  $('day_stats').replaceChildren(); dayNodes.clear();
  for (const a of state.activities) dayNodes.set(a.id,createTimeRow($('day_stats'),`${a.name}${a.archived ? t(' (archived)') : ''}`));
  updateDay();
}
function updateDay() {
  const stats = C.dayStats(state,selectedDay), total = C.sum(Object.values(stats));
  $('selected_day_heading').textContent = prettyDate(selectedDay);
  for (const [id,node] of dayNodes) { const n = stats[id] ?? 0; node.row.hidden = n === 0; node.time.textContent = formatTime(n); }
  $('day_total').textContent = formatTime(total); $('day_empty').hidden = total > 0;
}
function updateCalendar() {
  if (renderedToday !== C.dateKey(new Date())) { renderCalendar(); updateGoal(); return; }
  for (const [day,cell] of calendarNodes) {
    const n = C.dayTotal(state,day), level = C.heatLevel(n);
    cell.dataset.heat = String(level); cell.classList.toggle('study_day',n > 0);
    cell.setAttribute('aria-pressed',String(day === selectedDay));
    const label = t('{date}{today}: {time} studied',{date:prettyDate(day),today:day === renderedToday ? t(', today') : '',time:formatTime(n)});
    if (cell.title !== label) { cell.setAttribute('aria-label',label); cell.title = label; }
  }
}
function renderCalendar() {
  const priorToday = renderedToday;
  renderedToday = C.dateKey(new Date());
  if (selectedDay === priorToday) {
    selectedDay = renderedToday;
    if (priorToday && C.dateKey(viewedMonth).slice(0,7) === priorToday.slice(0,7)) viewedMonth = new Date(new Date().getFullYear(),new Date().getMonth(),1);
  }
  if (priorToday && priorToday !== renderedToday && periodFollowsToday) { periodAnchor = new Date(); renderPeriod(); }
  calendarNodes.clear(); $('study_calendar').replaceChildren();
  $('calendar_date').textContent = viewedMonth.toLocaleDateString(I18n.locale,{month:'long',year:'numeric'});
  const offset = (viewedMonth.getDay()+6)%7, count = new Date(viewedMonth.getFullYear(),viewedMonth.getMonth()+1,0).getDate();
  for (let i=0;i<offset+count;i++) {
    const cell = document.createElement(i<offset ? 'div' : 'button');
    if (i<offset) cell.setAttribute('aria-hidden','true');
    else {
      const day = C.dateKey(new Date(viewedMonth.getFullYear(),viewedMonth.getMonth(),i-offset+1));
      cell.type = 'button'; cell.dataset.date = day; cell.textContent = String(i-offset+1);
      if (day === renderedToday) { cell.classList.add('today'); cell.setAttribute('aria-current','date'); }
      calendarNodes.set(day,cell);
    }
    $('study_calendar').append(cell);
  }
  updateCalendar(); updateDay();
}
function renderPeriod() {
  const data = C.periodSummary(state,periodAnchor,periodType);
  $('period_label').textContent = `${prettyDate(data.dates[0])} – ${prettyDate(data.dates.at(-1))}`;
  $('daily_chart').dataset.period = periodType; $('daily_chart').replaceChildren(); chartNodes.clear();
  for (const day of data.dates) {
    const item = document.createElement('li'), bar = document.createElement('span'), label = document.createElement('span');
    bar.className = 'chart-bar'; bar.setAttribute('aria-hidden','true'); label.className = 'chart-label'; label.setAttribute('aria-hidden','true');
    label.textContent = periodType === 'week' ? C.fromDate(day).toLocaleDateString(I18n.locale,{weekday:'short'}) : String(C.fromDate(day).getDate());
    item.append(bar,label); $('daily_chart').append(item); chartNodes.set(day,{item,bar});
  }
  $('period_activities').replaceChildren(); periodNodes.clear();
  for (const a of state.activities) periodNodes.set(a.id,createTimeRow($('period_activities'),`${a.name}${a.archived ? t(' (archived)') : ''}`));
  updatePeriod();
}
function updatePeriod() {
  const data = C.periodSummary(state,periodAnchor,periodType), previousAnchor = new Date(data.start); previousAnchor.setDate(previousAnchor.getDate()-1);
  const previous = C.periodSummary(state,previousAnchor,periodType), maximum = Math.max(1,...data.daily.map(d => d.seconds));
  $('period_total').textContent = formatTime(data.total); $('previous_total').textContent = formatTime(previous.total);
  $('period_change').textContent = previous.total ? `${data.total >= previous.total ? '+' : ''}${Math.round((data.total-previous.total)/previous.total*100)}%` : data.total ? t('First progress') : '—';
  for (const d of data.daily) {
    const node = chartNodes.get(d.day); if (!node) continue;
    node.bar.style.height = `${d.seconds ? Math.max(3,d.seconds/maximum*100) : 0}%`;
    const label = `${prettyDate(d.day)}: ${formatTime(d.seconds)}`;
    node.item.setAttribute('aria-label',label); node.item.title = label;
  }
  $('chart_empty').hidden = data.total > 0;
  for (const [id,node] of periodNodes) { const n = data.byActivity[id] ?? 0; node.row.hidden = n === 0; node.time.textContent = formatTime(n); }
}
function refreshLive() { updateTime(); updateGoal(); updateCalendar(); updateDay(); updatePeriod(); }
function renderLists() {
  const historyFilter = $('history_activity').value;
  $('subjects').replaceChildren(); $('activity_list').replaceChildren(); $('study_stats').replaceChildren(); $('history_activity').replaceChildren(); statNodes.clear();
  const all = document.createElement('option'); all.value = ''; all.textContent = t('All activities'); $('history_activity').append(all);
  const active = C.active(state);
  $('empty_box').classList.toggle('hide',active.length > 0); $('subjects').closest('.activity-field').classList.toggle('hide',!active.length);
  for (const a of state.activities) {
    statNodes.set(a.id,createTimeRow($('study_stats'),`${a.name}${a.archived ? t(' (archived)') : ''}`).time);
    const historyOption = document.createElement('option'); historyOption.value = String(a.id); historyOption.textContent = `${a.name}${a.archived ? t(' (archived)') : ''}`; $('history_activity').append(historyOption);
    if (a.archived) continue;
    const option = document.createElement('option'); option.value = String(a.id); option.textContent = a.name; $('subjects').append(option);
    const item = document.createElement('li'), title = document.createElement('span'), remove = document.createElement('button');
    title.textContent = a.name; remove.type = 'button'; remove.className = 'delete'; remove.dataset.id = String(a.id); remove.textContent = '×'; remove.setAttribute('aria-label',t('Delete {name}',{name:a.name})); item.append(title,remove); $('activity_list').append(item);
  }
  $('subjects').value = state.selectedId === null ? '' : String(state.selectedId);
  $('history_activity').value = state.activities.some(a => String(a.id) === historyFilter) ? historyFilter : '';
  $('goal_minutes').value = String(state.settings.dailyGoal/60); $('session_note').value = state.session.note;
  renderDayRows(); renderPeriod(); updateTime(); updateGoal(); updateControls(); renderHistory();
}
function renderHistory() {
  const activity = $('history_activity').value, day = $('history_date').value;
  const entries = state.history.filter(h => (!activity || h.activityId === Number(activity)) && (!day || (h.parts[day] ?? 0) > 0)).slice().sort((a,b) => Math.max(...Object.keys(b.parts).map(d => C.fromDate(d).getTime()))-Math.max(...Object.keys(a.parts).map(d => C.fromDate(d).getTime())) || b.id-a.id);
  const pages = Math.max(1,Math.ceil(entries.length/PAGE_SIZE)); historyPage = Math.max(0,Math.min(historyPage,pages-1));
  $('history_list').replaceChildren();
  for (const h of entries.slice(historyPage*PAGE_SIZE,(historyPage+1)*PAGE_SIZE)) {
    const row = document.createElement('li'), top = document.createElement('div'), name = document.createElement('strong'), duration = document.createElement('span'), details = document.createElement('p'), note = document.createElement('p'), button = document.createElement('button');
    top.className = 'section-heading'; name.textContent = activityName(h.activityId); duration.textContent = formatTime(h.duration); duration.className = 'stat-time'; top.append(name,duration);
    const dates = Object.keys(h.parts).sort();
    const time = h.startedAt ? ` · ${new Date(h.startedAt).toLocaleTimeString(I18n.locale,{hour:'2-digit',minute:'2-digit'})}` : '';
    details.className = 'muted session-meta'; details.textContent = `${dates.map(prettyDate).join(' / ')}${time} · ${t({timer:'Focus session',manual:'Manual entry',recovered:'Recovered session'}[h.source])}${day && dates.length > 1 ? ` · ${t('{time} on selected day',{time:formatTime(h.parts[day])})}` : ''}`;
    note.className = 'history-note'; note.textContent = h.note || t('No note');
    button.type = 'button'; button.className = 'quiet-button'; button.dataset.noteId = String(h.id); button.textContent = t(h.note ? 'Edit note' : 'Add note'); button.setAttribute('aria-label',t('{action} for {name} on {date}',{action:button.textContent,name:activityName(h.activityId),date:prettyDate(dates[0])}));
    row.append(top,details,note,button); $('history_list').append(row);
  }
  $('history_legacy').hidden = !state.historicalData; $('history_empty').hidden = entries.length > 0;
  $('history_empty').textContent = t(state.history.length ? 'No sessions match these filters.' : 'Your next recorded session will appear here.');
  $('history_page').textContent = t('Page {page} of {pages} · {count} sessions',{page:historyPage+1,pages,count:entries.length});
  $('history_prev').disabled = historyPage === 0; $('history_next').disabled = historyPage+1 >= pages;
}
function playBell() { soundFailed = false; const failed = () => { soundFailed = true; message(); }; try { $('bell').currentTime = 0; Promise.resolve($('bell').play()).catch(failed); } catch { failed(); } }
function finish(at) {
  stop(); fraction = 0;
  const result = C.complete(state,at); $('session_note').value = state.session.note;
  save(); refreshLive(); updateControls(); renderHistory();
  message(result.mode === 'focus' ? 'Focus session saved. Start a 5-minute break, or skip it when you’re ready.' : 'Break complete. Ready for your next focus session.'); playBell();
}
function tick() {
  if (interval === null || lastTick === null) return;
  const result = C.advance(state,lastTick,Date.now()); lastTick = result.lastTick;
  if (result.completed) { finish(lastTick); return; }
  if (result.changed) { refreshLive(); save(false); }
}
function pauseTimer(announce = true) {
  tick(); if (interval === null) return;
  fraction = Math.max(0,Math.min(999,Date.now()-lastTick)); stop(); save(); updateControls(); updateTime();
  if (announce) message('Timer paused. Press Resume when you’re ready.');
}
$('btn_start').addEventListener('click',() => {
  if (interval !== null) return;
  try { C.start(state,Date.now()); lastTick = Date.now()-fraction; interval = window.setInterval(tick,250); save(); updateControls(); updateTime(); message(state.session.mode === 'focus' ? 'Focus session running.' : 'Break running. This time is not counted as study.'); }
  catch (error) { message(error.message); }
});
$('btn_pause').addEventListener('click',() => pauseTimer());
function resetTimer() {
  tick(); stop(); C.reset(state,Date.now()); fraction = 0; $('session_note').value = '';
  save(); refreshLive(); updateControls(); renderHistory(); message('Ready for a new focus session. Any elapsed focus time was saved.');
}
$('btn_reset').addEventListener('click',resetTimer); $('skip_break').addEventListener('click',resetTimer);
$('subjects').addEventListener('change',() => {
  if (locked() || state.session.mode === 'break') { $('subjects').value = String(state.selectedId ?? ''); return; }
  const id = Number($('subjects').value); if (!C.active(state).some(a => a.id === id)) return;
  state.selectedId = id; save(); updateControls();
});
$('session_note').addEventListener('input',() => { if (state.session.mode === 'focus') state.session.note = $('session_note').value.slice(0,500); });
$('session_note').addEventListener('change',() => save());
$('goal_form').addEventListener('submit',event => {
  event.preventDefault(); const minutes = Number($('goal_minutes').value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) { message('Choose a daily goal between 1 and 1440 whole minutes.'); return; }
  state.settings.dailyGoal = minutes*60; save(); updateGoal(); message('Daily goal saved.');
});
$('add_subject').addEventListener('click',() => { $('activity_form').reset(); formError('activity_error'); $('activity_dialog').showModal(); $('activity_name').focus(); });
$('cancel_activity').addEventListener('click',() => $('activity_dialog').close());
$('activity_form').addEventListener('submit',event => {
  event.preventDefault();
  try { const a = C.addActivity(state,$('activity_name').value); save(); renderLists(); $('activity_dialog').close(); message('Activity added: {name}.',{name:a.name}); }
  catch (error) { formError('activity_error',error.message); }
});
$('activity_list').addEventListener('click',event => {
  const button = event.target.closest('button.delete'); if (!button || button.disabled) return;
  const id = Number(button.dataset.id), a = state.activities.find(a => a.id === id); if (!a || state.session.activityId === id) return;
  pauseTimer(false);
  if (!window.confirm(t('Delete "{name}" from activities? Its study history will be kept.',{name:a.name}))) return;
  try { C.archiveActivity(state,id); save(); renderLists(); message('Activity deleted. Study history was kept.'); } catch (error) { message(error.message); }
});
$('prev_month').addEventListener('click',() => { viewedMonth = new Date(viewedMonth.getFullYear(),viewedMonth.getMonth()-1,1); renderCalendar(); });
$('next_month').addEventListener('click',() => { viewedMonth = new Date(viewedMonth.getFullYear(),viewedMonth.getMonth()+1,1); renderCalendar(); });
$('study_calendar').addEventListener('click',event => { const cell = event.target.closest('button[data-date]'); if (!cell) return; selectedDay = cell.dataset.date; updateCalendar(); updateDay(); });
$('today_button').addEventListener('click',() => { selectedDay = C.dateKey(new Date()); viewedMonth = new Date(new Date().getFullYear(),new Date().getMonth(),1); renderCalendar(); });
$('day_history').addEventListener('click',() => { $('history_date').value = selectedDay; $('history_activity').value = ''; historyPage = 0; renderHistory(); $('history_heading').scrollIntoView({behavior:'auto',block:'start'}); });
$('period_type').addEventListener('change',() => { periodType = $('period_type').value === 'month' ? 'month' : 'week'; renderPeriod(); });
function movePeriod(direction) { periodFollowsToday = false; const range = C.periodRange(periodAnchor,periodType); periodAnchor = new Date(range.start); if (periodType === 'week') periodAnchor.setDate(periodAnchor.getDate()+direction*7); else periodAnchor.setMonth(periodAnchor.getMonth()+direction); renderPeriod(); }
$('period_prev').addEventListener('click',() => movePeriod(-1)); $('period_next').addEventListener('click',() => movePeriod(1));
$('period_today').addEventListener('click',() => { periodAnchor = new Date(); periodFollowsToday = true; renderPeriod(); });
for (const id of ['history_activity','history_date']) $(id).addEventListener('change',() => { historyPage = 0; renderHistory(); });
$('history_clear').addEventListener('click',() => { $('history_activity').value = ''; $('history_date').value = ''; historyPage = 0; renderHistory(); });
$('history_prev').addEventListener('click',() => { historyPage--; renderHistory(); }); $('history_next').addEventListener('click',() => { historyPage++; renderHistory(); });
$('history_list').addEventListener('click',event => {
  const button = event.target.closest('button[data-note-id]'); if (!button) return;
  const entry = state.history.find(h => h.id === Number(button.dataset.noteId)); if (!entry) return;
  noteEntryId = entry.id; $('history_note').value = entry.note; $('note_dialog').showModal(); $('history_note').focus();
});
$('cancel_note').addEventListener('click',() => $('note_dialog').close());
$('note_form').addEventListener('submit',event => { event.preventDefault(); const entry = state.history.find(h => h.id === noteEntryId); if (entry) { entry.note = $('history_note').value.slice(0,500).trim(); save(); renderHistory(); } $('note_dialog').close(); });
function openManual() {
  $('manual_form').reset(); formError('manual_error'); $('manual_activity').replaceChildren();
  for (const a of C.active(state)) { const option = document.createElement('option'); option.value = String(a.id); option.textContent = a.name; $('manual_activity').append(option); }
  if (!C.active(state).length) { message('Add an activity before logging a session.'); return; }
  $('manual_activity').value = String(state.selectedId ?? C.active(state)[0].id);
  const today = C.dateKey(new Date()); $('manual_date').max = today; $('manual_date').value = selectedDay <= today ? selectedDay : today;
  $('manual_minutes').value = '25'; $('manual_dialog').showModal();
}
$('manual_entry').addEventListener('click',openManual); $('history_manual').addEventListener('click',openManual);
$('cancel_manual').addEventListener('click',() => $('manual_dialog').close());
$('manual_form').addEventListener('submit',event => {
  event.preventDefault();
  try { C.addManual(state,{activityId:Number($('manual_activity').value),day:$('manual_date').value,minutes:Number($('manual_minutes').value),note:$('manual_note').value}); save(); refreshLive(); historyPage = 0; renderHistory(); $('manual_dialog').close(); message('Manual session added to your statistics and history.'); }
  catch (error) { formError('manual_error',error.message); }
});
function setFocusMode(enabled) { document.body.classList.toggle('focus-mode',enabled); $('focus_mode').setAttribute('aria-pressed',String(enabled)); $('focus_mode').textContent = t(enabled ? 'Exit focus · Esc' : 'Focus mode'); }
$('focus_mode').addEventListener('click',() => setFocusMode(!document.body.classList.contains('focus-mode')));
document.addEventListener('keydown',event => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setFocusMode(false); });
$('export_data').addEventListener('click',() => {
  tick(); const url = URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})), link = document.createElement('a');
  link.href = url; link.download = `study-tracker-backup-${C.dateKey(new Date())}.json`; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url),1000); message('Backup exported.');
});
$('import_data').addEventListener('click',() => { if (!writable) { message('Reload and resolve the saving issue before importing. Existing data is protected.'); return; } pauseTimer(); $('backup_file').value = ''; $('backup_file').click(); });
$('backup_file').addEventListener('change',async () => {
  const file = $('backup_file').files[0]; if (!file) return;
  try {
    if (file.size > 20*1024*1024) throw new Error('Backup must be smaller than 20 MB.');
    const imported = C.parseState(JSON.parse(await file.text()));
    if (!writable) throw new Error('Saved data changed. Reload before importing.');
    pauseTimer(false);
    if (!window.confirm(t('Replace all current data with this backup? Export a copy of your current data first if needed.'))) return;
    localStorage.setItem(STATE_KEY,JSON.stringify(imported)); stop(); state = imported; fraction = 0; lastSaved = Date.now(); historyPage = 0;
    if (state.session.remaining === 0) { C.complete(state,Date.now()); save(); }
    renderLists(); renderCalendar(); message('Backup imported. Any unfinished timer is paused.');
  } catch (error) { message('Import failed. {error} Current data was kept.',{error:{textKey:I18n.has(error.message) ? error.message : 'The file could not be read as a valid backup.'}}); }
});
function refreshLanguage() {
  const goalDraft = $('goal_minutes').value;
  I18n.translateDOM();
  $('language_select').value = I18n.language; $('theme_select').value = I18n.theme;
  renderLists(); renderCalendar();
  if (goalDraft !== '') $('goal_minutes').value = goalDraft;
  setFocusMode(document.body.classList.contains('focus-mode')); message();
}
$('language_select').addEventListener('change',() => {
  const saved = I18n.setPreference('language',$('language_select').value); refreshLanguage();
  if (!saved) message('Preference changed for this visit. Browser settings could not be saved.');
});
$('theme_select').addEventListener('change',() => {
  if (!I18n.setPreference('theme',$('theme_select').value)) message('Preference changed for this visit. Browser settings could not be saved.');
});
window.addEventListener('storage',event => {
  if (event.storageArea === localStorage && event.key === I18n.KEY) { if (I18n.sync(event.newValue)) refreshLanguage(); return; }
  if (event.storageArea !== localStorage || (event.key !== null && ![STATE_KEY,PREVIOUS_KEY,...LEGACY_KEYS].includes(event.key))) return;
  stop(); disableSaving('Data changed in another tab. This tab is paused and cannot save. Reload to use the latest data, or export this tab as a backup.'); updateControls(); updateTime();
});
document.addEventListener('visibilitychange',() => { tick(); if (document.hidden) save(); else refreshLive(); });
window.addEventListener('focus',() => { tick(); refreshLive(); });
window.addEventListener('pagehide',() => { pauseTimer(false); save(); });
function scheduleMidnight() { const now = new Date(), midnight = new Date(now); midnight.setHours(24,0,0,0); window.setTimeout(() => { tick(); refreshLive(); scheduleMidnight(); },midnight-now+10); }
I18n.translateDOM(); $('language_select').value = I18n.language; $('theme_select').value = I18n.theme;
save(); renderLists(); renderCalendar(); scheduleMidnight();
if (locked() || state.session.startedAt) message('Timer restored and paused.'); else message();
