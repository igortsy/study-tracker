'use strict';

const start = document.getElementById('btn_start');
const pause = document.getElementById('btn_pause');
const reset = document.getElementById('btn_reset');
const time = document.querySelector('.timer_time');
const bell = document.getElementById('bell');
const subjectSelect = document.getElementById('subjects');
const studyTimeDisplay = document.getElementById('study_time');
const statisticsList = document.getElementById('study_stats');
const studyCalendar = document.getElementById('study_calendar');
const prevBtn = document.getElementById('prev_month');
const nextBtn = document.getElementById('next_month');
const calendarDate = document.getElementById('calendar_date');
const addSubject = document.getElementById('add_subject');
const activityList = document.getElementById('activity_list');
const emptyBoxMsg = document.getElementById('empty_box');
const appStatus = document.getElementById('app_status');
alert('adf')
const TIMER_TIME = 1500;
const STORAGE_KEYS = [
  'activities', 'studyStats', 'dailyStats',
  'currentSubject', 'timeLeft', 'sessionTime',
];

let monthInx = 0;
let timerInterval = null;
let lastTickAt = null;
let partialMilliseconds = 0;
let storageWritable = true;
let storageNotice = '';
let statusMessage = '';

const showMessage = (message = statusMessage) => {
  statusMessage = message;
  appStatus.textContent = [message, storageNotice].filter(Boolean).join(' ');
  appStatus.hidden = appStatus.textContent === '';
};

const disableStorage = (message) => {
  storageWritable = false;
  storageNotice = message;
  showMessage();
};

const readStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    disableStorage('Saving is unavailable. New changes will only last in this tab.');
    return null;
  }
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSeconds = (value) => Number.isSafeInteger(value) && value >= 0;
const isStats = (value) => isRecord(value) && Object.values(value).every(isSeconds);
const isActivities = (value) => Array.isArray(value) && value.every((activity) => (
  isRecord(activity)
  && Number.isSafeInteger(activity.id) && activity.id > 0
  && typeof activity.name === 'string' && activity.name.trim().length > 0
)) && new Set(value.map((activity) => activity.id)).size === value.length;

const readJSON = (key, fallback, validate) => {
  const stored = readStorage(key);
  if (stored === null) return fallback;
  try {
    const parsed = JSON.parse(stored);
    if (!validate(parsed)) throw new Error('Invalid saved data');
    return parsed;
  } catch {
    // Не перезаписуємо пошкоджені дані порожніми значеннями.
    disableStorage(`Saved ${key} could not be read. Stored data is unchanged; new changes will only last in this tab.`);
    return fallback;
  }
};

const readSeconds = (key, fallback, maximum = Number.MAX_SAFE_INTEGER) => {
  const stored = readStorage(key);
  if (stored === null) return fallback;
  const value = Number(stored);
  if (stored.trim() !== '' && isSeconds(value) && value <= maximum) return value;
  disableStorage(`Saved ${key} is invalid. Stored data is unchanged; new changes will only last in this tab.`);
  return fallback;
};

// Об'єкти без прототипу безпечно підтримують імена на кшталт "__proto__".
// JSON-структура у localStorage від цього не змінюється.
const toDictionary = (record) => Object.assign(Object.create(null), record);
let activities = readJSON('activities', [], isActivities);
const studyStats = toDictionary(readJSON('studyStats', {}, isStats));
const savedDailyStats = readJSON('dailyStats', {}, (value) => (
  isRecord(value) && Object.values(value).every(isStats)
));
const dailyStats = Object.create(null);
for (const [date, stats] of Object.entries(savedDailyStats)) {
  dailyStats[date] = toDictionary(stats);
}

let sessionTime = readSeconds('sessionTime', 0, TIMER_TIME);
let timeLeft = readSeconds('timeLeft', TIMER_TIME, TIMER_TIME);
let currentSubject = readStorage('currentSubject') ?? '';
let sessionActive = false;

