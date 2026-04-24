export type AplusProBackendEntitlement = {
  isAplusProActive?: boolean;
  boundToThisDevice?: boolean;
  requireDeviceTransfer?: boolean;
  reason?: string;
  message?: string;
  currentDeviceLabel?: string;
  expiryTime?: number;
};

const entitlement: AplusProBackendEntitlement = {
  isAplusProActive: true,
  boundToThisDevice: true,
  reason: 'windows_full_access',
  message: 'Windows full-access build.',
  expiryTime: Date.now() + 3650 * 24 * 60 * 60 * 1000,
};

export const verifyAplusProPurchaseWithBackend = async () => entitlement;

export const transferAplusProDeviceWithBackend = async () => entitlement;
