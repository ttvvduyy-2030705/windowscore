const path = require('path');
const exclusionList = require('metro-config/src/defaults/exclusionList');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

function escapePathForRegex(filePath) {
  return filePath.replace(/[/\\]/g, '[/\\\\]').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const defaultConfig = getDefaultConfig(__dirname);

const windowsPath = path.resolve(__dirname, 'windows');
const rnwPath = path.dirname(require.resolve('react-native-windows/package.json'));

const config = {
  resolver: {
    blockList: exclusionList([
      new RegExp(`${escapePathForRegex(windowsPath)}[/\\\\].*`),

      new RegExp(`${escapePathForRegex(path.join(rnwPath, 'build'))}[/\\\\].*`),
      new RegExp(`${escapePathForRegex(path.join(rnwPath, 'target'))}[/\\\\].*`),

      /.*[/\\]node_modules[/\\]\.fmt[/\\].*/,
      /.*[/\\]node_modules[/\\]\.folly[/\\].*/,
      /.*[/\\]node_modules[/\\]\.node-api-jsi[/\\].*/,

      /.*\.zip$/,
      /.*\.ProjectImports\.zip$/,
    ]),

    sourceExts: [
      'windows.tsx',
      'windows.ts',
      'windows.jsx',
      'windows.js',
      'native.tsx',
      'native.ts',
      'native.jsx',
      'native.js',
      ...defaultConfig.resolver.sourceExts.filter(
        ext =>
          ![
            'windows.tsx',
            'windows.ts',
            'windows.jsx',
            'windows.js',
            'native.tsx',
            'native.ts',
            'native.jsx',
            'native.js',
          ].includes(ext),
      ),
    ],
  },
};

module.exports = mergeConfig(defaultConfig, config);