import fs, { createWriteStream } from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { getHomePath, saveFile } from '../../ipc/ipc_renderer';
import { isRunningInTest } from './index';
import glob from 'glob';
import { app } from 'electron';

export enum LogLevel {
  Log,
  Info,
  Warn,
  Error,
}

export const NumericLogLevels = [LogLevel.Log, LogLevel.Info, LogLevel.Warn, LogLevel.Error];

export enum LogSource {
  MainProcess,
  RendererProcess,
  ServerProcess,
}

export let logFilePath: string | null = null;

const buffer: string[] = [];
function write(str: string) {
  buffer.push(str);

  const try_fn = () => {
    if (process.stdout.writableLength == 0) {
      process.stdout.write(buffer.shift() || '');
    } else {
      setTimeout(try_fn, 10);
    }
  };
  try_fn();
}

function log(file: number, source: LogSource, level: LogLevel, ...args: any[]) {
  const date = new Date().toISOString();
  const level_str = LogLevel[level];
  const source_str = LogSource[source];
  const string_args = args.map((x) => x.toString());
  const log_line = JSON.stringify({
    date,
    source: source_str,
    level: level_str,
    args: string_args,
  });

  const FgGreen = '\x1b[32m';
  const FgBlue = '\x1b[34m';
  const FgYellow = '\x1b[33m';
  const Reset = '\x1b[0m';
  const source_color = [FgGreen, FgBlue, FgYellow][source];

  write(
    args
      .join('\n')
      .split('\n')
      .map(
        (line) =>
          `${source_color}[${source_str.substring(0, 4)}]${Reset} ${level_str.padEnd(5)} | ${line}`
      )
      .join('\n') + '\n'
  );
  fs.writeSync(file, log_line + '\n');
  fs.fsyncSync(file);
}

export let logLine: ((source: LogSource, level: LogLevel, ...args: any[]) => void) | null = null;

export function initMainProcessLog(): void {
  if (isRunningInTest()) {
    return;
  }
  if (logFilePath !== null) {
    throw new Error('Thou shalt not initialize logging twice');
  }
  const log_dir = app.getPath('logs');
  if (!fs.existsSync(log_dir)) {
    fs.mkdirSync(log_dir, { recursive: true });
  }
  const now = new Date();
  for (const oldLogfile of glob.sync(path.join(log_dir, '*.log'))) {
    if (now.getTime() - fs.statSync(oldLogfile).mtime.getTime() > 5 * 24 * 60 * 60 * 1000) {
      fs.rmSync(oldLogfile);
    }
  }
  const fileName = now.getTime().toString() + '.log';
  logFilePath = path.join(log_dir, fileName);
  const file = fs.openSync(logFilePath, 'w');
  console.log('Init logging into', logFilePath);
  console.log = (...args) => log(file, LogSource.MainProcess, LogLevel.Log, ...args);
  console.trace = (...args) => log(file, LogSource.MainProcess, LogLevel.Log, ...args);
  console.debug = (...args) => log(file, LogSource.MainProcess, LogLevel.Log, ...args);
  console.info = (...args) => log(file, LogSource.MainProcess, LogLevel.Info, ...args);
  console.warn = (...args) => log(file, LogSource.MainProcess, LogLevel.Warn, ...args);
  console.error = (...args) => log(file, LogSource.MainProcess, LogLevel.Error, ...args);
  logLine = (...args) => log(file, ...args);
  console.groupCollapsed = () => {};
  console.groupEnd = () => {};
}

export async function exportDebugLogsToDisk(file: string): Promise<void> {
  console.log('Exporting logs');
  const zip = JSZip();
  zip.file('debug.log', fs.readFileSync(file));

  const savePath = await saveFile({
    title: 'Save log as...',
    properties: ['showOverwriteConfirmation', 'createDirectory'],
    filters: [
      { name: 'Zip files', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    defaultPath: path.join(await getHomePath(), 'debug_log.zip'),
  }).then((x) => x.filePath);
  if (!savePath) return;

  await new Promise((resolve, reject) => {
    zip
      .generateNodeStream({ type: 'nodebuffer', streamFiles: true })
      .pipe(createWriteStream(savePath))
      .on('finish', resolve)
      .on('error', reject);
  });
}
