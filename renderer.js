const { ipcRenderer } = require('electron');
const Chart = require('chart.js/auto');

let timeLeft = 25 * 60;
let timerId = null;
let expectedEndTime = 0;
let currentMode = 'work';
let pomodorosCompleted = 0;
let tasks = [];
let stats = { totalSeconds: 0, tasksDone: 0, history: {} };
let chartInstance = null;
let currentChartView = 'week';

const display = document.getElementById('time-display');
const modeDisplay = document.getElementById('mode-display');
const taskInput = document.getElementById('task-input');
const taskDate = document.getElementById('task-date');
const taskPriority = document.getElementById('task-priority');
const taskListUI = document.getElementById('task-list');
const activeTaskSelect = document.getElementById('active-task-select');

// --- UI TOGGLES ---
window.toggleSettings = function() {
  const panel = document.getElementById('settings-panel');
  const btn = document.getElementById('toggle-btn');
  if (panel.style.display === 'block') {
    panel.style.display = 'none';
    btn.innerText = 'Configure ▼';
  } else {
    panel.style.display = 'block';
    btn.innerText = 'Hide ▲';
  }
};

window.setTheme = function(theme) {
  document.body.className = theme === 'default' ? '' : theme;
  if (chartInstance) updateChart(currentChartView);
};

// --- CUSTOM TITLE BAR (window is frameless) ---
window.minimizeWindow = function() { ipcRenderer.send('window-minimize'); };
window.closeWindow = function() { ipcRenderer.send('window-close'); };

window.switchTab = function(tabId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  document.getElementById('tab-' + tabId).classList.add('active');
  if (tabId === 'stats') updateChart(currentChartView);
};

// --- WREATH PROGRESS (4 leaves per side = 1 full pomodoro cycle) ---
function updateWreathProgress() {
  const filled = pomodorosCompleted === 0 ? 0 : (((pomodorosCompleted - 1) % 4) + 1);
  for (let i = 1; i <= 4; i++) {
    const l = document.getElementById('leaf-l' + i);
    const r = document.getElementById('leaf-r' + i);
    if (l) l.classList.toggle('filled', i <= filled);
    if (r) r.classList.toggle('filled', i <= filled);
  }
}

// --- TIMER LOGIC ---
function getDurations() {
  return {
    work: parseInt(document.getElementById('work-duration').value) || 25,
    short: parseInt(document.getElementById('short-duration').value) || 5,
    long: parseInt(document.getElementById('long-duration').value) || 15
  };
}

