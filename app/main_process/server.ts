import path from 'path';
import process from 'process';
import fs from 'fs';
import { spawn, execFile } from 'child_process';
import { app, dialog } from 'electron';
import { publishServerInfo, publishServerStderr } from '../ipc/ipc_main';
import { ServerInfo } from './types';
import { isRunningInTest } from '../src/util';

function findServer() {
  const possibilities = [
    // In packaged app
    path.join(process.resourcesPath, 'server', 'server'),
    path.join(process.resourcesPath, 'server', 'server.exe'),
    // In development
    path.join(process.cwd(), 'server', 'server'),
    path.join(process.cwd(), 'server', 'server.exe'),

    path.join('server', 'server'),
    path.join('server', 'server.exe'),
  ];
  for (const path of possibilities) {
    console.log('trying', path, 'exists:', fs.existsSync(path));
    if (fs.existsSync(path)) {
      return path;
    }
  }
  return null;
}

function getServerProcess() {
  if (process.env.NODE_ENV === 'development' || isRunningInTest()) {
    console.log(process.cwd() + '/../server');
    return spawn('poetry', ['run', 'python', 'run.py'], {
      stdio: 'pipe',
      cwd: process.cwd() + '/../server',
      env: { ...process.env },
      shell: process.platform == 'win32',
    });
  }
  const path = findServer();
  if (path === null) {
    dialog.showMessageBoxSync({
      type: 'error',
      message:
        'Failed to find local executable for server. Please report this issue to https://github.com/bugbakery/audapolis/issues',
    });
    app.quit();
    return null;
  }
  console.log('Starting server from', path);
  return execFile(path, {
    env: { ...process.env },
  });
}

interface ServerStartingMessage {
  msg: 'server_starting';
  port: number;
}

interface ServerStartedMessage {
  msg: 'server_started';
  token: string;
}

export const serverInfo: ServerInfo = {
  port: null,
  token: null,
  state: 'not started',
};

let serverProcess = null;
function startServer() {
  serverProcess = getServerProcess();
  if (!serverProcess) {
    return;
  }
  serverProcess.stdout?.on('data', (data: Buffer) => {
    console.log('server-stdout', data.toString());
    for (const line of data.toString().trim().split(/\r?\n/)) {
      console.log('line', line);
      try {
        const parsed_data: ServerStartingMessage | ServerStartedMessage = JSON.parse(line);
        if (parsed_data.msg == 'server_starting') {
          publishServerInfo({ state: 'starting', port: parsed_data.port });
        } else if (parsed_data.msg == 'server_started') {
          publishServerInfo({ state: 'running', token: parsed_data.token });
        }
      } catch (e) {
        console.log('error decoding stdout json', e);
      }
    }
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    console.log(`server-stderr: \n${data}`);
    publishServerStderr(data.toString());
  });

  serverProcess.on('close', (code: number | null) => {
    if (code == 0) {
      publishServerInfo({ state: 'stopped' });
    } else {
      publishServerInfo({ state: `exited - error code ${code}` });
    }
    serverProcess = null;
    console.log(`child process exited with code ${code}`);
  });
}
startServer();
