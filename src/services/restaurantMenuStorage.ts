import AsyncStorage from '@react-native-async-storage/async-storage';

export const RESTAURANT_STORAGE_KEYS = {
  schemaVersion: 'restaurant_menu_schema_version',
  categories: 'menu_categories',
  menuItems: 'menu_items',
  orders: 'restaurant_orders',
  currentCart: 'current_cart',
  adminAccounts: 'admin_accounts',
  legacyAdminAccounts: 'restaurant_admin_accounts',
};

const CURRENT_SCHEMA_VERSION = '20260424_menu_drinks_food_v1';

export type MenuCategory = {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
};

export type RestaurantMenuItem = {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  description: string;
  imageUri?: string;
  available: boolean;
  createdAt: string;
  updatedAt: string;
  /** Legacy field from the first local menu version. Kept only for safe migration. */
  category?: string;
};

export type RestaurantCartItem = {
  itemId: string;
  quantity: number;
};

export type RestaurantCartState = {
  tableNumber: string;
  note: string;
  items: RestaurantCartItem[];
};

export type RestaurantOrderStatus =
  | 'new'
  | 'preparing'
  | 'served'
  | 'paid'
  | 'cancelled';

export type RestaurantOrderItem = {
  itemId: string;
  name: string;
  price: number;
  quantity: number;
  note?: string;
};

export type RestaurantOrder = {
  id: string;
  tableNumber: string;
  items: RestaurantOrderItem[];
  note: string;
  total: number;
  status: RestaurantOrderStatus;
  createdAt: string;
  updatedAt: string;
};

export type RestaurantAdminAccount = {
  username: string;
  password: string;
  createdAt: string;
};

const nowIso = () => new Date().toISOString();

const createId = (prefix: string) => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const sampleTime = nowIso();

export const DEFAULT_DRINK_CATEGORY_ID = 'drink';
export const DEFAULT_FOOD_CATEGORY_ID = 'food';

export const DEFAULT_MENU_CATEGORIES: MenuCategory[] = [
  {
    id: DEFAULT_DRINK_CATEGORY_ID,
    name: 'Đồ uống',
    createdAt: sampleTime,
    updatedAt: sampleTime,
  },
  {
    id: DEFAULT_FOOD_CATEGORY_ID,
    name: 'Đồ ăn',
    createdAt: sampleTime,
    updatedAt: sampleTime,
  },
];

export const defaultMenuItems: RestaurantMenuItem[] = [
  {
    id: 'sample_coca',
    categoryId: DEFAULT_DRINK_CATEGORY_ID,
    name: 'Coca',
    price: 25000,
    description: 'Coca-Cola lạnh, phục vụ nhanh tại bàn.',
    imageUri:
      'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=900&q=80',
    available: true,
    createdAt: sampleTime,
    updatedAt: sampleTime,
  },
  {
    id: 'sample_fanta',
    categoryId: DEFAULT_DRINK_CATEGORY_ID,
    name: 'Fanta',
    price: 25000,
    description: 'Nước cam có gas, vị ngọt mát, uống lạnh ngon hơn.',
    imageUri:
      'https://images.unsplash.com/photo-1624517452488-04869289c4ca?auto=format&fit=crop&w=900&q=80',
    available: true,
    createdAt: sampleTime,
    updatedAt: sampleTime,
  },
  {
    id: 'sample_mirinda',
    categoryId: DEFAULT_DRINK_CATEGORY_ID,
    name: 'Mirinda',
    price: 25000,
    description: 'Mirinda lạnh, hợp dùng khi chơi hoặc nghỉ giữa trận.',
    imageUri:
      'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=900&q=80',
    available: true,
    createdAt: sampleTime,
    updatedAt: sampleTime,
  },
  {
    id: 'sample_pepsi',
    categoryId: DEFAULT_DRINK_CATEGORY_ID,
    name: 'Pepsi',
    price: 25000,
    description: 'Pepsi lạnh, vị ga mạnh, phục vụ nhanh cho bàn chơi.',
    imageUri:
      'https://images.unsplash.com/photo-1629203851122-3726ecdf080e?auto=format&fit=crop&w=900&q=80',
    available: true,
    createdAt: sampleTime,
    updatedAt: sampleTime,
  },
];

const legacySeedCategoryIds = [
  'hotpot',
  'meat',
  'seafood',
  'vegetable',
  'snack',
  'combo',
  'other',
];

