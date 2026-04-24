import {APLUS_PRO_DEFAULT_PLANS, APLUS_PRO_PRODUCT_ID} from './subscriptionProducts';

export type NativeAplusBillingPlan = any;

export type NativeAplusBillingEntitlement = {
  isAvailable?: boolean;
  isActive?: boolean;
  productId?: string;
  purchaseToken?: string;
  purchaseState?: string;
  isAcknowledged?: boolean;
  debugMessage?: string;
  errorCode?: string | number;
  plans?: NativeAplusBillingPlan[];
};

const activeEntitlement: NativeAplusBillingEntitlement = {
  isAvailable: true,
  isActive: true,
  productId: APLUS_PRO_PRODUCT_ID,
  purchaseToken: 'windows-full-access',
  purchaseState: 'PURCHASED',
  isAcknowledged: true,
  debugMessage: 'Windows full-access build: billing disabled.',
};

export const normalizeAplusProPlans = () => APLUS_PRO_DEFAULT_PLANS;

export const isGooglePlayBillingAvailable = () => false;

export const initializeAplusBilling = async () => ({
  ...activeEntitlement,
  plans: Object.values(APLUS_PRO_DEFAULT_PLANS),
});

export const queryAplusProProducts = async () => ({
  ...activeEntitlement,
  plans: Object.values(APLUS_PRO_DEFAULT_PLANS),
});

export const purchaseAplusProPlan = async () => activeEntitlement;

export const restoreAplusProPurchases = async () => activeEntitlement;
