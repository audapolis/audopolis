import fs from 'fs';
import path from 'path';
import { Source, RenderItem } from './document';
import Fessonia from '@tedconf/fessonia';
import ffmpegPath from 'ffmpeg-static';
import AppDirectory from 'appdirectory';
import { player } from './player';
import { WebVtt } from '@audapolis/webvtt-writer';

const { FFmpegCommand, FFmpegInput, FFmpegOutput, FilterNode, FilterChain } = Fessonia({
  ffmpeg_bin: ffmpegPath.replace('app.asar', 'app.asar.unpacked'),
});

export function getSubtitleCodec(outputPath: string): string {
  if (outputPath.endsWith('.mp4')) {
    return 'mov_text';
  } else if (outputPath.endsWith('.mkv')) {
    return 'srt';
  }
  throw Error('subtitles not supported for this file extension');
}

function addSubtitles(
  cmd: Fessonia.FFmpegCommand,
  concatVideo: Fessonia.FilterChain,
  outputObj: Fessonia.FFmpegOutput,
  outputPath: string,
  subtitles: { path: string; type: 'burn_in' | 'seperate_track' }
) {
  if (subtitles?.type == 'burn_in') {
    concatVideo.appendNodes(new FilterNode('subtitles', { filename: subtitles.path }));
  } else if (subtitles?.type == 'seperate_track') {
    const subtitleInput = new FFmpegInput(subtitles.path);
    cmd.addInput(subtitleInput);
    outputObj.addStream(subtitleInput.streamSpecifier('s'));
    outputObj.addOptions({ 'c:s': getSubtitleCodec(outputPath) });
  }
}

async function combineVideoParts(
  parts: { v: Fessonia.FFmpegInput; a: Fessonia.FFmpegInput }[],
  subtitles: { path: string; type: 'burn_in' | 'seperate_track' } | null,
  targetResolution: { x: number; y: number },
  output: string,
  onTimeProgress: ProgressCallback
): Promise<unknown> {
  const cmd = new FFmpegCommand({ y: undefined });
  const partSpecifiers = parts.map((p) => {
    const scale = new FilterChain([
      new FilterNode('scale', {
        width: `min(iw*${targetResolution.y}/ih\\,${targetResolution.x})`,
        height: `min(${targetResolution.y}\\,ih*${targetResolution.x}/iw)`,
      }),
      new FilterNode('pad', {
        width: targetResolution.x,
        height: targetResolution.y,
        x: `(${targetResolution.x}-iw)/2`,
        y: `(${targetResolution.y}-ih)/2`,
      }),
    ]);
    cmd.addInput(p.v);
    if (p.v != p.a) {
      cmd.addInput(p.a);
    }
    scale.addInput(p.v.streamSpecifier('v'));
    cmd.addFilterChain(scale);

    return { v: scale.streamSpecifier(), a: p.a.streamSpecifier('a') };
  });
  const concatVideo = new FilterChain([
    new FilterNode('concat', { n: parts.length.toString(), v: '1', a: '0' }),
  ]);
  const concatAudio = new FilterChain([
    new FilterNode('concat', { n: parts.length.toString(), v: '0', a: '1' }),
  ]);
  for (const part of partSpecifiers) {
    concatVideo.addInput(part.v);
    concatAudio.addInput(part.a);
  }

  const outputObj = new FFmpegOutput(output);
  if (subtitles != null) {
    addSubtitles(cmd, concatVideo, outputObj, output, subtitles);
  }
  cmd.addFilterChain(concatVideo);
  cmd.addFilterChain(concatAudio);
  outputObj.addStream(concatVideo.streamSpecifier());
  outputObj.addStream(concatAudio.streamSpecifier());
  outputObj.addOptions({ vsync: 'vfr' });

  cmd.addOutput(outputObj);
  return runFfmpegWithProgress(cmd, onTimeProgress);
}

function filterSource(filter: string, options: Record<string, string | number>) {
  const filters = new FilterChain([new FilterNode(filter, options)]);
  return new FFmpegInput(filters, {
    f: 'lavfi',
  });
}

export function isSeperateSubtitleTrackSupported(outputPath: string): boolean {
  try {
    getSubtitleCodec(outputPath);
    return true;
  } catch {
    return false;
  }
}

export async function exportVideo(
  content: RenderItem[],
  sources: Record<string, Source>,
  outputPath: string,
  targetResolution: { x: number; y: number },
  subtitles: { vtt: WebVtt; type: 'burn_in' | 'seperate_track' } | null,
  progressCallback: ProgressCallback = () => {}
): Promise<void> {
  const tempdir = await getTempDir();

  let diskSubtitles = null;
  if (subtitles !== null) {
    fs.writeFileSync(path.join(tempdir, 'subtitles.vtt'), subtitles.vtt.toString());
    diskSubtitles = { path: path.join(tempdir, 'subtitles.vtt').toString(), type: subtitles.type };
  }

  let total = 0;
  const files = content.map((part, i) => {
    total += part.length;
    const blackSource = filterSource('color', {
      color: 'black',
      rate: subtitles ? 30 : 1, // ffmpeg only burns in the subtitles which exist at the beginning of the frame. With 1fps, subtitles appear delayed or are skipped completely
      duration: part.length,
      size: `${targetResolution.x}x${targetResolution.y}`,
    });
    if ('source' in part) {
      const source = sources[part.source];
      const source_path = path.join(tempdir, `part${i}-source`);
      fs.writeFileSync(source_path, new Buffer(source.fileContents));
      const input = new FFmpegInput(source_path, {
        ss: part.sourceStart.toString(),
        t: part.length.toString(),
      });
      if (player.getResolution(part.source)) {
        return { v: input, a: input };
      } else {
        return { v: blackSource, a: input };
      }
    } else {
      const silenceSource = filterSource('anullsrc', {
        duration: part.length,
      });
      return { v: blackSource, a: silenceSource };
    }
  });

  await combineVideoParts(files, diskSubtitles, targetResolution, outputPath, (p) =>
    progressCallback(p / total)
  );
  fs.rmdirSync(tempdir, { recursive: true });
}

