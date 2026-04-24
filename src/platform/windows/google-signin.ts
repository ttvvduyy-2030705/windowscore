export const statusCodes = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
};

export const GoogleSignin = {
  configure: () => {
    console.log('[Windows GoogleSignin] configure skipped');
  },

  hasPlayServices: async () => false,

  signIn: async () => {
    throw new Error('Google Sign-In native hiện chưa hỗ trợ trong bản Windows này.');
  },

  signOut: async () => undefined,

  revokeAccess: async () => undefined,

  isSignedIn: async () => false,

  getCurrentUser: () => null,

  getTokens: async () => ({
    idToken: null,
    accessToken: null,
  }),
};

export default {
  GoogleSignin,
  statusCodes,
};
