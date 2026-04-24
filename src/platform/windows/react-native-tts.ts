const Tts = {
  speak: () => undefined,
  stop: async () => undefined,
  setDefaultLanguage: async () => undefined,
  setDefaultRate: async () => undefined,
  setDefaultPitch: async () => undefined,
  addEventListener: () => ({remove: () => undefined}),
  removeEventListener: () => undefined,
};

export default Tts;