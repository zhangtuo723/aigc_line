import path from 'node:path';
import fs from 'node:fs/promises';
import type { FSWatcher } from 'chokidar';
import chokidar from 'chokidar';
import type { WorkspaceState } from '../../../src/shared/ipc.types';
import { readManifest, updateManifestCues, writeManifest } from './project.store';
import { parseSrt } from './srt.parser';
import log from 'electron-log/main';

const watchers = new Map<string, FSWatcher>();

export async function scanWorkspace(folderPath: string): Promise<WorkspaceState> {
  const entries = await fs.readdir(folderPath).catch(() => [] as string[]);
  const mp3 = entries.find((name) => name.toLowerCase().endsWith('.mp3'));
  const srt = entries.find((name) => name.toLowerCase().endsWith('.srt'));

  const audioPath = mp3 ? path.join(folderPath, mp3) : undefined;
  const srtPath = srt ? path.join(folderPath, srt) : undefined;

  let cueCount = 0;
  if (srtPath) {
    try {
      const content = await fs.readFile(srtPath, 'utf-8');
      const cues = parseSrt(content);
      cueCount = cues.length;

      const manifest = (await readManifest(folderPath)) ?? {
        projectId: '',
        folderPath,
        cues: [],
        scenes: [],
        runs: [],
      };
      const updated = updateManifestCues(manifest, cues);
      updated.audioPath = audioPath;
      updated.srtPath = srtPath;
      await writeManifest(folderPath, updated);
    } catch (err) {
      log.error('Failed to parse SRT during scan:', err);
    }
  }

  return {
    audioFound: !!audioPath,
    srtFound: !!srtPath,
    audioPath,
    srtPath,
    cueCount,
    valid: !!audioPath && !!srtPath,
  };
}

export function watchWorkspace(
  folderPath: string,
  onChange: () => void,
): () => void {
  stopWatching(folderPath);

  const watcher = chokidar.watch(folderPath, {
    ignored: /(^|[/\\])\.aigc-line([/\\]|$)/,
    depth: 0,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  let debounceTimer: NodeJS.Timeout | null = null;
  const notify = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onChange();
      debounceTimer = null;
    }, 500);
  };

  watcher.on('add', (filePath) => {
    if (/\.(mp3|srt)$/i.test(filePath)) notify();
  });
  watcher.on('change', (filePath) => {
    if (/\.(mp3|srt)$/i.test(filePath)) notify();
  });
  watcher.on('unlink', (filePath) => {
    if (/\.(mp3|srt)$/i.test(filePath)) notify();
  });

  watchers.set(folderPath, watcher);
  return () => stopWatching(folderPath);
}

export function stopWatching(folderPath: string): void {
  const watcher = watchers.get(folderPath);
  if (watcher) {
    watcher.close().catch(() => undefined);
    watchers.delete(folderPath);
  }
}
