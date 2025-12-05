import fs from 'node:fs/promises';
import path from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

interface LoggerOptions {
  logDir: string;
  baseFileName: string;
  maxBytes: number;
  maxFiles: number;
  console: boolean;
  level: LogLevel;
}

interface LogEntry {
  ts: string;
  level: LogLevel;
  message: string;
  meta?: any;
}

class Logger {
  private readonly logPath: string;
  private readonly opts: LoggerOptions;
  private queue: Promise<void>;

  constructor(opts: LoggerOptions) {
    this.opts = opts;
    this.logPath = path.join(opts.logDir, opts.baseFileName);
    this.queue = fs.mkdir(opts.logDir, { recursive: true }).then(() => {}).catch(() => {});
  }

  debug(message: string, meta?: any) {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: any) {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: any) {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: any) {
    this.log('error', message, meta);
  }

  private log(level: LogLevel, message: string, meta?: any) {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.opts.level]) return;
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      message,
      meta: meta === undefined ? undefined : this.safeMeta(meta),
    };
    const line = JSON.stringify(entry);
    this.queue = this.queue
      .then(() => this.write(entry, line))
      .catch(() => {});
  }

  private async write(entry: LogEntry, line: string) {
    const lineBytes = Buffer.byteLength(line) + 1; // newline
    await this.rotateIfNeeded(lineBytes);
    await fs.appendFile(this.logPath, line + '\n', 'utf8');

    if (this.opts.console) {
      const consoleLine = `[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}` +
        (entry.meta !== undefined ? ` ${this.metaForConsole(entry.meta)}` : '');
      const method = entry.level === 'error' ? console.error
        : entry.level === 'warn' ? console.warn
        : entry.level === 'info' ? console.info
        : console.debug;
      method(consoleLine);
    }
  }

  private async rotateIfNeeded(nextBytes: number) {
    let size = 0;
    try {
      const stat = await fs.stat(this.logPath);
      size = stat.size;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return; // nothing to rotate yet
      return; // on stat errors, skip rotation but keep logging
    }

    if (size + nextBytes <= this.opts.maxBytes) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedName = `${this.opts.baseFileName.replace(/\.log$/i, '')}-${stamp}.log`;
    const rotatedPath = path.join(this.opts.logDir, rotatedName);
    try {
      await fs.rename(this.logPath, rotatedPath);
    } catch (e: any) {
      if (e?.code !== 'ENOENT') return; // if rename fails for other reasons, skip rotation
    }
    await this.trimOldFiles();
  }

  private async trimOldFiles() {
    try {
      const files = await fs.readdir(this.opts.logDir);
      const prefix = this.opts.baseFileName.replace(/\.log$/i, '');
      const rotated = await Promise.all(
        files
          .filter((name) => name.startsWith(prefix + '-') && name.endsWith('.log'))
          .map(async (name) => {
            const fullPath = path.join(this.opts.logDir, name);
            const stat = await fs.stat(fullPath);
            return { name, fullPath, mtime: stat.mtimeMs };
          })
      );
      rotated.sort((a, b) => b.mtime - a.mtime);
      const extras = rotated.slice(this.opts.maxFiles);
      await Promise.all(extras.map((file) => fs.rm(file.fullPath).catch(() => {})));
    } catch {
      // ignore trimming errors
    }
  }

  private safeMeta(meta: any) {
    try {
      return JSON.parse(JSON.stringify(meta));
    } catch {
      return { note: 'Unserializable meta', value: String(meta) };
    }
  }

  private metaForConsole(meta: any) {
    if (meta === null || meta === undefined) return '';
    if (typeof meta === 'string') return meta;
    try {
      return JSON.stringify(meta);
    } catch {
      return '[meta serialization failed]';
    }
  }
}

const LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';

export const logger = new Logger({
  logDir: path.resolve(process.cwd(), 'logs'),
  baseFileName: 'app.log',
  maxBytes: 5 * 1024 * 1024, // 5 MB
  maxFiles: 5,
  console: process.env.LOG_TO_CONSOLE !== 'false',
  level: LOG_LEVEL,
});


