import React from 'react';

type ProviderProps = {
  children: React.ReactNode;
};

export function WindowsRealmProvider({children}: ProviderProps) {
  return <>{children}</>;
}

export const RealmProvider = WindowsRealmProvider;

export function useRealm() {
  return {
    write: (callback: any) => {
      if (typeof callback === 'function') {
        callback();
      }
    },
    create: () => ({}),
    objects: () => [],
    objectForPrimaryKey: () => null,
    delete: () => undefined,
  };
}

export function useQuery() {
  return [];
}

export function useObject() {
  return null;
}