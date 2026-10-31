const start = document.getElementById('btn_start');
const pause = document.getElementById('btn_pause');
const reset = document.getElementById('btn_reset');
const time = document.querySelector('.timer_time');
const bell = document.getElementById('bell');
const subjectSelect = document.querySelector('select');
const studyTimeDisplay = document.getElementById('study_time');
const statisticsList = document.getElementById("study_stats");
const studyCalendar = document.getElementById("study_calendar");
const prevBtn = document.getElementById("prev_month");
const nextBtn = document.getElementById("next_month");
const calendarDate = document.getElementById("calendar_date");
const addSubject = document.getElementById("add_subject");
const activityList = document.getElementById("activity_list");
const emptyBoxMsg = document.getElementById("empty_box");

let monthInx = 0;

let studyStats = localStorage.getItem("studyStats");
let dailyStats = localStorage.getItem("dailyStats");
let sessionTime = localStorage.getItem("sessionTime") ? +localStorage.getItem("sessionTime") : 0;
let today = new Date();

const TIMER_TIME = 1500;
let timeLeft = localStorage.getItem('timeLeft') !== null ? +localStorage.getItem('timeLeft') : TIMER_TIME;
let sessionActive = +localStorage.getItem('sessionTime') > 0 && +localStorage.getItem('timeLeft') > 0 ? true : false;
let timerInterval = null;

let activities = localStorage.getItem("activities") ? JSON.parse(localStorage.getItem("activities")) : []

const isEmptyActivity = (activities) => {
  if(activities.length === 0) {
    emptyBoxMsg.classList.remove("hide");
    subjectSelect.classList.add('hide')
  } else {
    emptyBoxMsg.classList.add("hide");
    subjectSelect.classList.remove('hide');
  }
}

const renderActivities = (activityList) => {
  activityList.innerHTML = '';
  if(activities.length !== 0) {
    for(const activity of activities) {
      const listItem = document.createElement('li');
      const activityName = document.createElement('span');
      const deleteBtn = document.createElement('span');
      listItem.id = activity.id;
      deleteBtn.className = 'fa-solid fa-trash delete';
      activityName.textContent = activity.name;
      listItem.append(activityName);
      listItem.append(deleteBtn);
      activityList.append(listItem);
    }
  }
}

isEmptyActivity(activities);
renderActivities(activityList);

if(studyStats) {
   studyStats = JSON.parse(studyStats);
} else {
  studyStats = {};
  for(const activity of activities) {
    studyStats[activity.name] = 0
  }
}

if(dailyStats) {
  dailyStats = JSON.parse(dailyStats);
} else {
  dailyStats = {};
}

const updateButtonState = () => {
  if(activities.length === 0 || timerInterval !== null || timeLeft === 0) {
    start.disabled = true;
    start.classList.add('disabled'); 
  } else {
    start.classList.remove('disabled');
    start.disabled = false;
  }

  if(timerInterval === null) {
    pause.disabled = true;
    pause.classList.add('disabled'); 
  } else {
    pause.classList.remove('disabled');
    pause.disabled = false;
  }

  if(timerInterval === null && sessionTime === 0 && timeLeft !== 0) {
    reset.disabled = true;
    reset.classList.add('disabled'); 
  } else {
    reset.disabled = false;
    reset.classList.remove('disabled');
  } 
}

const renderSelect = () => {
  subjectSelect.innerHTML = '';
  for(let activity of activities) {
    const activityOption = document.createElement('option');
    activityOption.textContent = activity.name;
    activityOption.id = activity.id;
    subjectSelect.append(activityOption)
  }
}

const formatDate = (date) => {
  let day = String(date.getDate()).padStart(2,'0');
  let month = String(date.getMonth() + 1).padStart(2,'0');
  let year = date.getFullYear();
  return `${year}-${month}-${day}`;
}

renderSelect();
updateButtonState();

let currentSubject = localStorage.getItem('currentSubject') !== null ? localStorage.getItem('currentSubject') : subjectSelect.value;
const todayFormated = formatDate(today);

if(!(todayFormated in dailyStats)) {
  dailyStats[todayFormated] = {}
  for(const activity of activities) {
    dailyStats[todayFormated][activity.name] = 0
  }
}

const addNewActivity = (activity) => {
  
  const maxId = activities.length > 0 ? Math.max(...activities.map(a => a.id)) : 0;
  activities.push({
    id: maxId + 1,
    name: activity
  }) 

  studyStats[activity] = 0;
  dailyStats[todayFormated][activity] = 0

  localStorage.setItem("activities", JSON.stringify(activities))
  localStorage.setItem("studyStats", JSON.stringify(studyStats));
  localStorage.setItem("dailyStats", JSON.stringify(dailyStats));

  updateButtonState();
}

  activityList.addEventListener('click', (e) => {
    console.log('asfd')
    if(Array.from(e.target.classList).includes('delete')) {
      const activityId = e.target.closest('li').id;
      const activityToDel = activities.find((val) => {
        console.log(activityId)
        return val.id === +activityId
      })
      activities = activities.filter((activity) => activity !== activityToDel);
    }
    localStorage.setItem("activities", JSON.stringify(activities))
    isEmptyActivity(activities);
    renderActivities(activityList);
    renderSelect();
    updateButtonState();
    console.log(activities.length)
  })



addSubject.addEventListener('click', () => {
  const activity = prompt("New activity")?.trim();
  if(activity !== null && activity.trim().length > 1) {
    addNewActivity(activity);
    renderSelect();
    localStorage.setItem('currentSubject', subjectSelect.value)
    subjectSelect.value = activity;
    currentSubject = subjectSelect.value;
    isEmptyActivity(activities);
    renderActivities(activityList);
  }
})

