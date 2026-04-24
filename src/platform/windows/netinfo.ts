const state = {
  type: 'wifi',
  isConnected: true,
  isInternetReachable: true,
  details: {
    ipAddress: '127.0.0.1',
    subnet: '255.255.255.0',
  },
};

export const fetch = async () => state;

export const addEventListener = (listener: (state: any) => void) => {
  setTimeout(() => listener(state), 0);
  return () => undefined;
};

export const refresh = async () => state;

export const useNetInfo = () => state;

export default {
  fetch,
  addEventListener,
  refresh,
  useNetInfo,
};
