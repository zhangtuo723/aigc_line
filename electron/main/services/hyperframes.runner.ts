import { spawn } from 'node:child_process';
import log from 'electron-log/main';

export interface HyperframesOptions {
  audioPath: string;
  imagesDir: string;
  srtPath: string;
  outputPath: string;
  fps?: number;
  resolution?: string;
  onProgress?: (message: string) => void;
  abortSignal?: AbortSignal;
}

export async function runHyperframes(options: HyperframesOptions): Promise<string> {
  const {
    audioPath,
    imagesDir,
    srtPath,
    outputPath,
    fps = 24,
    resolution = '1280:720',
    onProgress,
    abortSignal,
  } = options;

  const args = [
    '-m',
    'hyperframes.cli',
    '--audio',
    audioPath,
    '--images-dir',
    imagesDir,
    '--srt',
    srtPath,
    '--output',
    outputPath,
    '--fps',
    String(fps),
    '--resolution',
    resolution,
  ];

  log.info('[Hyperframes] spawn python', args.join(' '));

  return new Promise((resolve, reject) => {
    const proc = spawn('python', args, {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    const stdout: string[] = [];
    const stderr: string[] = [];

    const cleanupAbort = () => {
      if (abortSignal && !abortSignal.aborted) {
        abortSignal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      log.info('[Hyperframes] abort requested, killing process');
      proc.kill('SIGTERM');
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        proc.kill('SIGTERM');
        reject(new Error('Hyperframes run was aborted before start'));
        return;
      }
      abortSignal.addEventListener('abort', onAbort);
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stdout.push(text);
      const lines = text.trim().split(/\r?\n/);
      for (const line of lines) {
        if (line) {
          log.info('[Hyperframes]', line);
          onProgress?.(line);
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderr.push(text);
      const lines = text.trim().split(/\r?\n/);
      for (const line of lines) {
        if (line) {
          log.warn('[Hyperframes]', line);
          onProgress?.(line);
        }
      }
    });

    proc.on('error', (err) => {
      cleanupAbort();
      reject(new Error(`Hyperframes failed to start: ${err.message}`));
    });

    proc.on('close', (code) => {
      cleanupAbort();
      if (code === 0) {
        resolve(outputPath);
      } else {
        const message = stderr.join('').trim() || stdout.join('').trim() || `exit code ${code}`;
        reject(new Error(`Hyperframes failed: ${message}`));
      }
    });
  });
}
