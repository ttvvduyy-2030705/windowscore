type ReadDirItem = {
  ctime?: Date;
  mtime?: Date;
  name: string;
  path: string;
  size: number;
  isFile: () => boolean;
  isDirectory: () => boolean;
};

const memoryFiles = new Map<string, string>();
const memoryDirs = new Set<string>();

const ROOT = 'C:/AplusScoreWindows';

const makeDirItem = (path: string, isDirectory = false): ReadDirItem => {
  const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
  return {
    ctime: new Date(),
    mtime: new Date(),
    name,
    path,
    size: memoryFiles.get(path)?.length || 0,
    isFile: () => !isDirectory,
    isDirectory: () => isDirectory,
  };
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
    return memoryFiles.has(path) || memoryDirs.has(path);
  },

  mkdir: async (path: string) => {
    memoryDirs.add(path);
    return undefined;
  },

  readDir: async (path: string) => {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const items: ReadDirItem[] = [];

    for (const dir of memoryDirs) {
      if (dir.startsWith(prefix) && dir !== path) {
        items.push(makeDirItem(dir, true));
      }
    }

    for (const file of memoryFiles.keys()) {
      if (file.startsWith(prefix)) {
        items.push(makeDirItem(file, false));
      }
    }

    return items;
  },

  stat: async (path: string) => {
    const content = memoryFiles.get(path) || '';
    return {
      path,
      size: content.length,
      ctime: new Date(),
      mtime: new Date(),
      isFile: () => memoryFiles.has(path),
      isDirectory: () => memoryDirs.has(path),
    };
  },

  readFile: async (path: string) => {
    return memoryFiles.get(path) || '';
  },

  writeFile: async (path: string, content: string) => {
    memoryFiles.set(path, content || '');
    return undefined;
  },

  appendFile: async (path: string, content: string) => {
    memoryFiles.set(path, `${memoryFiles.get(path) || ''}${content || ''}`);
    return undefined;
  },

  unlink: async (path: string) => {
    memoryFiles.delete(path);
    memoryDirs.delete(path);
    return undefined;
  },

  copyFile: async (from: string, to: string) => {
    memoryFiles.set(to, memoryFiles.get(from) || '');
    return undefined;
  },

  moveFile: async (from: string, to: string) => {
    memoryFiles.set(to, memoryFiles.get(from) || '');
    memoryFiles.delete(from);
    return undefined;
  },

  scanFile: async () => {
    return undefined;
  },
};

export default RNFS;
export type {ReadDirItem};