const legacySeedItemIds = [
  'sample_hotpot_combo',
  'sample_beef_plate',
  'sample_seafood_plate',
  'sample_mushroom_set',
  'sample_snack_combo',
  'sample_iced_tea',
];

const normalise = (value?: string) => {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

const safeJsonParse = <T>(value: string | null, fallback: T) => {
  if (!value) {
    return {value: fallback, ok: true};
  }

  try {
    return {value: JSON.parse(value) as T, ok: true};
  } catch (error) {
    console.warn('[RestaurantMenuStorage] invalid JSON, reset safe fallback', error);
    return {value: fallback, ok: false};
  }
};

const readArray = async <T>(key: string): Promise<T[]> => {
  const raw = await AsyncStorage.getItem(key);
  const parsed = safeJsonParse<T[]>(raw, []);

  if (!parsed.ok) {
    await AsyncStorage.removeItem(key);
  }

  return Array.isArray(parsed.value) ? parsed.value : [];
};

const writeArray = async <T>(key: string, value: T[]) => {
  await AsyncStorage.setItem(key, JSON.stringify(value));
};

const seedDefaultMenu = async () => {
  await writeArray(RESTAURANT_STORAGE_KEYS.categories, DEFAULT_MENU_CATEGORIES);
  await writeArray(RESTAURANT_STORAGE_KEYS.menuItems, defaultMenuItems);
  await AsyncStorage.setItem(
    RESTAURANT_STORAGE_KEYS.schemaVersion,
    CURRENT_SCHEMA_VERSION,
  );
};

const ensureSchema = async () => {
  const version = await AsyncStorage.getItem(RESTAURANT_STORAGE_KEYS.schemaVersion);
  const [storedCategories, storedItems] = await Promise.all([
    readArray<MenuCategory>(RESTAURANT_STORAGE_KEYS.categories),
    readArray<RestaurantMenuItem>(RESTAURANT_STORAGE_KEYS.menuItems),
  ]);

  const hasLegacySeedCategory = storedCategories.some(category =>
    legacySeedCategoryIds.includes(String(category.id)),
  );
  const hasLegacySeedItem = storedItems.some(item =>
    legacySeedItemIds.includes(String(item.id)),
  );

  if (version !== CURRENT_SCHEMA_VERSION) {
    if (storedCategories.length === 0 || hasLegacySeedCategory || hasLegacySeedItem) {
      await seedDefaultMenu();
      return;
    }

    const nextCategories = ensureDefaultCategories(storedCategories.map(cleanCategory));
    await writeArray(RESTAURANT_STORAGE_KEYS.categories, nextCategories);
    await writeArray(
      RESTAURANT_STORAGE_KEYS.menuItems,
      storedItems.map(item => migrateMenuItem(item, nextCategories)),
    );
    await AsyncStorage.setItem(
      RESTAURANT_STORAGE_KEYS.schemaVersion,
      CURRENT_SCHEMA_VERSION,
    );
  }
};

const cleanCategory = (category: Partial<MenuCategory>): MenuCategory => {
  const timestamp = nowIso();
  const cleanName = (category.name || '').trim() || 'Đồ uống';

  return {
    id: category.id || createId('cat'),
    name: cleanName,
    createdAt: category.createdAt || timestamp,
    updatedAt: category.updatedAt || timestamp,
  };
};

const ensureDefaultCategories = (categories: MenuCategory[]) => {
  const cleaned = categories.map(cleanCategory);
  const withoutDuplicateNames = cleaned.filter(
    (category, index, source) =>
      source.findIndex(item => normalise(item.name) === normalise(category.name)) === index,
  );

  const hasDrink = withoutDuplicateNames.some(
    category =>
      category.id === DEFAULT_DRINK_CATEGORY_ID ||
      normalise(category.name) === normalise('Đồ uống'),
  );
  const hasFood = withoutDuplicateNames.some(
    category =>
      category.id === DEFAULT_FOOD_CATEGORY_ID ||
      normalise(category.name) === normalise('Đồ ăn'),
  );

  const nextCategories = [...withoutDuplicateNames];

  if (!hasDrink) {
    nextCategories.unshift(DEFAULT_MENU_CATEGORIES[0]);
  }

  if (!hasFood) {
    nextCategories.push(DEFAULT_MENU_CATEGORIES[1]);
  }

  return nextCategories.length > 0 ? nextCategories : DEFAULT_MENU_CATEGORIES;
};

const resolveCategoryId = (value: string | undefined, categories: MenuCategory[]) => {
  const raw = normalise(value);
  const drinkCategory =
    categories.find(category => category.id === DEFAULT_DRINK_CATEGORY_ID) ||
    categories.find(category => normalise(category.name) === normalise('Đồ uống')) ||
    categories[0];
  const foodCategory =
    categories.find(category => category.id === DEFAULT_FOOD_CATEGORY_ID) ||
    categories.find(category => normalise(category.name) === normalise('Đồ ăn')) ||
    drinkCategory;

  if (!raw) {
    return drinkCategory?.id || DEFAULT_DRINK_CATEGORY_ID;
  }

  const byId = categories.find(category => normalise(category.id) === raw);
  if (byId) {
    return byId.id;
  }

  const byName = categories.find(category => normalise(category.name) === raw);
  if (byName) {
    return byName.id;
  }

  if (
    raw.includes('uong') ||
    raw.includes('drink') ||
    raw.includes('coca') ||
    raw.includes('pepsi') ||
    raw.includes('fanta') ||
    raw.includes('mirinda') ||
    raw.includes('tra') ||
    raw.includes('nuoc')
  ) {
    return drinkCategory?.id || DEFAULT_DRINK_CATEGORY_ID;
  }

  return foodCategory?.id || drinkCategory?.id || DEFAULT_FOOD_CATEGORY_ID;
};

const migrateMenuItem = (
  item: Partial<RestaurantMenuItem>,
  categories: MenuCategory[],
): RestaurantMenuItem => {
  const timestamp = nowIso();
  const categoryId = resolveCategoryId(item.categoryId || item.category, categories);

  return {
    id: item.id || createId('dish'),
    categoryId,
    name: (item.name || 'Món chưa đặt tên').trim(),
    price: Number(item.price) || 0,
    description: item.description || '',
    imageUri: item.imageUri || '',
    available: item.available !== false,
    createdAt: item.createdAt || timestamp,
    updatedAt: item.updatedAt || timestamp,
  };
};

export const getDefaultMenuItems = () => defaultMenuItems;

/**
 * Synchronous fallback kept for old code paths only. New UI loads categories
 * from AsyncStorage through loadMenuCategories so admin can manage them locally.
 */
export const getMenuCategories = () => DEFAULT_MENU_CATEGORIES;

export const loadMenuCategories = async (): Promise<MenuCategory[]> => {
  await ensureSchema();
  const stored = await readArray<MenuCategory>(RESTAURANT_STORAGE_KEYS.categories);

  if (stored.length === 0) {
    await seedDefaultMenu();
    return DEFAULT_MENU_CATEGORIES;
  }

  const migrated = ensureDefaultCategories(stored.map(cleanCategory));

  if (JSON.stringify(stored) !== JSON.stringify(migrated)) {
    await writeArray(RESTAURANT_STORAGE_KEYS.categories, migrated);
  }

  return migrated;
};

export const saveMenuCategories = async (categories: MenuCategory[]) => {
  const cleaned = ensureDefaultCategories(categories.map(cleanCategory));
  await writeArray(RESTAURANT_STORAGE_KEYS.categories, cleaned);
  await AsyncStorage.setItem(
    RESTAURANT_STORAGE_KEYS.schemaVersion,
    CURRENT_SCHEMA_VERSION,
  );
  return cleaned;
};

export const upsertMenuCategory = async (
  input: Partial<MenuCategory> & {name: string},
): Promise<{ok: boolean; message: string; categories: MenuCategory[]}> => {
  const cleanName = input.name.trim();

  if (!cleanName) {
    return {
      ok: false,
      message: 'Vui lòng nhập tên danh mục',
      categories: await loadMenuCategories(),
    };
  }

  const current = await loadMenuCategories();
  const existedName = current.some(
    category =>
      category.id !== input.id && normalise(category.name) === normalise(cleanName),
  );

  if (existedName) {
    return {ok: false, message: 'Danh mục này đã tồn tại', categories: current};
  }

  const timestamp = nowIso();
  const nextCategory: MenuCategory = {
    id: input.id || createId('cat'),
    name: cleanName,
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp,
  };

  const nextCategories = input.id
    ? current.map(category => (category.id === input.id ? nextCategory : category))
    : [...current, nextCategory];

  const categories = await saveMenuCategories(nextCategories);

  return {
    ok: true,
    message: input.id ? 'Đã cập nhật danh mục' : 'Đã thêm danh mục mới',
    categories,
  };
};

export const deleteMenuCategory = async (
  categoryId: string,
): Promise<{ok: boolean; message: string; categories: MenuCategory[]}> => {
  const [categories, items] = await Promise.all([loadMenuCategories(), loadMenuItems()]);
  const used = items.some(item => item.categoryId === categoryId);

  if (used) {
    return {
      ok: false,
      message: 'Không thể xoá danh mục đang có món. Hãy chuyển/xoá món trước.',
      categories,
    };
  }

  if (categories.length <= 1) {
    return {
      ok: false,
      message: 'Menu cần ít nhất 1 danh mục.',
      categories,
    };
  }

  const nextCategories = categories.filter(category => category.id !== categoryId);
  const savedCategories = await saveMenuCategories(nextCategories);

  return {ok: true, message: 'Đã xoá danh mục', categories: savedCategories};
};

export const getCategoryNameById = (
  categoryId: string,
  categories: MenuCategory[] = DEFAULT_MENU_CATEGORIES,
) => {
  return categories.find(category => category.id === categoryId)?.name || 'Đồ uống';
};

export const loadMenuItems = async (): Promise<RestaurantMenuItem[]> => {
  await ensureSchema();
  const categories = await loadMenuCategories();
  const stored = await readArray<RestaurantMenuItem>(
    RESTAURANT_STORAGE_KEYS.menuItems,
  );

  if (stored.length === 0) {
    const seededItems = defaultMenuItems.map(item => migrateMenuItem(item, categories));
    await writeArray(RESTAURANT_STORAGE_KEYS.menuItems, seededItems);
    return seededItems;
  }

  const hasLegacySeedItem = stored.some(item => legacySeedItemIds.includes(String(item.id)));
  if (hasLegacySeedItem) {
    const seededItems = defaultMenuItems.map(item => migrateMenuItem(item, categories));
    await writeArray(RESTAURANT_STORAGE_KEYS.menuItems, seededItems);
    return seededItems;
  }

  const migrated = stored.map(item => migrateMenuItem(item, categories));
  const needsMigration = JSON.stringify(stored) !== JSON.stringify(migrated);

  if (needsMigration) {
    await writeArray(RESTAURANT_STORAGE_KEYS.menuItems, migrated);
  }

  return migrated;
};

export const saveMenuItems = async (items: RestaurantMenuItem[]) => {
  const categories = await loadMenuCategories();
  await writeArray(
    RESTAURANT_STORAGE_KEYS.menuItems,
    items.map(item => migrateMenuItem(item, categories)),
  );
};

export const upsertMenuItem = async (
  input: Omit<RestaurantMenuItem, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string;
    createdAt?: string;
  },
): Promise<RestaurantMenuItem[]> => {
  const [current, categories] = await Promise.all([loadMenuItems(), loadMenuCategories()]);
  const timestamp = nowIso();
  const nextItem: RestaurantMenuItem = {
    id: input.id || createId('dish'),
    categoryId: resolveCategoryId(input.categoryId, categories),
    name: input.name.trim(),
    price: Number(input.price) || 0,
    description: input.description.trim(),
    imageUri: input.imageUri?.trim(),
    available: input.available,
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp,
  };

  const existingIndex = current.findIndex(item => item.id === nextItem.id);
  const nextItems =
    existingIndex >= 0
      ? current.map(item => (item.id === nextItem.id ? nextItem : item))
      : [nextItem, ...current];

  await saveMenuItems(nextItems);
  return nextItems;
};