export type ProgressCallback = (progress: number) => void;

async function runFfmpegWithProgress(
  cmd: Fessonia.FFmpegCommand,
  onTimeProgress: ProgressCallback
) {
  console.debug('ffmpeg commandline: ', cmd.toString());
  cmd.on('update', (data: { out_time_ms: number }) => {
    onTimeProgress(data.out_time_ms / 1000);
  });
  const promise = new Promise((resolve, reject) => {
    cmd.on('success', resolve);
    cmd.on('error', reject);
  });
  cmd.spawn(true);
  return promise;
}

async function combineAudioParts(
  parts: Fessonia.FFmpegInput[],
  output: string,
  onTimeProgress: ProgressCallback
): Promise<unknown> {
  const cmd = new FFmpegCommand({ y: undefined });
  const concat = new FilterChain([
    new FilterNode('concat', { n: parts.length.toString(), v: '0', a: '1' }),
  ]);
  for (const part of parts) {
    cmd.addInput(part);
    concat.addInput(part.streamSpecifier('a'));
  }
  cmd.addFilterChain(concat);
  const outputObj = new FFmpegOutput(output);
  outputObj.addStream(concat.streamSpecifier());
  cmd.addOutput(outputObj);
  return runFfmpegWithProgress(cmd, onTimeProgress);
}

export async function exportAudio(
  content: RenderItem[],
  sources: Record<string, Source>,
  outputPath: string,
  progressCallback: ProgressCallback = () => {}
): Promise<void> {
  const tempdir = await getTempDir();

  let total = 0;

  const files = content.map((part, i) => {
    total += part.length;
    if ('source' in part) {
      const source = sources[part.source];
      const source_path = path.join(tempdir, `part${i}-source`);
      fs.writeFileSync(source_path, new Buffer(source.fileContents));
      return new FFmpegInput(source_path, {
        ss: part.sourceStart.toString(),
        t: part.length.toString(),
      });
    } else {
      return filterSource('anullsrc', {
        duration: part.length,
      });
    }
  });

  await combineAudioParts(files, outputPath, (p) => progressCallback(p / total));
  fs.rmdirSync(tempdir, { recursive: true });
}

function getFileDuration(filePath: string): Promise<number> {
  const elem = document.createElement('video');
  const fileContents = fs.readFileSync(filePath);
  const objectUrl = URL.createObjectURL(new Blob([fileContents]));

  const promise = new Promise<number>((resolve, reject) => {
    elem.onloadeddata = () => {
      resolve(elem.duration * 1000);
      elem.remove();
      URL.revokeObjectURL(objectUrl);
    };
    elem.onerror = (err) => {
      console.error('failed to get file duration', err);
      reject(Error('failed to file duration'));
    };
  });
  elem.setAttribute('src', objectUrl);
  return promise;
}

export async function convertToWav(
  input_path: string,
  progressCallback: (progress: number) => void
): Promise<Buffer> {
  const cmd = new FFmpegCommand({ y: undefined });

  cmd.addInput(new FFmpegInput(input_path));

  const tempdir: string = await getTempDir();
  const outputFile = path.join(tempdir, 'output.wav');
  cmd.addOutput(new FFmpegOutput(outputFile));

  const duration = await getFileDuration(input_path);

  cmd.on('update', (data) => {
    progressCallback(data.out_time_ms / duration);
  });
  const promise = new Promise((resolve, reject) => {
    cmd.on('success', resolve);
    cmd.on('error', reject);
  });
  console.log('running ffmpeg', cmd.toString());
  cmd.spawn(true);
  console.log('ffmpeg result', await promise);

  const fileData = fs.readFileSync(outputFile);
  fs.rmdirSync(tempdir, { recursive: true });
  return fileData;
}

export async function copyToMp4(input_path: string): Promise<Buffer> {
  const tempdir: string = await getTempDir();
  const outputFile = path.join(tempdir, 'output.mp4');

  const cmd = new FFmpegCommand({ y: undefined });
  cmd.addInput(new FFmpegInput(input_path));
  cmd.addOutput(new FFmpegOutput(outputFile, { c: 'copy' }));
  await cmd.execute();

  const fileData = fs.readFileSync(outputFile);
  fs.rmdirSync(tempdir, { recursive: true });
  return fileData;
}

function getTempDir(): Promise<string> {
  return new Promise(function (resolve, reject) {
    const cacheDir = new AppDirectory({
      appName: 'audapolis',
    }).userCache();
    fs.mkdtemp(cacheDir, (err, directory) => {
      if (err) reject(err);
      else resolve(directory);
    });
  });
}