if(sessionActive) {
  subjectSelect.disabled = true;
}

const chunkArray = (array, size) => {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

const getDailyTotal = (dStats) => {
  let total = 0
  for(const subject in dStats) {
    total += dStats[subject]
  }
  return total;
}

const isStudyDay = (dStats) => {
  return getDailyTotal(dStats) > 0
}

const getStudyDays = (dailyStats) => {
  const studyDays = [];
  for(const dStats in dailyStats) {
    if(isStudyDay(dailyStats[dStats])) {
      studyDays.push(dStats)
    }
  }
  return studyDays;
}

prevBtn.addEventListener('click', () => {
  monthInx--
  renderCalendar(studyCalendar, monthInx)
})

nextBtn.addEventListener('click', () => {
  monthInx++
  renderCalendar(studyCalendar, monthInx)
})

const renderCalendar = (studyCalendar, monthInx) => {
  studyCalendar.innerHTML = '';
  const monthsLong = [
  "January", "February", "March", "April", 
  "May", "June", "July", "August", 
  "September", "October", "November", "December"
];
  const month = today.getMonth();
  const year = today.getFullYear();
  const maxMonthDay = new Date(year, month + monthInx + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month + monthInx, 1).getDay();
  const displayedDate = new Date(year, month + monthInx);
  const offset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  const calendarDays = [];
  const displayedYear = displayedDate.getFullYear();
  const displayedMonth = displayedDate.getMonth();
  //console.log(monthsLong[displayedMonth], displayedYear)
  calendarDate.textContent = `${monthsLong[displayedMonth]}, ${displayedYear}`
  for(let i = 1; i <= offset; i++) {
    calendarDays.push(null)
  }
  for(let i = 1; i <= maxMonthDay; i++) {
    calendarDays.push(i);
  }

  const calendarTable = chunkArray(calendarDays, 7)
  const studyDays = getStudyDays(dailyStats);
  for(const week of calendarTable) {
    for(const day of week) {
      
      const dayCell = document.createElement('div');
      dayCell.textContent = day
      if(day !== null) {
        
        const formatedDate = formatDate(new Date(displayedYear, displayedMonth, day ));
        
        if(studyDays.includes(formatedDate)) {
          dayCell.classList.add('study_day')
        }
        if(todayFormated === formatedDate){
          dayCell.classList.add('today')
        }
      }
      studyCalendar.append(dayCell);
    }
  }
}

renderCalendar(studyCalendar, monthInx)

const updateStudyTimeDisplay = () => {
  let totalTime = 0;
  statisticsList.innerHTML = ''
  for(const subject in studyStats) {
    const li = document.createElement('li');
    li.textContent = `${subject} - ${formatTime(studyStats[subject])}`
    statisticsList.append(li);
    totalTime += studyStats[subject];
  }

  studyTimeDisplay.textContent = formatTime(totalTime);
}

const formatTime = seconds => {
  let h = Math.floor(seconds / 3600) + '';
  let min = Math.floor((seconds % 3600) / 60) + '';
  let sec = seconds % 60 + '';
  return `${h.padStart(2, '0')}:${min.padStart(2,'0')}:${sec.padStart(2,'0')}`
}

const updateDisplay= () => {
  time.textContent = formatTime(timeLeft);;
};

const addStudyTime = () => {
  const todayFormated = formatDate(new Date())
  if(!(todayFormated in dailyStats)) {
    dailyStats[todayFormated] = {}
    for(const activity of activities) {
      dailyStats[todayFormated][activity.name] = 0
    }
}
  studyStats[currentSubject] += sessionTime;
  dailyStats[todayFormated][currentSubject] += sessionTime;
  sessionTime = 0;

  localStorage.setItem("studyStats", JSON.stringify(studyStats));
  localStorage.setItem("dailyStats", JSON.stringify(dailyStats));
  localStorage.setItem("sessionTime", sessionTime);
};

updateDisplay();
updateStudyTimeDisplay();

start.addEventListener('click', () => {
  
  if(timeLeft === 0 || activities.length === 0) {
    return;
  } 
  if(!timerInterval ) {
    if(!sessionActive) {
      localStorage.setItem('currentSubject', subjectSelect.value)
      currentSubject = subjectSelect.value;
    }
    sessionActive = true;
    subjectSelect.disabled = true;
    timerInterval = setInterval(() => {
      if(timeLeft === 0) {
        bell.play()
        sessionActive = false;
        subjectSelect.disabled = false;
        clearInterval(timerInterval)
        timerInterval = null;
        addStudyTime();
        updateStudyTimeDisplay();
        renderCalendar(studyCalendar, monthInx);
        updateButtonState();
        return;
      }
      localStorage.setItem("timeLeft", --timeLeft);
      localStorage.setItem("sessionTime", ++sessionTime);
      updateDisplay();
    }, 1000)
  }
  updateButtonState();
})

pause.addEventListener('click', () => {
  clearInterval(timerInterval)
  timerInterval = null;
  updateButtonState();
})

reset.addEventListener('click', () => {
 clearInterval(timerInterval)
  timerInterval = null;
  timeLeft = TIMER_TIME;
  localStorage.setItem("timeLeft", timeLeft);
  sessionActive = false;
  subjectSelect.disabled = false;
  if(sessionTime) {
    addStudyTime();
    updateStudyTimeDisplay();
  }
  updateDisplay();
  renderCalendar(studyCalendar, monthInx);
  updateButtonState();
})