function updateDisplay() {
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  display.innerText = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function setMode(mode) {
  currentMode = mode;
  timeLeft = getDurations()[mode] * 60;
  modeDisplay.innerText = mode === 'work' ? 'WORK SESSION' : (mode === 'short' ? 'SHORT BREAK' : 'LONG BREAK');
  updateDisplay();
}

document.querySelectorAll('#settings-panel input[type="number"]').forEach(input => {
  input.addEventListener('change', () => { if(!timerId && currentMode === input.id.split('-')[0]) setMode(currentMode); });
});

document.getElementById('start-btn').addEventListener('click', () => {
  if (timerId) return; 
  expectedEndTime = Date.now() + (timeLeft * 1000);

  timerId = setInterval(() => {
    const now = Date.now();
    const remaining = Math.round((expectedEndTime - now) / 1000);

    if (remaining > 0) {
      if (currentMode === 'work' && remaining < timeLeft) {
        const passed = timeLeft - remaining;
        stats.totalSeconds += passed;
        const today = new Date().toISOString().split('T')[0];
        if (!stats.history) stats.history = {};
        stats.history[today] = (stats.history[today] || 0) + passed;
        if (stats.totalSeconds % 10 === 0) ipcRenderer.send('save-stats', stats);
      }
      timeLeft = remaining;
      updateDisplay();
    } else {
      clearInterval(timerId); timerId = null; timeLeft = 0; updateDisplay();
      new Notification('EPI', { body: 'Time is up!' });
      
      if (document.getElementById('auto-transition').checked) {
        if (currentMode === 'work') {
          pomodorosCompleted++;
          updateWreathProgress();
          setMode(pomodorosCompleted % 4 === 0 ? 'long' : 'short');
        } else setMode('work');
        document.getElementById('start-btn').click(); 
      }
    }
  }, 1000);
});

document.getElementById('pause-btn').addEventListener('click', () => { clearInterval(timerId); timerId = null; });
document.getElementById('reset-btn').addEventListener('click', () => { clearInterval(timerId); timerId = null; setMode(currentMode); });

// --- TASK LOGIC ---
function renderTasks() {
  taskListUI.innerHTML = '';
  activeTaskSelect.innerHTML = '<option value="">-- Select a Task --</option>';
  const activeWidget = document.getElementById('active-task-select-widget');
  if (activeWidget && activeWidget._syncTrigger) activeWidget._syncTrigger();
  
  const sortBy = document.getElementById('sort-select').value;
  const todayStr = new Date().toISOString().split('T')[0];

  let sortedTasks = [...tasks];
  if (sortBy === 'priority') {
    const pLevel = { High: 3, Medium: 2, Low: 1 };
    sortedTasks.sort((a, b) => pLevel[b.priority || 'Low'] - pLevel[a.priority || 'Low']);
  } else {
    sortedTasks.sort((a, b) => new Date(a.dueDate || '2099') - new Date(b.dueDate || '2099'));
  }

  sortedTasks.forEach((task) => {
    const realIndex = tasks.indexOf(task);
    const title = typeof task === 'string' ? task : task.title;
    const priority = task.priority || 'Low';
    const dueDate = task.dueDate || null;
    const isOverdue = dueDate && dueDate < todayStr;
    
    const opt = document.createElement('option');
    opt.value = realIndex; opt.innerText = title;
    activeTaskSelect.appendChild(opt);

    const li = document.createElement('li');
    li.className = 'task-item';
    li.innerHTML = `
      <div style="width: 80%; word-wrap: break-word;">
        <div class="task-title">${title}</div>
        <div class="task-meta">
          <span class="priority-dot p-${priority}"></span>${priority}
          <span class="${isOverdue ? 'overdue' : ''}">${dueDate ? ' • Due: ' + dueDate : ''}</span>
        </div>
      </div>
      <button class="done-btn" onclick="completeTask(${realIndex})">✓</button>
    `;
    taskListUI.appendChild(li);
  });
}

function addTask() {
  if (!taskInput.value.trim()) return;
  tasks.push({ 
    title: taskInput.value.trim(), 
    priority: taskPriority.value,
    dueDate: taskDate.value
  });
  taskInput.value = ''; taskDate.value = '';
  const dateWidget = document.getElementById('task-date-widget');
  if (dateWidget && dateWidget._syncTrigger) dateWidget._syncTrigger();
  renderTasks(); ipcRenderer.send('save-tasks', tasks);
}

document.getElementById('add-task-btn').addEventListener('click', addTask);
taskInput.addEventListener('keypress', e => { if (e.key === 'Enter') addTask(); });

window.completeTask = function(index) {
  tasks.splice(index, 1);
  if (!stats) stats = { totalSeconds: 0, tasksDone: 0, history: {} };
  stats.tasksDone++;
  ipcRenderer.send('save-tasks', tasks);
  ipcRenderer.send('save-stats', stats);
  renderTasks(); updateStatsUI();
};

// --- CHARTS & STATS LOGIC ---
function updateStatsUI() {
  if (!stats) return;
  const h = Math.floor((stats.totalSeconds || 0) / 3600);
  const m = Math.floor(((stats.totalSeconds || 0) % 3600) / 60);
  document.getElementById('total-focus-h').innerText = `${h}h ${m}m`;
  document.getElementById('total-tasks').innerText = stats.tasksDone || 0;
}

window.updateChart = function(timeframe) {
  currentChartView = timeframe;
  const canvas = document.getElementById('focusChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b59045';
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#2a2824';
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(0,0,0,0.1)';

  let labels = [], data = [];
  const today = new Date();

  const getDates = (days) => Array.from({length: days}, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - i);
    return d.toISOString().split('T')[0];
  }).reverse();

  const history = stats?.history || {};

  if (timeframe === 'week') {
    labels = getDates(7).map(d => d.slice(5)); 
    data = labels.map((_, i) => Math.round((history[getDates(7)[i]] || 0) / 60));
  } else if (timeframe === 'month') {
    labels = getDates(30).map(d => d.slice(5));
    data = labels.map((_, i) => Math.round((history[getDates(30)[i]] || 0) / 60));
  } else if (timeframe === 'year') {
    labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let monthlyData = new Array(12).fill(0);
    Object.keys(history).forEach(dateStr => {
      const d = new Date(dateStr);
      if ((today - d) / (1000 * 60 * 60 * 24) <= 365) monthlyData[d.getMonth()] += history[dateStr];
    });
    data = monthlyData.map(sec => Math.round(sec / 60));
  } else if (timeframe === 'all') {
    const rawLabels = Object.keys(history).sort();
    labels = rawLabels.length ? rawLabels.map(d => d.slice(5)) : ['No Data'];
    data = rawLabels.length ? rawLabels.map(date => Math.round(history[date] / 60)) : [0];
  }

  if (chartInstance) chartInstance.destroy();

  document.querySelectorAll('.chart-filters button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === timeframe);
  });

  const fillGradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 240);
  fillGradient.addColorStop(0, accentColor + 'aa');
  fillGradient.addColorStop(1, accentColor + '05');

  chartInstance = new Chart(ctx, {
    type: timeframe === 'year' ? 'bar' : 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Minutes Focused',
        data: data,
        backgroundColor: fillGradient,
        borderColor: accentColor,
        borderWidth: 2, fill: true, tension: 0.4,
        borderRadius: timeframe === 'year' ? 4 : 0,
        pointBackgroundColor: accentColor, pointBorderColor: textColor, pointRadius: 3
      }]
    },
    options: {
      responsive: true, color: textColor,
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 7 } },
        y: { grid: { color: gridColor }, beginAtZero: true, ticks: { color: textColor } }
      },
      plugins: { legend: { display: false } }
    }
  });
};

