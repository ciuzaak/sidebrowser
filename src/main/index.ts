import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { ViewManager } from './view-manager';
import { registerIpcRouter } from './ipc-router';

const INITIAL_URL = 'about:blank';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 393,
    height: 852,
    title: 'sidebrowser',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  const win = createWindow();
  const viewManager = new ViewManager(win);
  registerIpcRouter(win, viewManager);

  // Navigate to the initial URL once the renderer has reported its chrome height.
  // We defer by one tick so the renderer has a chance to send chrome:set-height first;
  // if it hasn't by the time we navigate, the view bounds will reflow once the renderer
  // does send the height.
  setImmediate(() => {
    void viewManager.navigate(INITIAL_URL);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow();
      const newViewManager = new ViewManager(newWin);
      registerIpcRouter(newWin, newViewManager);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