export const deleteMenuItem = async (itemId: string) => {
  const current = await loadMenuItems();
  const nextItems = current.filter(item => item.id !== itemId);
  await saveMenuItems(nextItems);
  return nextItems;
};

export const loadOrders = async (): Promise<RestaurantOrder[]> => {
  const orders = await readArray<RestaurantOrder>(RESTAURANT_STORAGE_KEYS.orders);
  return orders.map(order => ({
    ...order,
    items: Array.isArray(order.items) ? order.items : [],
    total: Number(order.total) || 0,
    status: order.status || 'new',
  }));
};

export const saveOrders = async (orders: RestaurantOrder[]) => {
  await writeArray(RESTAURANT_STORAGE_KEYS.orders, orders);
};

export const createRestaurantOrder = async (
  payload: Omit<RestaurantOrder, 'id' | 'status' | 'createdAt' | 'updatedAt'>,
): Promise<RestaurantOrder[]> => {
  const current = await loadOrders();
  const timestamp = nowIso();
  const order: RestaurantOrder = {
    ...payload,
    id: createId('order'),
    status: 'new',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const nextOrders = [order, ...current];
  await saveOrders(nextOrders);
  return nextOrders;
};

export const updateRestaurantOrderStatus = async (
  orderId: string,
  status: RestaurantOrderStatus,
): Promise<RestaurantOrder[]> => {
  const current = await loadOrders();
  const timestamp = nowIso();
  const nextOrders = current.map(order =>
    order.id === orderId ? {...order, status, updatedAt: timestamp} : order,
  );
  await saveOrders(nextOrders);
  return nextOrders;
};

export const loadCurrentCart = async (): Promise<RestaurantCartState> => {
  const value = await AsyncStorage.getItem(RESTAURANT_STORAGE_KEYS.currentCart);
  const parsed = safeJsonParse<RestaurantCartState>(value, {
    tableNumber: '',
    note: '',
    items: [],
  });

  if (!parsed.ok) {
    await AsyncStorage.removeItem(RESTAURANT_STORAGE_KEYS.currentCart);
  }

  const items = Array.isArray(parsed.value.items)
    ? parsed.value.items
        .map(item => ({
          itemId: String(item.itemId || ''),
          quantity: Math.max(0, Number(item.quantity) || 0),
        }))
        .filter(item => item.itemId && item.quantity > 0)
    : [];

  return {
    tableNumber: parsed.value.tableNumber || '',
    note: parsed.value.note || '',
    items,
  };
};

export const saveCurrentCart = async (cart: RestaurantCartState) => {
  await AsyncStorage.setItem(
    RESTAURANT_STORAGE_KEYS.currentCart,
    JSON.stringify({
      tableNumber: cart.tableNumber || '',
      note: cart.note || '',
      items: Array.isArray(cart.items) ? cart.items : [],
    }),
  );
};

export const clearCurrentCart = async () => {
  await AsyncStorage.removeItem(RESTAURANT_STORAGE_KEYS.currentCart);
};

const loadAdminAccounts = async (): Promise<RestaurantAdminAccount[]> => {
  const current = await readArray<RestaurantAdminAccount>(
    RESTAURANT_STORAGE_KEYS.adminAccounts,
  );

  if (current.length > 0) {
    return current;
  }

  const legacy = await readArray<RestaurantAdminAccount>(
    RESTAURANT_STORAGE_KEYS.legacyAdminAccounts,
  );

  if (legacy.length > 0) {
    await writeArray(RESTAURANT_STORAGE_KEYS.adminAccounts, legacy);
  }

  return legacy;
};

export const registerRestaurantAdmin = async (
  username: string,
  password: string,
): Promise<{ok: boolean; message: string}> => {
  const cleanUsername = username.trim();
  const cleanPassword = password.trim();

  if (!cleanUsername || !cleanPassword) {
    return {ok: false, message: 'Vui lòng nhập tên tài khoản và mật khẩu'};
  }

  const accounts = await loadAdminAccounts();
  const existed = accounts.some(
    account => normalise(account.username) === normalise(cleanUsername),
  );

  if (existed) {
    return {ok: false, message: 'Tài khoản admin đã tồn tại'};
  }

  // DEMO LOCAL ONLY: password is stored in AsyncStorage for the first offline version.
  // Replace this with backend auth + hashed password/session before production restaurant deployment.
  const nextAccounts = [
    ...accounts,
    {username: cleanUsername, password: cleanPassword, createdAt: nowIso()},
  ];
  await writeArray(RESTAURANT_STORAGE_KEYS.adminAccounts, nextAccounts);

  return {ok: true, message: 'Đăng ký admin local thành công'};
};

export const verifyRestaurantAdmin = async (
  username: string,
  password: string,
): Promise<{ok: boolean; message: string}> => {
  const cleanUsername = username.trim();
  const cleanPassword = password.trim();

  if (!cleanUsername || !cleanPassword) {
    return {ok: false, message: 'Vui lòng nhập tên tài khoản và mật khẩu'};
  }

  const accounts = await loadAdminAccounts();
  const matched = accounts.some(
    account =>
      normalise(account.username) === normalise(cleanUsername) &&
      account.password === cleanPassword,
  );

  if (!matched) {
    return {ok: false, message: 'Tên tài khoản hoặc mật khẩu chưa đúng'};
  }

  return {ok: true, message: 'Đăng nhập admin thành công'};
};
