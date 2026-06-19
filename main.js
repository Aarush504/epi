const { app, BrowserWindow, ipcMain } = require('electron');
const Store = require('electron-store');

const store = new Store();
let win;

function createWindow () {
  win = new BrowserWindow({
    width: 420,
    height: 700,
    resizable: false,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.setMenu(null); // This kills the File/Edit/View menu
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

ipcMain.on('window-minimize', () => { if (win) win.minimize(); });
ipcMain.on('window-close', () => { if (win) win.close(); });

ipcMain.on('save-tasks', (event, tasks) => store.set('epi-tasks', tasks));
ipcMain.on('load-tasks', (event) => event.reply('tasks-loaded', store.get('epi-tasks') || []));

ipcMain.on('save-stats', (event, stats) => store.set('epi-stats', stats));
ipcMain.on('load-stats', (event) => event.reply('stats-loaded', store.get('epi-stats') || {
  totalSeconds: 0,
  tasksDone: 0,
  history: {} 
}));