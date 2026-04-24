import React, {ReactNode} from 'react';
import {
  SubscriptionContext,
  WINDOWS_SUBSCRIPTION_VALUE,
} from './useSubscription';

type Props = {
  children: ReactNode;
};

export const SubscriptionProvider = ({children}: Props) => {
  return (
    <SubscriptionContext.Provider value={WINDOWS_SUBSCRIPTION_VALUE}>
      {children}
    </SubscriptionContext.Provider>
  );
};

export default SubscriptionProvider;