// --- CUSTOM SELECT WIDGETS (native dropdown popups can't be themed, so these proxy a hidden real <select>) ---
function setupCustomSelect(rootId) {
  const root = document.getElementById(rootId);
  if (!root) return;
  const select = root.querySelector('select');
  const trigger = root.querySelector('.select-trigger');
  const menu = root.querySelector('.select-menu');

  function syncTrigger() {
    const opt = select.options[select.selectedIndex];
    trigger.textContent = opt ? opt.textContent : '';
  }
  function buildMenu() {
    menu.innerHTML = '';
    Array.from(select.options).forEach(opt => {
      const li = document.createElement('li');
      li.textContent = opt.textContent;
      if (opt.value === select.value) li.classList.add('selected');
      li.addEventListener('click', () => {
        select.value = opt.value;
        syncTrigger();
        select.dispatchEvent(new Event('change', { bubbles: true }));
        root.classList.remove('open');
      });
      menu.appendChild(li);
    });
  }
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !root.classList.contains('open');
    document.querySelectorAll('.custom-select.open, .custom-date.open').forEach(el => el.classList.remove('open'));
    if (willOpen) { buildMenu(); root.classList.add('open'); }
  });

  syncTrigger();
  root._syncTrigger = syncTrigger;
}

['active-task-select-widget', 'task-priority-widget', 'sort-select-widget'].forEach(setupCustomSelect);

// --- CUSTOM DATE PICKER (replaces the native <input type="date"> calendar popup) ---
function setupDatePicker() {
  const root = document.getElementById('task-date-widget');
  const hidden = document.getElementById('task-date');
  const trigger = root.querySelector('.select-trigger');
  const monthLabel = document.getElementById('date-panel-month');
  const grid = document.getElementById('date-grid');
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  let viewDate = new Date();
  viewDate.setDate(1);

  function fmtISO(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  function fmtDisplay(iso) {
    const [y,m,d] = iso.split('-').map(Number);
    return `${d} ${monthNames[m-1].slice(0,3)} ${y}`;
  }
  function refreshTrigger() { trigger.textContent = hidden.value ? fmtDisplay(hidden.value) : 'Due Date'; }

  function renderGrid() {
    monthLabel.textContent = monthNames[viewDate.getMonth()] + ' ' + viewDate.getFullYear();
    grid.innerHTML = '';
    const startOffset = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
    const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 0).getDate();
    const daysInPrevMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 0).getDate();
    const todayISO = fmtISO(new Date());

    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push({ day: daysInPrevMonth - startOffset + 1 + i, muted: true });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, muted: false });
    let trailing = 1;
    while (cells.length < 42) { cells.push({ day: trailing++, muted: true }); }

    cells.forEach(c => {
      const span = document.createElement('div');
      span.className = 'date-cell' + (c.muted ? ' muted' : '');
      span.textContent = c.day;
      if (!c.muted) {
        const iso = fmtISO(new Date(viewDate.getFullYear(), viewDate.getMonth(), c.day));
        if (iso === todayISO) span.classList.add('today');
        if (iso === hidden.value) span.classList.add('selected');
        span.addEventListener('click', () => {
          hidden.value = iso;
          refreshTrigger();
          root.classList.remove('open');
        });
      }
      grid.appendChild(span);
    });
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !root.classList.contains('open');
    document.querySelectorAll('.custom-select.open, .custom-date.open').forEach(el => el.classList.remove('open'));
    if (willOpen) {
      viewDate = hidden.value ? new Date(hidden.value) : new Date();
      viewDate.setDate(1);
      renderGrid();
      root.classList.add('open');
    }
  });
  document.getElementById('date-prev').addEventListener('click', (e) => { e.stopPropagation(); viewDate.setMonth(viewDate.getMonth()-1); renderGrid(); });
  document.getElementById('date-next').addEventListener('click', (e) => { e.stopPropagation(); viewDate.setMonth(viewDate.getMonth()+1); renderGrid(); });
  document.getElementById('date-clear').addEventListener('click', (e) => { e.stopPropagation(); hidden.value = ''; refreshTrigger(); root.classList.remove('open'); });
  document.getElementById('date-today').addEventListener('click', (e) => { e.stopPropagation(); hidden.value = fmtISO(new Date()); refreshTrigger(); root.classList.remove('open'); });

  refreshTrigger();
  root._syncTrigger = refreshTrigger;
}
setupDatePicker();

document.addEventListener('click', (e) => {
  document.querySelectorAll('.custom-select.open, .custom-date.open').forEach(el => {
    if (!el.contains(e.target)) el.classList.remove('open');
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.custom-select.open, .custom-date.open').forEach(el => el.classList.remove('open'));
});

// --- BOOTUP ---
ipcRenderer.on('tasks-loaded', (e, t) => { tasks = t || []; renderTasks(); });
ipcRenderer.on('stats-loaded', (e, s) => { stats = s || { totalSeconds: 0, tasksDone: 0, history: {} }; updateStatsUI(); });
ipcRenderer.send('load-tasks');
ipcRenderer.send('load-stats');
updateDisplay();
updateWreathProgress();