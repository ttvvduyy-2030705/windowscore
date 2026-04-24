export const Worklets = {
  createRunOnJS: (fn: any) => fn,
  createRunInJsFn: (fn: any) => fn,
  createRunOnUI: (fn: any) => fn,
  defaultContext: {},
};

export const useSharedValue = (value: any) => ({value});

export default Worklets;
