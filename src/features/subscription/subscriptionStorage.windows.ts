export const readStoredAplusProEntitlement = async () => ({
  isActive: true,
  productId: 'aplus_pro',
  source: 'windows_full_access',
  lastCheckedAt: Date.now(),
  expiresAt: Date.now() + 3650 * 24 * 60 * 60 * 1000,
  reason: 'windows_full_access',
});

export const writeStoredAplusProEntitlement = async () => undefined;

export const clearStoredAplusProEntitlement = async () => undefined;

export const isStoredAplusProEntitlementInGrace = () => true;
