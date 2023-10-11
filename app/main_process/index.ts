import { app, BrowserWindow, session, dialog } from 'electron';
import installExtension, {
  REDUX_DEVTOOLS,
  REACT_DEVELOPER_TOOLS,
} from 'electron-devtools-installer';
import { autoUpdater } from 'electron-updater';

initMainProcessLog();

export const createWindow = (): void => {
  const window = new BrowserWindow({
    height: 600,
    width: 800,
    frame: false,
    titleBarStyle: 'hiddenInset',
    titleBarOverlay: true,
    trafficLightPosition: { x: 21, y: 21 },
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableBlinkFeatures: 'ClipboardCustomFormats',
      nativeWindowOpen: true,
    },
    show: false,
  });

  let dontSendLog = false;
  window.webContents.on('console-message', (_e, level, message) => {
    if (message == 'server stderr') dontSendLog = true;
    logLine && !dontSendLog && logLine(LogSource.RendererProcess, NumericLogLevels[level], message);

    if (message == 'console.groupEnd') dontSendLog = false;
  });

  window.webContents.on('new-window', (event, url, frameName, disposition, options) => {
    if (frameName === 'modal') {
      event.preventDefault();
      event.newGuest = new BrowserWindow({
        ...options,
        parent: window,
        width: 500,
        height: 400,
      });
    }
  });

  if (process.env.NODE_ENV === 'development') {
    installExtension([REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS])
      .then((name: string) => console.log(`Added Extension:  ${name}`))
      .catch((err: string) => console.log('An error occurred: ', err))
      .finally(() => {
        window.webContents.openDevTools();
        window.loadURL(import.meta.env.VITE_DEV_SERVER_URL);
      });
  } else if (isRunningInTest()) {
    window.loadURL(import.meta.env.VITE_DEV_SERVER_URL);
  } else {
    window.loadURL(
      new URL('../build/renderer_process/index.html', 'file://' + __dirname).toString()
    );
  }
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // TODO better policy
        'Content-Security-Policy': [
          "default-src *  data: blob: filesystem: about: ws: wss: 'unsafe-inline' 'unsafe-eval'",
        ],
      },
    });
  });

  windowList.push(window);
  window.on('close', () => {
    setMenuBar(window, []);
    const i = windowList.findIndex((x) => x == window);
    windowList.splice(i, 1);
  });

  setMenuBar(window, []);
  window.on('focus', () => {
    applyMenuBar(window);
  });

  window.on('ready-to-show', () => window.show());
};

function configureUpdater() {
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', (info) => {
    console.log('updater info', info);
    dialog
      .showMessageBox({
        type: 'info',
        title: 'New Version found',
        message: `A new version of audapolis (v${info.version}) was found. Do you want to upgrade?`,
        buttons: ['Yes', 'No'],
        cancelId: 1,
      })
      .then((val) => {
        if (val.response === 0) {
          autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(info);
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Restart now?',
        message: `Version ${info.version} of audapolis was downloaded successfully. Do you want to restart audapolis now to upgrade?`,
        detail:
          'You can also choose to not upgrade now. In this case the new version will be installed once you restart audapolis.',
        buttons: ['Yes', 'No'],
        cancelId: 1,
      })
      .then((val) => {
        if (val.response === 0) {
          setTimeout(() => autoUpdater.quitAndInstall());
        }
      });
  });

  autoUpdater.on('error', (error) => {
    dialog.showErrorBox('Error: ', error == null ? 'unknown' : (error.stack || error).toString());
  });

  autoUpdater.checkForUpdatesAndNotify();
}

app.on('ready', () => {
  createWindow();
  configureUpdater();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

(global as any).window = {};
import '../ipc/ipc_main';
import './server';
import { windowList } from './windowList';
import { applyMenuBar, setMenuBar } from './menu';
import { isRunningInTest } from '../src/util';
import { LogSource, NumericLogLevels, initMainProcessLog, logLine } from '../src/util/log';
