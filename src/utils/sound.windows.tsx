const logSkippedSound = (name: string) => {
  console.log('[WindowsVideoCrashGuard]', {
    component: 'utils/sound.windows',
    reason: `${name} is not implemented on Windows; skipped safely`,
    preventedRedScreen: true,
  });
};

export function timeout() {
  logSkippedSound('timeout');
  return undefined;
}

export function beep() {
  logSkippedSound('beep');
  return undefined;
}

export function playSound() {
  return undefined;
}

export function playSoundFile() {
  return undefined;
}

export function stopSound() {
  return undefined;
}

export function speak(_utterance?: string) {
  return undefined;
}

export default {
  timeout,
  beep,
  playSound,
  playSoundFile,
  stopSound,
  speak,
};
