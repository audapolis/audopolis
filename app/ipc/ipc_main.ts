import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { assertSome } from '../src/util';
import path from 'path';
import fs from 'fs';
import { setMenuBar, showMenuBar, showContextMenu } from '../main_process/menu';
import { sendAll } from '../main_process/windowList';
import { serverInfo } from '../main_process/server';
import { ServerInfo } from '../main_process/types';
import { logFilePath } from '../src/util/log';

ipcMain.handle('open-file', (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  assertSome(win);
  return dialog.showOpenDialog(win, options);
});

ipcMain.handle('save-file', (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  assertSome(win);
  return dialog.showSaveDialog(win, options);
});

ipcMain.handle('open-text-in-system', (event, options) => {
  const tempdir = app.getPath('temp');
  const filepath = path.join(tempdir, options.name);
  try {
    fs.writeFileSync(filepath, options.text);
  } catch (e) {
    dialog.showMessageBoxSync({
      type: 'error',
      message: 'Failed to open licenses because there is not enough space left on your disk.',
    });
  }
  shell.openPath(filepath);
});

ipcMain.handle('get-about', () => {
  if (process.env.NODE_ENV === 'development') {
    return {
      // this gets bundeled to `build/main_process/start.cjs.js` thus this path is a bit wiered
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      version: require('../../get_version.js')(),
    };
  } else {
    return {
      version: app.getVersion(),
    };
  }
});

ipcMain.on('set-menubar', (event, args) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  assertSome(win);
  setMenuBar(win, args);
});

ipcMain.on('show-menubar', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  assertSome(win);
  showMenuBar(win);
});

export function menuBarClick(window: BrowserWindow, uuid: string): void {
  window.webContents.send('menubar-click', uuid);
}

ipcMain.on('show-contextmenu', (event, args) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  assertSome(win);
  showContextMenu(win, args);
});

export function contextMenuClick(window: BrowserWindow, uuid: string): void {
  window.webContents.send('contextmenu-click', uuid);
}

export function publishServerInfo(update?: Partial<ServerInfo>): void {
  if (update) {
    Object.keys(update).forEach((k: keyof typeof update) => {
      (serverInfo[k] as any) = update[k];
    });
  }
  if (serverInfo.state == 'running') {
    sendAll('local-server-info', serverInfo);
  }
}

export function publishServerStderr(stderr: string): void {
  sendAll('local-server-stderr', stderr);
}

ipcMain.on('local-server-request', () => {
  publishServerInfo();
});

export function openAbout(window: BrowserWindow): void {
  window.webContents.send('open-about');
}

export function exportDebugLog(window: BrowserWindow): void {
  window.webContents.send('export-debug-log', logFilePath);
}

ipcMain.handle('get-home-path', () => {
  return app.getPath('home');
});
