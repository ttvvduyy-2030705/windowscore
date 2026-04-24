import React from 'react';
import {APLUS_PRO_DEFAULT_PLANS} from './subscriptionProducts';

export const WINDOWS_SUBSCRIPTION_VALUE = {
  isAplusProActive: true,
  isLoadingSubscription: false,
  isPaywallVisible: false,
  paywallReason: undefined,
  billingError: undefined,
  plans: APLUS_PRO_DEFAULT_PLANS,
  deviceLock: {
    visible: false,
    currentDeviceLabel: undefined,
    message: undefined,
    errorMessage: undefined,
  },

  showPaywall: () => {
    console.log('[Windows Subscription] showPaywall skipped');
  },

  hidePaywall: () => undefined,

  hideDeviceLock: () => undefined,

  requireAplusPro: (_reason: any, callback: any) => {
    if (typeof callback === 'function') {
      return callback();
    }

    return undefined;
  },

  purchaseMonthly: async () => undefined,

  purchaseYearly: async () => undefined,

  startTrialOrPurchaseTrialOffer: async () => undefined,

  restorePurchases: async () => undefined,

  transferAplusProToThisDevice: async () => undefined,
};

export const SubscriptionContext = React.createContext<any>(
  WINDOWS_SUBSCRIPTION_VALUE,
);

export const useAplusPro = () => {
  const context = React.useContext(SubscriptionContext);

  return context || WINDOWS_SUBSCRIPTION_VALUE;
};

export const useSubscription = useAplusPro;
