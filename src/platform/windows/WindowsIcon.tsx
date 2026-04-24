import React from 'react';
import {Text, TextStyle} from 'react-native';

type Props = {
  name?: string;
  size?: number;
  color?: string;
  style?: any;
};

const ICON_MAP: Record<string, string> = {
  edit: '✎',
  pencil: '✎',
  'pencil-alt': '✎',
  plus: '+',
  minus: '−',
  refresh: '↻',
  redo: '↻',
  undo: '↶',
  exchange: '↔',
  'exchange-alt': '↔',
  play: '▶',
  pause: 'Ⅱ',
  stop: '■',
  close: '×',
  times: '×',
  check: '✓',
  camera: '📷',
  video: '▣',
  flag: '⚑',
  search: '⌕',
  cog: '⚙',
  settings: '⚙',
  volume: '🔊',
  'volume-up': '🔊',
  speaker: '🔊',
  user: '●',
  users: '●',
  trophy: '★',
  star: '★',
  clock: '◷',
  timer: '◷',
  'chevron-left': '‹',
  'chevron-right': '›',
  left: '‹',
  right: '›',
};

const WindowsIcon = ({name = '', size = 16, color = '#FFFFFF', style}: Props) => {
  const label = ICON_MAP[name] || ICON_MAP[name.toLowerCase()] || '';

  return (
    <Text
      allowFontScaling={false}
      style={[
        {
          color,
          fontSize: size,
          lineHeight: Math.ceil(size * 1.15),
          fontWeight: '900',
          textAlign: 'center',
          includeFontPadding: false,
        } as TextStyle,
        style,
      ]}>
      {label}
    </Text>
  );
};

export default WindowsIcon;