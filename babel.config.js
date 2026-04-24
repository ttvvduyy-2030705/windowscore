const isProduction =
  (process.env.BABEL_ENV || process.env.NODE_ENV || 'development') ===
  'production';

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        cwd: 'babelrc',
        root: ['./src'],
        extensions: [
          '.windows.tsx',
          '.windows.ts',
          '.windows.jsx',
          '.windows.js',
          '.native.tsx',
          '.native.ts',
          '.native.jsx',
          '.native.js',
          '.js',
          '.ts',
          '.tsx',
          '.json',
        ],
        alias: {
          '': './src',

          'react-native-fs': './src/platform/windows/react-native-fs',
          'react-native-device-info':
            './src/platform/windows/react-native-device-info',
          'react-native-vision-camera':
            './src/platform/windows/react-native-vision-camera',
          'react-native-video': './src/platform/windows/react-native-video',
          'react-native-video-trim':
            './src/platform/windows/react-native-video-trim',
          'react-native-tts': './src/platform/windows/react-native-tts',
          'react-native-sound-player':
            './src/platform/windows/react-native-sound-player',

          'react-native-image-picker':
            './src/platform/windows/react-native-image-picker',
          '@react-native-community/netinfo':
            './src/platform/windows/netinfo',
          'react-native-network-info':
            './src/platform/windows/react-native-network-info',
          '@react-native-google-signin/google-signin':
            './src/platform/windows/google-signin',
          'react-native-webrtc': './src/platform/windows/react-native-webrtc',
          'react-native-worklets-core':
            './src/platform/windows/react-native-worklets-core',

          realm: './src/platform/windows/realm',
          '@realm/react': './src/platform/windows/realm-react',
        },
      },
    ],
    ...(isProduction
      ? [
          [
            'transform-remove-console',
            {
              exclude: ['error', 'warn'],
            },
          ],
        ]
      : []),
    ['react-native-worklets-core/plugin'],
    ['react-native-reanimated/plugin'],
  ],
  sourceMaps: !isProduction,
};