const formatDate = (date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

let sessionDateKey = formatDate(new Date());

const ensureDay = (date) => {
  dailyStats[date] ??= Object.create(null);
  for (const activity of activities) {
    dailyStats[date][activity.name] ??= 0;
  }
  return dailyStats[date];
};

const persistState = () => {
  if (!storageWritable) return;
  const values = {
    activities: JSON.stringify(activities),
    studyStats: JSON.stringify(studyStats),
    dailyStats: JSON.stringify(dailyStats),
    currentSubject,
    timeLeft: String(timeLeft),
    sessionTime: String(sessionTime),
  };
  const changed = [];
  try {
    for (const key of STORAGE_KEYS) {
      const previous = localStorage.getItem(key);
      if (previous === values[key]) continue;
      localStorage.setItem(key, values[key]);
      changed.push([key, previous]);
    }
  } catch {
    // localStorage не має транзакцій: за можливості відкочуємо частковий запис.
    for (const [key, previous] of changed.reverse()) {
      try {
        if (previous === null) localStorage.removeItem(key);
        else localStorage.setItem(key, previous);
      } catch {
        break;
      }
    }
    disableStorage('Saving failed. New changes will only last in this tab.');
  }
};

const formatTime = (seconds) => {
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${rest}`;
};

const updateDisplay = () => {
  const minutes = String(Math.floor(timeLeft / 60)).padStart(2, '0');
  const seconds = String(timeLeft % 60).padStart(2, '0');
  time.textContent = `${minutes}:${seconds}`;
};

const updateStudyTimeDisplay = () => {
  statisticsList.replaceChildren();
  let totalTime = 0;
  for (const [subject, seconds] of Object.entries(studyStats)) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    const duration = document.createElement('span');
    name.textContent = subject;
    duration.textContent = formatTime(seconds);
    duration.className = 'stat-time';
    li.append(name, duration);
    statisticsList.append(li);
    totalTime += seconds;
  }
  studyTimeDisplay.textContent = formatTime(totalTime);
};

const updateButtonState = () => {
  start.disabled = activities.length === 0 || timerInterval !== null || timeLeft === 0;
  pause.disabled = timerInterval === null;
  reset.disabled = !sessionActive && timerInterval === null && sessionTime === 0 && timeLeft === TIMER_TIME;
  for (const button of [start, pause, reset]) {
    button.classList.toggle('disabled', button.disabled);
  }
  subjectSelect.disabled = sessionActive || activities.length === 0;
  for (const button of activityList.querySelectorAll('.delete')) {
    const activity = activities.find((item) => item.id === Number(button.dataset.activityId));
    button.disabled = sessionActive && activity?.name === currentSubject;
    button.title = button.disabled ? 'Reset the current session before deleting this activity.' : '';
  }
};

const renderActivities = () => {
  const empty = activities.length === 0;
  emptyBoxMsg.classList.toggle('hide', !empty);
  subjectSelect.classList.toggle('hide', empty);
  subjectSelect.closest('.activity-field').classList.toggle('hide', empty);
  activityList.replaceChildren();
  for (const activity of activities) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    const deleteButton = document.createElement('button');
    const icon = document.createElement('i');
    name.textContent = activity.name;
    deleteButton.type = 'button';
    deleteButton.className = 'delete';
    deleteButton.dataset.activityId = String(activity.id);
    deleteButton.setAttribute('aria-label', `Delete ${activity.name}`);
    icon.className = 'fa-solid fa-trash';
    icon.setAttribute('aria-hidden', 'true');
    deleteButton.append(icon);
    li.append(name, deleteButton);
    activityList.append(li);
  }
};

const renderSelect = () => {
  subjectSelect.replaceChildren();
  if (activities.length === 0) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Add an activity to begin';
    placeholder.disabled = true;
    subjectSelect.append(placeholder);
  }
  for (const activity of activities) {
    const option = document.createElement('option');
    option.value = activity.name;
    option.textContent = activity.name;
    subjectSelect.append(option);
  }
  subjectSelect.value = currentSubject;
};

const renderCalendar = () => {
  studyCalendar.replaceChildren();
  const today = new Date();
  const displayedDate = new Date(today.getFullYear(), today.getMonth() + monthInx, 1);
  const year = displayedDate.getFullYear();
  const month = displayedDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (displayedDate.getDay() + 6) % 7;
  const todayKey = formatDate(today);
  calendarDate.textContent = displayedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  for (let index = 0; index < offset + daysInMonth; index++) {
    const cell = document.createElement('div');
    if (index < offset) {
      cell.setAttribute('aria-hidden', 'true');
    } else {
      const day = index - offset + 1;
      const date = formatDate(new Date(year, month, day));
      cell.textContent = String(day);
      cell.dataset.date = date;
      if (Object.values(dailyStats[date] ?? {}).some((seconds) => seconds > 0)) {
        cell.classList.add('study_day');
      }
      if (date === todayKey) {
        cell.classList.add('today');
        cell.setAttribute('aria-current', 'date');
      }
    }
    studyCalendar.append(cell);
  }
};

const addStudyTime = () => {
  if (sessionTime === 0 || currentSubject === '') return;
  const day = ensureDay(sessionDateKey);
  studyStats[currentSubject] = (studyStats[currentSubject] ?? 0) + sessionTime;
  day[currentSubject] = (day[currentSubject] ?? 0) + sessionTime;
  sessionTime = 0;
};

const stopInterval = () => {
  if (timerInterval !== null) clearInterval(timerInterval);
  timerInterval = null;
};

const playBell = () => {
  try {
    bell.currentTime = 0;
    Promise.resolve(bell.play()).catch(() => {
      showMessage('Session complete. Sound could not be played.');
    });
  } catch {
    showMessage('Session complete. Sound could not be played.');
  }
};

const finishSession = () => {
  stopInterval();
  lastTickAt = null;
  partialMilliseconds = 0;
  sessionActive = false;
  addStudyTime();
  persistState();
  updateDisplay();
  updateStudyTimeDisplay();
  renderCalendar();
  updateButtonState();
  showMessage('Session complete. Press Reset for a new session.');
  playBell();
};

const tick = () => {
  if (timerInterval === null || lastTickAt === null) return;
  // Рахуємо фактичний час, а не кількість викликів setInterval.
  const now = Date.now();
  if (now < lastTickAt) {
    lastTickAt = now;
    return;
  }
  let elapsed = Math.min(timeLeft, Math.floor((now - lastTickAt) / 1000));
  if (elapsed === 0) return;

  // Секунда належить локальному дню, у який вона завершилася.
  // Пропущений виклик може охоплювати обидві сторони півночі.
  while (elapsed > 0) {
    const firstSecondEnd = lastTickAt + 1000;
    const secondDate = new Date(firstSecondEnd);
    const dateKey = formatDate(secondDate);
    if (dateKey !== sessionDateKey) {
      addStudyTime();
      sessionDateKey = dateKey;
    }
    const midnight = new Date(secondDate);
    midnight.setHours(24, 0, 0, 0);
    const secondsUntilMidnight = Math.ceil((midnight.getTime() - firstSecondEnd) / 1000);
    const seconds = Math.min(elapsed, secondsUntilMidnight);
    sessionTime += seconds;
    timeLeft -= seconds;
    lastTickAt += seconds * 1000;
    elapsed -= seconds;
  }

  if (timeLeft === 0) {
    finishSession();
    return;
  }
  persistState();
  updateDisplay();
  updateStudyTimeDisplay();
  renderCalendar();
};

const pauseTimer = () => {
  tick();
  if (timerInterval === null) return;
  partialMilliseconds = Math.max(0, Date.now() - lastTickAt);
  stopInterval();
  lastTickAt = null;
  persistState();
  updateButtonState();
  showMessage('Session paused. Resume or Reset before changing activity.');
};

const refreshActivities = () => {
  renderActivities();
  renderSelect();
  updateStudyTimeDisplay();
  updateButtonState();
};

addSubject.addEventListener('click', () => {
  const input = window.prompt('New activity');
  if (input === null) return;
  const name = input.trim();
  if (name.length < 2) {
    showMessage('Use at least two characters for an activity name.');
    return;
  }
  if (activities.some((activity) => activity.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showMessage('An activity with this name already exists.');
    return;
  }
  const usedIds = new Set(activities.map((activity) => activity.id));
  let id = activities.reduce((maximum, activity) => Math.max(maximum, activity.id), 0) + 1;
  if (!Number.isSafeInteger(id)) {
    id = 1;
    while (usedIds.has(id)) id++;
  }
  activities.push({ id, name });
  // Повторне додавання раніше видаленої активності зберігає її історію.
  studyStats[name] ??= 0;
  ensureDay(formatDate(new Date()));
  if (!sessionActive) currentSubject = name;
  persistState();
  refreshActivities();
  showMessage(`Activity added: ${name}.`);
});

activityList.addEventListener('click', (event) => {
  const button = event.target.closest('button.delete');
  if (!button || !activityList.contains(button) || button.disabled) return;
  const activity = activities.find((item) => item.id === Number(button.dataset.activityId));
  if (!activity || (sessionActive && activity.name === currentSubject)) return;
  if (!window.confirm(`Delete "${activity.name}" from activities? Saved study history will be kept.`)) return;

  activities = activities.filter((item) => item !== activity);
  if (activity.name === currentSubject || activities.length === 0) {
    currentSubject = activities[0]?.name ?? '';
    timeLeft = TIMER_TIME;
    sessionTime = 0;
    sessionActive = false;
    partialMilliseconds = 0;
  }
  persistState();
  refreshActivities();
  updateDisplay();
  showMessage('Activity deleted. Saved study history was kept.');
});

subjectSelect.addEventListener('change', () => {
  if (sessionActive) {
    subjectSelect.value = currentSubject;
    return;
  }
  if (!activities.some((activity) => activity.name === subjectSelect.value)) return;
  currentSubject = subjectSelect.value;
  persistState();
});

start.addEventListener('click', () => {
  if (timerInterval !== null || timeLeft === 0 || activities.length === 0) return;
  if (!sessionActive) {
    currentSubject = subjectSelect.value;
    sessionDateKey = formatDate(new Date());
  }
  if (!activities.some((activity) => activity.name === currentSubject)) return;
  sessionActive = true;
  lastTickAt = Date.now() - partialMilliseconds;
  timerInterval = window.setInterval(tick, 250);
  persistState();
  updateButtonState();
  showMessage('Focus session running.');
});

pause.addEventListener('click', pauseTimer);

reset.addEventListener('click', () => {
  tick();
  stopInterval();
  addStudyTime();
  lastTickAt = null;
  partialMilliseconds = 0;
  timeLeft = TIMER_TIME;
  sessionActive = false;
  sessionDateKey = formatDate(new Date());
  persistState();
  updateDisplay();
  updateStudyTimeDisplay();
  renderCalendar();
  updateButtonState();
  showMessage('Timer reset. Completed study time was added to your statistics.');
});

prevBtn.addEventListener('click', () => {
  monthInx--;
  renderCalendar();
});
nextBtn.addEventListener('click', () => {
  monthInx++;
  renderCalendar();
});

// Інша вкладка не повинна бути перезаписана застарілим станом цієї вкладки.
window.addEventListener('storage', (event) => {
  if (event.storageArea !== localStorage || (event.key !== null && !STORAGE_KEYS.includes(event.key))) return;
  stopInterval();
  lastTickAt = null;
  disableStorage('Saved data changed in another tab. This tab is paused and cannot save; reload it to use the latest saved data.');
  updateButtonState();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  tick();
  renderCalendar();
});

window.addEventListener('focus', () => {
  tick();
  renderCalendar();
});

window.addEventListener('pagehide', () => {
  pauseTimer();
  addStudyTime();
  persistState();
  updateStudyTimeDisplay();
  renderCalendar();
});

const scheduleDateRefresh = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  window.setTimeout(() => {
    tick();
    renderCalendar();
    scheduleDateRefresh();
  }, midnight.getTime() - now.getTime() + 10);
};

// Старі sessionTime — ще не зараховані секунди. Формат збереження не змінено.
// Дата цих секунд у старих даних відсутня: після аварійного закриття
// вона може бути визначена лише як день відновлення.
for (const activity of activities) studyStats[activity.name] ??= 0;
ensureDay(sessionDateKey);

if (sessionTime > 0 && currentSubject === '' && activities.length === 1) {
  currentSubject = activities[0].name;
}
if (sessionTime > 0 && currentSubject === '') {
  disableStorage('The saved session has no activity. Stored data is unchanged; new changes will only last in this tab.');
  sessionTime = 0;
  timeLeft = TIMER_TIME;
}
if (!activities.some((activity) => activity.name === currentSubject)) {
  // Зберігаємо навіть залишок сесії активності, яку видалив старий код.
  addStudyTime();
  currentSubject = activities[0]?.name ?? '';
  timeLeft = TIMER_TIME;
}
if (timeLeft === 0) {
  // Відновлення після закриття саме між 00:00 та старим наступним тіком.
  addStudyTime();
  showMessage('Session complete. Press Reset for a new session.');
} else {
  sessionActive = activities.length > 0 && (sessionTime > 0 || timeLeft < TIMER_TIME);
  if (sessionActive) showMessage('Session restored and paused.');
}

persistState();
refreshActivities();
updateDisplay();
renderCalendar();
scheduleDateRefresh();