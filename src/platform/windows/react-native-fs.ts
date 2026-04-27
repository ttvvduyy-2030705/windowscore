import {NativeModules} from 'react-native';

export type ReadDirItem = {
  ctime?: Date;
  mtime?: Date;
  name: string;
  path: string;
  size: number;
  isFile: () => boolean;
  isDirectory: () => boolean;
};

type NativeReadDirItem = {
  ctime?: number | string;
  mtime?: number | string;
  name: string;
  path: string;
  size: number;
  type?: 'file' | 'directory';
  isDirectory?: boolean;
};

const memoryFiles = new Map<string, string>();
const memoryDirs = new Set<string>();
const memoryTimes = new Map<string, Date>();

const ROOT = 'C:/video/aplus score';

const normalizePath = (path?: string | null) =>
  String(path || '').replace(/\\/g, '/').replace(/\/+$/g, '');

const touch = (path: string) => {
  memoryTimes.set(normalizePath(path), new Date());
};

const ensureMemoryParents = (path: string) => {
  const normalized = normalizePath(path);
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length <= 1) {
    return;
  }

  let current = normalized.startsWith('/') ? '/' : '';
  parts.slice(0, -1).forEach(part => {
    current = current ? `${current.replace(/\/$/g, '')}/${part}` : part;
    memoryDirs.add(current);
    touch(current);
  });
};

const makeDirItem = (path: string, isDirectory = false): ReadDirItem => {
  const normalized = normalizePath(path);
  const name = normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
  const time = memoryTimes.get(normalized) || new Date();

  return {
    ctime: time,
    mtime: time,
    name,
    path: normalized,
    size: isDirectory ? 0 : memoryFiles.get(normalized)?.length || 0,
    isFile: () => !isDirectory,
    isDirectory: () => isDirectory,
  };
};

const toDate = (value?: number | string) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value);
  }

  if (typeof value === 'string' && value.length) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
};

const toReadDirItem = (item: NativeReadDirItem): ReadDirItem => {
  const isDirectory = item.type === 'directory' || item.isDirectory === true;

  return {
    ctime: toDate(item.ctime),
    mtime: toDate(item.mtime),
    name: item.name,
    path: normalizePath(item.path),
    size: Number(item.size || 0),
    isFile: () => !isDirectory,
    isDirectory: () => isDirectory,
  };
};

const getTurboModule = (moduleName: string) => {
  try {
    const rn = require("react-native") as any;
    return rn?.TurboModuleRegistry?.get?.(moduleName) || null;
  } catch (error) {
    return null;
  }
};

const nativeStorage = () => {
  const modules = NativeModules as any;
  return modules?.WindowsVideoStorageModule || getTurboModule("WindowsVideoStorageModule");
};

const callNative = async <T,>(method: string, ...args: any[]): Promise<T | undefined> => {
  const module = nativeStorage();
  const fn = module?.[method];

  if (typeof fn !== 'function') {
    return undefined;
  }

  return fn(...args);
};

const memoryExists = async (path: string) => {
  const normalized = normalizePath(path);
  return memoryFiles.has(normalized) || memoryDirs.has(normalized);
};

const memoryMkdir = async (path: string) => {
  const normalized = normalizePath(path);
  ensureMemoryParents(`${normalized}/placeholder`);
  memoryDirs.add(normalized);
  touch(normalized);
  return undefined;
};

const memoryReadDir = async (path: string) => {
  const normalized = normalizePath(path);
  const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`;
  const items: ReadDirItem[] = [];
  const seen = new Set<string>();

  const addDirectChild = (targetPath: string, isDirectory: boolean) => {
    const clean = normalizePath(targetPath);
    if (!clean.startsWith(prefix) || clean === normalized) {
      return;
    }

    const rest = clean.slice(prefix.length);
    if (!rest || rest.includes('/')) {
      return;
    }

    if (seen.has(clean)) {
      return;
    }

    seen.add(clean);
    items.push(makeDirItem(clean, isDirectory));
  };

  for (const dir of memoryDirs) {
    addDirectChild(dir, true);
  }

  for (const file of memoryFiles.keys()) {
    addDirectChild(file, false);
  }

  return items;
};

const RNFS = {
  MainBundlePath: ROOT,
  CachesDirectoryPath: `${ROOT}/Cache`,
  DocumentDirectoryPath: `${ROOT}/Documents`,
  DownloadDirectoryPath: `${ROOT}/Downloads`,
  ExternalDirectoryPath: `${ROOT}/External`,
  ExternalStorageDirectoryPath: `${ROOT}/ExternalStorage`,
  TemporaryDirectoryPath: `${ROOT}/Temp`,
  LibraryDirectoryPath: `${ROOT}/Library`,
  PicturesDirectoryPath: `${ROOT}/Pictures`,

  exists: async (path: string) => {
    const normalized = normalizePath(path);

    try {
      const nativeResult = await callNative<boolean>('exists', normalized);
      if (typeof nativeResult === 'boolean') {
        return nativeResult;
      }
    } catch (error) {
      console.log('[WindowsVideoStorage] exists native error =', {path: normalized, error});
    }

    return memoryExists(normalized);
  },

  mkdir: async (path: string) => {
    const normalized = normalizePath(path);

    try {
      const nativeResult = await callNative<boolean>('mkdir', normalized);
      if (typeof nativeResult === 'boolean') {
        return undefined;
      }
    } catch (error) {
      console.log('[WindowsVideoStorage] mkdir native error =', {path: normalized, error});
      throw error;
    }

    return memoryMkdir(normalized);
  },

  readDir: async (path: string) => {
    const normalized = normalizePath(path);

    try {
      const nativeResult = await callNative<string>('readDir', normalized);
      if (typeof nativeResult === 'string') {
        const parsed = JSON.parse(nativeResult) as NativeReadDirItem[];
        return parsed.map(toReadDirItem);
      }
    } catch (error) {
      console.log('[WindowsVideoStorage] readDir native error =', {path: normalized, error});
    }

    return memoryReadDir(normalized);
  },

  stat: async (path: string) => {
    const normalized = normalizePath(path);

    try {
      const nativeResult = await callNative<string>('stat', normalized);
      if (typeof nativeResult === 'string') {
        const parsed = JSON.parse(nativeResult) as NativeReadDirItem;
        const item = toReadDirItem(parsed);

        return {
          path: item.path,
          size: item.size,
          ctime: item.ctime,
          mtime: item.mtime,
          isFile: item.isFile,
          isDirectory: item.isDirectory,
        };
      }
    } catch (error) {
      console.log('[WindowsVideoStorage] stat native error =', {path: normalized, error});
    }

    const isDirectory = memoryDirs.has(normalized);
    const content = memoryFiles.get(normalized) || '';
    const time = memoryTimes.get(normalized) || new Date();

    return {
      path: normalized,
      size: isDirectory ? 0 : content.length,
      ctime: time,
      mtime: time,
      isFile: () => memoryFiles.has(normalized),
      isDirectory: () => isDirectory,
    };
  },

  readFile: async (path: string) => {
    const normalized = normalizePath(path);

    try {
      const nativeResult = await callNative<string>('readFile', normalized);
      if (typeof nativeResult === 'string') {
        return nativeResult;
      }
    } catch (error) {
      console.log('[WindowsVideoStorage] readFile native error =', {path: normalized, error});
    }

    return memoryFiles.get(normalized) || '';
  },

  writeFile: async (path: string, content: string, _encoding?: string) => {
    const normalized = normalizePath(path);

    try {
      const nativeResult = await callNative<boolean>('writeFile', normalized, content || '');
      if (typeof nativeResult === 'boolean') {
        return undefined;
      }
    } catch (error) {
      console.log('[WindowsVideoStorage] writeFile native error =', {path: normalized, error});
      throw error;
    }

    ensureMemoryParents(normalized);
    memoryFiles.set(normalized, content || '');
    touch(normalized);
    return undefined;
  },

  appendFile: async (path: string, content: string, _encoding?: string) => {
    const normalized = normalizePath(path);

    try {
      const nativeResult = await callNative<boolean>('appendFile', normalized, content || '');
      if (typeof nativeResult === 'boolean') {
        return undefined;
      }
    } catch (error) {
      console.log('[WindowsVideoStorage] appendFile native error =', {path: normalized, error});
      throw error;
    }

    ensureMemoryParents(normalized);
    memoryFiles.set(normalized, `${memoryFiles.get(normalized) || ''}${content || ''}`);
    touch(normalized);
    return undefined;
  },

  unlink: async (path: string) => {
    const normalized = normalizePath(path);

    try {
      const nativeResult = await callNative<boolean>('unlink', normalized);
      if (typeof nativeResult === 'boolean') {
        return undefined;
      }
    } catch (error) {
      console.log('[WindowsVideoStorage] unlink native error =', {path: normalized, error});
    }

    for (const file of Array.from(memoryFiles.keys())) {
      if (file === normalized || file.startsWith(`${normalized}/`)) {
        memoryFiles.delete(file);
        memoryTimes.delete(file);
      }
    }

    for (const dir of Array.from(memoryDirs.keys())) {
      if (dir === normalized || dir.startsWith(`${normalized}/`)) {
        memoryDirs.delete(dir);
        memoryTimes.delete(dir);
      }
    }

    return undefined;
  },

  copyFile: async (from: string, to: string) => {
    const normalizedFrom = normalizePath(from);
    const normalizedTo = normalizePath(to);

    try {
      const nativeResult = await callNative<boolean>('copyFile', normalizedFrom, normalizedTo);
      if (typeof nativeResult === 'boolean') {
        return undefined;
      }
    } catch (error) {
      console.log('[WindowsVideoStorage] copyFile native error =', {from: normalizedFrom, to: normalizedTo, error});
      throw error;
    }

    ensureMemoryParents(normalizedTo);
    memoryFiles.set(normalizedTo, memoryFiles.get(normalizedFrom) || '');
    touch(normalizedTo);
    return undefined;
  },

  moveFile: async (from: string, to: string) => {
    const normalizedFrom = normalizePath(from);
    const normalizedTo = normalizePath(to);

    try {
      const nativeResult = await callNative<boolean>('moveFile', normalizedFrom, normalizedTo);
      if (typeof nativeResult === 'boolean') {
        return undefined;
      }
    } catch (error) {
      console.log('[WindowsVideoStorage] moveFile native error =', {from: normalizedFrom, to: normalizedTo, error});
      throw error;
    }

    ensureMemoryParents(normalizedTo);
    memoryFiles.set(normalizedTo, memoryFiles.get(normalizedFrom) || '');
    memoryFiles.delete(normalizedFrom);
    memoryTimes.delete(normalizedFrom);
    touch(normalizedTo);
    return undefined;
  },

  scanFile: async () => {
    return undefined;
  },

  getFallbackBaseDir: async () => {
    try {
      const nativeResult = await callNative<string>('getFallbackBaseDir');
      if (typeof nativeResult === 'string' && nativeResult.length > 0) {
        return normalizePath(nativeResult);
      }
    } catch (error) {
      console.log('[WindowsVideoStorage] fallback base native error =', error);
    }

    return 'C:/video/aplus score/local-fallback';
  },
};

export default RNFS;
