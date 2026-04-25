import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View as RNView,
} from 'react-native';
import type {ImageSourcePropType} from 'react-native';
import {launchImageLibrary} from 'react-native-image-picker';

import images from 'assets';
import Image from 'components/Image';
import View from 'components/View';
import useScreenSystemUI, {configureSystemUI} from 'theme/systemUI';
import useDesignSystem from 'theme/useDesignSystem';
import {Navigation} from 'types/navigation';

import {
  clearCurrentCart,
  createRestaurantOrder,
  deleteMenuCategory,
  deleteMenuItem,
  getCategoryNameById,
  loadCurrentCart,
  loadMenuCategories,
  loadMenuItems,
  loadOrders,
  registerRestaurantAdmin,
  saveCurrentCart,
  updateRestaurantOrderStatus,
  upsertMenuCategory,
  upsertMenuItem,
  verifyRestaurantAdmin,
} from 'services/restaurantMenuStorage';

import type {
  MenuCategory,
  RestaurantCartItem,
  RestaurantCartState,
  RestaurantMenuItem,
  RestaurantOrder,
  RestaurantOrderStatus,
} from 'services/restaurantMenuStorage';

import createStyles from './styles';

type Props = Navigation;

type ScreenMode = 'customer' | 'adminLogin' | 'adminRegister' | 'admin';
type AdminTab = 'categories' | 'menu' | 'orders';

type DishFormState = {
  id?: string;
  createdAt?: string;
  name: string;
  price: string;
  description: string;
  imageUri: string;
  categoryId: string;
  available: boolean;
};

type CategoryFormState = {
  id?: string;
  createdAt?: string;
  name: string;
};

const statusLabels: Record<RestaurantOrderStatus, string> = {
  new: 'Mới',
  preparing: 'Đang chuẩn bị',
  served: 'Đã lên món',
  paid: 'Đã thanh toán',
  cancelled: 'Huỷ',
};

const statusColors: Record<RestaurantOrderStatus, string> = {
  new: '#D92027',
  preparing: '#F2A51A',
  served: '#2B8CFF',
  paid: '#09A86B',
  cancelled: '#6F717A',
};

const statusFlow: RestaurantOrderStatus[] = [
  'new',
  'preparing',
  'served',
  'paid',
  'cancelled',
];

const createEmptyForm = (categoryId = ''): DishFormState => ({
  name: '',
  price: '',
  description: '',
  imageUri: '',
  categoryId,
  available: true,
});

const createEmptyCategoryForm = (): CategoryFormState => ({name: ''});

const formatCurrency = (value: number) => {
  return `${Math.max(0, value || 0).toLocaleString('vi-VN')}đ`;
};

const formatDateTime = (iso: string) => {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const normalisePriceInput = (value: string) => value.replace(/[^0-9]/g, '');

const createEmptyCart = (): RestaurantCartState => ({
  tableNumber: '',
  note: '',
  items: [],
});

const hasCartContent = (cartState: RestaurantCartState) => {
  return (
    (Array.isArray(cartState.items) ? cartState.items.length : 0) > 0 ||
    String(cartState.tableNumber || '').trim().length > 0 ||
    String(cartState.note || '').trim().length > 0
  );
};

// Keep cart/modal state outside the component so a native Modal focus/remount
// cannot reset the overlay to false or flicker the cart back to an empty state.
let cartVisibleSession = false;
let cartSession: RestaurantCartState = createEmptyCart();
let hasCartSession = false;
let cartMutationVersion = 0;
let cartHydrateRequestId = 0;

const getMenuImageSource = (item: RestaurantMenuItem): ImageSourcePropType => {
  if (item.imageUri && item.imageUri.trim().length > 0) {
    return {uri: item.imageUri.trim()};
  }

  return images.logoSmall;
};

const RestaurantMenuScreen = (props: Props) => {
  useScreenSystemUI({variant: 'fullscreen', barStyle: 'light-content'});

  const {adaptive, design} = useDesignSystem();
  const styles = useMemo(
    () => createStyles(design, {width: adaptive.width, height: adaptive.height}),
    [adaptive.height, adaptive.width, design],
  );

  const [mode, setMode] = useState<ScreenMode>('customer');
  const [adminTab, setAdminTab] = useState<AdminTab>('orders');
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<RestaurantMenuItem[]>([]);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [cart, setCartState] = useState<RestaurantCartState>(() =>
    hasCartSession ? cartSession : createEmptyCart(),
  );
  const [cartHydrated, setCartHydrated] = useState(hasCartSession);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [cartModalVisible, setCartModalVisibleState] = useState(
    () => cartVisibleSession,
  );
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [registerUsername, setRegisterUsername] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
  const [form, setForm] = useState<DishFormState>(createEmptyForm());
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(
    createEmptyCategoryForm(),
  );
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [tableError, setTableError] = useState('');
  const [cartError, setCartError] = useState('');
  const cartOpenStartedAtRef = useRef(0);

  const showMessage = useCallback((text: string) => {
    setMessage(text);
    setErrorMessage('');
  }, []);

  const showError = useCallback((text: string) => {
    setErrorMessage(text);
    setMessage('');
  }, []);

  const setCart = useCallback((next: React.SetStateAction<RestaurantCartState>) => {
    setCartHydrated(true);
    setCartState(current => {
      const resolved =
        typeof next === 'function'
          ? (next as (previous: RestaurantCartState) => RestaurantCartState)(current)
          : next;

      cartSession = resolved;
      hasCartSession = true;
      cartMutationVersion += 1;
      return resolved;
    });
  }, []);

  const hydrateCartFromStorage = useCallback(
    (nextCart: RestaurantCartState, startedAtVersion: number) => {
      setCartState(current => {
        const mutationHappenedDuringLoad = cartMutationVersion !== startedAtVersion;
        const currentHasCart = hasCartContent(current);
        const loadedHasCart = hasCartContent(nextCart);

        if (mutationHappenedDuringLoad && currentHasCart && !loadedHasCart) {
          console.log(
            '[CartOverlay] skipped stale empty cart hydration because cart changed during load',
          );
          hasCartSession = true;
          cartSession = current;
          return current;
        }

        if (hasCartSession && currentHasCart && !loadedHasCart) {
          console.log(
            '[CartOverlay] skipped empty storage cart because in-memory cart is newer',
          );
          cartSession = current;
          return current;
        }

        hasCartSession = true;
        cartSession = nextCart;
        return nextCart;
      });
      setCartHydrated(true);
    },
    [],
  );

  const setCartModalVisible = useCallback((visible: boolean) => {
    cartVisibleSession = visible;
    setCartModalVisibleState(visible);
  }, []);

  const refreshData = useCallback(async () => {
    const requestId = cartHydrateRequestId + 1;
    const startedAtVersion = cartMutationVersion;
    cartHydrateRequestId = requestId;

    const [nextCategories, nextItems, nextOrders, nextCart] = await Promise.all([
      loadMenuCategories(),
      loadMenuItems(),
      loadOrders(),
      loadCurrentCart(),
    ]);

    if (requestId !== cartHydrateRequestId) {
      console.log('[CartOverlay] ignored stale menu/cart hydration request');
      return;
    }

    setCategories(nextCategories);
    setItems(nextItems);
    setOrders(nextOrders);
    hydrateCartFromStorage(nextCart, startedAtVersion);

    const firstCategoryId = nextCategories[0]?.id || '';
    setSelectedCategoryId(current => {
      if (current && nextCategories.some(category => category.id === current)) {
        return current;
      }
      return firstCategoryId;
    });
    setForm(current => ({
      ...current,
      categoryId: nextCategories.some(category => category.id === current.categoryId)
        ? current.categoryId
        : firstCategoryId,
    }));
  }, [hydrateCartFromStorage]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!cartHydrated) {
      return;
    }

    void saveCurrentCart(cart);
  }, [cart, cartHydrated]);

  const selectedCategory = useMemo<MenuCategory | undefined>(() => {
    return categories.find(category => category.id === selectedCategoryId) || categories[0];
  }, [categories, selectedCategoryId]);

  const categoryCounts = useMemo(() => {
    return items.reduce<Record<string, number>>((result, item) => {
      result[item.categoryId] = (result[item.categoryId] || 0) + 1;
      return result;
    }, {});
  }, [items]);

  const visibleItems = useMemo(() => {
    return items.filter(
      item => item.available && item.categoryId === selectedCategory?.id,
    );
  }, [items, selectedCategory?.id]);

  const cartItemMap = useMemo(() => {
    return cart.items.reduce<Record<string, RestaurantCartItem>>((result, item) => {
      result[item.itemId] = item;
      return result;
    }, {});
  }, [cart.items]);

  const cartRows = useMemo(() => {
    return cart.items
      .map(cartItem => {
        const menuItem = items.find(item => item.id === cartItem.itemId);

        if (!menuItem || cartItem.quantity <= 0) {
          return null;
        }

        return {
          ...cartItem,
          item: menuItem,
          lineTotal: menuItem.price * cartItem.quantity,
        };
      })
      .filter(Boolean) as Array<{
      itemId: string;
      quantity: number;
      item: RestaurantMenuItem;
      lineTotal: number;
    }>;
  }, [cart.items, items]);

  const cartTotal = useMemo(
    () => cartRows.reduce((total, row) => total + row.lineTotal, 0),
    [cartRows],
  );

  const cartBadgeCount = cartRows.length;

  const resetForm = useCallback(() => {
    setForm(createEmptyForm(categories[0]?.id || ''));
  }, [categories]);

  const resetCategoryForm = useCallback(() => {
    setCategoryForm(createEmptyCategoryForm());
  }, []);

  const openLogin = useCallback(() => {
    setMode('adminLogin');
    setAdminPassword('');
    setMessage('');
    setErrorMessage('');
  }, []);

  const openRegister = useCallback(() => {
    setMode('adminRegister');
    setRegisterPassword('');
    setRegisterConfirmPassword('');
    setMessage('');
    setErrorMessage('');
  }, []);

  const backToCustomer = useCallback(() => {
    setMode('customer');
    setMessage('');
    setErrorMessage('');
  }, []);

  useEffect(() => {
    console.log('[CartOverlay] visible changed:', cartModalVisible);
  }, [cartModalVisible]);

  useEffect(() => {
    console.log('[CartOverlay] cart length:', cart.items.length);
  }, [cart.items.length]);

  const closeCart = useCallback(
    (source: string) => {
      console.log('[CartOverlay] close called from:', source);
      setCartModalVisible(false);
    },
    [setCartModalVisible],
  );

  const openCart = useCallback(() => {
    console.log('[CartOverlay] open pressed');
    cartOpenStartedAtRef.current = Date.now();
    setTableError('');
    setCartError('');
    setErrorMessage('');
    setCartModalVisible(true);
  }, [setCartModalVisible]);

  const reinforceFullscreen = useCallback((source: string) => {
    console.log('[CartOverlay] reinforce fullscreen from:', source);
    configureSystemUI({
      barStyle: 'light-content',
      backgroundColor: 'transparent',
      animated: false,
    });
  }, []);

  useEffect(() => {
    if (!cartModalVisible) {
      reinforceFullscreen('cart-hidden');
      return;
    }

    reinforceFullscreen('cart-visible');

    // React Native Modal on Android creates a separate Window and can bring
    // the system navigation bar back. The cart now renders as an absolute
    // in-screen overlay, but we still re-apply fullscreen for keyboard/focus
    // transitions to keep the restaurant menu immersive.
    const timers = [
      setTimeout(() => reinforceFullscreen('cart-visible-delay-50'), 50),
      setTimeout(() => reinforceFullscreen('cart-visible-delay-250'), 250),
    ];

    return () => {
      timers.forEach(timer => clearTimeout(timer));
    };
  }, [cartModalVisible, reinforceFullscreen]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !cartModalVisible) {
      return;
    }

    const backSubscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeCart('android-back');
      return true;
    });

    return () => {
      backSubscription.remove();
    };
  }, [cartModalVisible, closeCart]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const keyboardShow = Keyboard.addListener('keyboardDidShow', () => {
      reinforceFullscreen('keyboard-show');
    });
    const keyboardHide = Keyboard.addListener('keyboardDidHide', () => {
      reinforceFullscreen('keyboard-hide');
      setTimeout(() => reinforceFullscreen('keyboard-hide-delay'), 120);
    });

    return () => {
      keyboardShow.remove();
      keyboardHide.remove();
    };
  }, [reinforceFullscreen]);

  const changeQuantity = useCallback((itemId: string, delta: number) => {
    setCart(current => {
      const existing = current.items.find(item => item.itemId === itemId);
      const nextQuantity = Math.max(0, (existing?.quantity || 0) + delta);

      if (nextQuantity === 0) {
        return {
          ...current,
          items: current.items.filter(item => item.itemId !== itemId),
        };
      }

      if (existing) {
        return {
          ...current,
          items: current.items.map(item =>
            item.itemId === itemId ? {...item, quantity: nextQuantity} : item,
          ),
        };
      }

      return {
        ...current,
        items: [...current.items, {itemId, quantity: nextQuantity}],
      };
    });
    setCartError('');
  }, []);

  const onSubmitOrder = useCallback(async () => {
    const tableNumber = cart.tableNumber.trim();

    if (cartRows.length === 0) {
      setCartError('Vui lòng chọn món');
      setTableError('');
      return;
    }

    if (!tableNumber) {
      setTableError('Vui lòng nhập số bàn');
      setCartError('');
      return;
    }

    const orderItems = cartRows.map(row => ({
      itemId: row.item.id,
      name: row.item.name,
      price: row.item.price,
      quantity: row.quantity,
    }));

    const nextOrders = await createRestaurantOrder({
      tableNumber,
      note: cart.note.trim(),
      items: orderItems,
      total: cartTotal,
    });

    setOrders(nextOrders);
    await clearCurrentCart();
    setCart(createEmptyCart());
    setTableError('');
    setCartError('');
    closeCart('submit-success');
    showMessage(`Đã gửi đơn cho bàn ${tableNumber}. Admin/quầy có thể xem ngay.`);
  }, [cart.note, cart.tableNumber, cartRows, cartTotal, closeCart, showMessage]);

  const onRegisterAdmin = useCallback(async () => {
    if (registerPassword !== registerConfirmPassword) {
      showError('Mật khẩu nhập lại chưa khớp');
      return;
    }

    const result = await registerRestaurantAdmin(registerUsername, registerPassword);

    if (!result.ok) {
      showError(result.message);
      return;
    }

    setAdminUsername(registerUsername);
    setAdminPassword('');
    setRegisterPassword('');
    setRegisterConfirmPassword('');
    setMode('adminLogin');
    showMessage(`${result.message}. Hãy đăng nhập để vào dashboard.`);
  }, [registerConfirmPassword, registerPassword, registerUsername, showError, showMessage]);

  const onLoginAdmin = useCallback(async () => {
    const result = await verifyRestaurantAdmin(adminUsername, adminPassword);

    if (!result.ok) {
      showError(result.message);
      return;
    }

    setMode('admin');
    setAdminTab('orders');
    setAdminPassword('');
    showMessage(result.message);
  }, [adminPassword, adminUsername, showError, showMessage]);

  const onEditDish = useCallback((item: RestaurantMenuItem) => {
    setForm({
      id: item.id,
      createdAt: item.createdAt,
      name: item.name,
      price: String(item.price),
      description: item.description,
      imageUri: item.imageUri || '',
      categoryId: item.categoryId,
      available: item.available,
    });
    setMode('admin');
    setAdminTab('menu');
  }, []);

  const onChooseImage = useCallback(async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        quality: 0.8,
      });

      const uri = result.assets?.[0]?.uri;
      if (uri) {
        setForm(current => ({...current, imageUri: uri}));
      }
    } catch (error: any) {
      showError(`Không chọn được ảnh: ${error?.message || 'lỗi không xác định'}`);
    }
  }, [showError]);

  const onSaveDish = useCallback(async () => {
    const name = form.name.trim();
    const price = Number(normalisePriceInput(form.price));

    if (!name) {
      showError('Vui lòng nhập tên món.');
      return;
    }

    if (!price || price <= 0) {
      showError('Vui lòng nhập giá món hợp lệ.');
      return;
    }

    if (!form.categoryId) {
      showError('Vui lòng chọn danh mục cho món.');
      return;
    }

    const nextItems = await upsertMenuItem({
      id: form.id,
      createdAt: form.createdAt,
      name,
      price,
      description: form.description,
      imageUri: form.imageUri,
      categoryId: form.categoryId,
      available: form.available,
    });

    setItems(nextItems);
    resetForm();
    showMessage(form.id ? 'Đã cập nhật món.' : 'Đã thêm món mới.');
  }, [form, resetForm, showError, showMessage]);

  const onDeleteDish = useCallback(
    (item: RestaurantMenuItem) => {
      Alert.alert('Xoá món', `Xoá “${item.name}” khỏi menu?`, [
        {text: 'Huỷ', style: 'cancel'},
        {
          text: 'Xoá',
          style: 'destructive',
          onPress: async () => {
            const nextItems = await deleteMenuItem(item.id);
            setItems(nextItems);
            showMessage('Đã xoá món khỏi menu.');
          },
        },
      ]);
    },
    [showMessage],
  );

  const onSaveCategory = useCallback(async () => {
    const result = await upsertMenuCategory(categoryForm as CategoryFormState & {name: string});
    setCategories(result.categories);

    if (!result.ok) {
      showError(result.message);
      return;
    }

    const firstCategoryId = result.categories[0]?.id || '';
    setSelectedCategoryId(current =>
      result.categories.some(category => category.id === current) ? current : firstCategoryId,
    );
    setForm(current => ({
      ...current,
      categoryId: result.categories.some(category => category.id === current.categoryId)
        ? current.categoryId
        : firstCategoryId,
    }));
    resetCategoryForm();
    showMessage(result.message);
  }, [categoryForm, resetCategoryForm, showError, showMessage]);

  const onEditCategory = useCallback((category: MenuCategory) => {
    setCategoryForm({
      id: category.id,
      createdAt: category.createdAt,
      name: category.name,
    });
    setMode('admin');
    setAdminTab('categories');
  }, []);

  const onDeleteCategory = useCallback(
    (category: MenuCategory) => {
      Alert.alert('Xoá danh mục', `Xoá danh mục “${category.name}”?`, [
        {text: 'Huỷ', style: 'cancel'},
        {
          text: 'Xoá',
          style: 'destructive',
          onPress: async () => {
            const result = await deleteMenuCategory(category.id);
            setCategories(result.categories);

            if (!result.ok) {
              showError(result.message);
              return;
            }

            const nextSelected = result.categories[0]?.id || '';
            setSelectedCategoryId(current =>
              result.categories.some(item => item.id === current) ? current : nextSelected,
            );
            setForm(current => ({
              ...current,
              categoryId: result.categories.some(item => item.id === current.categoryId)
                ? current.categoryId
                : nextSelected,
            }));
            showMessage(result.message);
          },
        },
      ]);
    },
    [showError, showMessage],
  );

  const onChangeOrderStatus = useCallback(
    async (orderId: string, status: RestaurantOrderStatus) => {
      const nextOrders = await updateRestaurantOrderStatus(orderId, status);
      setOrders(nextOrders);
      showMessage(`Đã chuyển trạng thái đơn sang “${statusLabels[status]}”.`);
    },
    [showMessage],
  );

  const renderNotice = () => {
    if (!message && !errorMessage) {
      return null;
    }

    return (
      <View style={[styles.notice, errorMessage ? styles.errorNotice : null]}>
        <RNText style={styles.noticeText}>{errorMessage || message}</RNText>
      </View>
    );
  };

  const renderTopBar = () => {
    const adminTitle =
      mode === 'admin'
        ? 'Admin dashboard'
        : mode === 'adminRegister'
          ? 'Đăng ký Admin'
          : 'Đăng nhập Admin';

    return (
      <View style={styles.topBar}>
        <View style={styles.headerSide}>
          <Pressable
            onPress={mode === 'customer' ? () => props.goBack() : backToCustomer}
            style={styles.backButton}>
            <RNText style={styles.backText}>
              {mode === 'customer' ? '‹ Về Home' : '‹ Menu'}
            </RNText>
          </Pressable>
        </View>

        {mode === 'customer' ? (
          <View style={styles.headerAuthCenter}>
            <Pressable onPress={openLogin} style={styles.headerAuthButton}>
              <RNText style={styles.headerAuthText}>Đăng nhập</RNText>
            </Pressable>
            <Pressable onPress={openRegister} style={styles.headerAuthButtonSecondary}>
              <RNText style={styles.headerAuthText}>Đăng ký</RNText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.headerTitleWrap}>
            <RNText style={styles.headerTitle}>{adminTitle}</RNText>
            <RNText style={styles.headerSubTitle}>APlus Restaurant Control</RNText>
          </View>
        )}

        <View style={[styles.headerSide, styles.headerSideRight]}>
          <Image source={images.logoSmall} style={styles.headerLogo} resizeMode="contain" />
        </View>
      </View>
    );
  };

  const renderInput = ({
    label,
    value,
    onChangeText,
    placeholder,
    keyboardType = 'default',
    multiline = false,
    secureTextEntry = false,
    style,
    hasError = false,
  }: {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    keyboardType?: 'default' | 'numeric' | 'number-pad';
    multiline?: boolean;
    secureTextEntry?: boolean;
    style?: any;
    hasError?: boolean;
  }) => {
    return (
      <View style={[styles.inputWrap, hasError ? styles.inputWrapError : null, style]}>
        <RNText style={styles.inputLabel}>{label}</RNText>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => {
            if (cartVisibleSession) {
              reinforceFullscreen('text-input-focus');
            }
          }}
          onBlur={() => {
            if (cartVisibleSession) {
              reinforceFullscreen('text-input-blur');
            }
          }}
          placeholder={placeholder}
          placeholderTextColor="rgba(255,255,255,0.42)"
          keyboardType={keyboardType}
          multiline={multiline}
          secureTextEntry={secureTextEntry}
          style={multiline ? styles.textArea : styles.input}
          selectionColor="#E22A32"
        />
      </View>
    );
  };

  const renderCategoryColumn = () => {
    return (
      <View style={styles.categoryColumn}>
        <View style={styles.categoryHeader}>
          <RNText style={styles.categoryTitle}>Danh mục</RNText>
          <RNText style={styles.categorySubtitle}>Chọn nhóm món</RNText>
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.categoryListContent}>
          {categories.map(category => {
            const active = category.id === selectedCategory?.id;
            return (
              <Pressable
                key={category.id}
                onPress={() => setSelectedCategoryId(category.id)}
                style={[styles.categoryItem, active ? styles.categoryItemActive : null]}>
                <RNText style={styles.categoryItemText}>{category.name}</RNText>
                <RNText style={styles.categoryCountText}>
                  {categoryCounts[category.id] || 0} món
                </RNText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const renderQuantityOrAdd = (item: RestaurantMenuItem) => {
    const quantity = cartItemMap[item.id]?.quantity || 0;

    if (!item.available) {
      return <RNText style={styles.disabledText}>Tạm hết</RNText>;
    }

    if (quantity <= 0) {
      return (
        <Pressable onPress={() => changeQuantity(item.id, 1)} style={styles.addButton}>
          <RNText style={styles.addButtonText}>+ Thêm</RNText>
        </Pressable>
      );
    }

    return (
      <View style={styles.quantityControl}>
        <Pressable
          onPress={() => changeQuantity(item.id, -1)}
          style={styles.quantityButton}>
          <RNText style={styles.quantityButtonText}>−</RNText>
        </Pressable>
        <RNText style={styles.quantityText}>{quantity}</RNText>
        <Pressable
          onPress={() => changeQuantity(item.id, 1)}
          style={styles.quantityButton}>
          <RNText style={styles.quantityButtonText}>+</RNText>
        </Pressable>
      </View>
    );
  };

  const renderDishCard = (item: RestaurantMenuItem, adminView = false) => {
    return (
      <View key={item.id} style={adminView ? styles.adminDishCard : styles.dishCard}>
        <View style={styles.dishImageWrap}>
          <Image
            source={getMenuImageSource(item)}
            style={styles.dishImage}
            resizeMode="cover"
          />
          <View style={styles.dishImageShade} />
          <RNText style={styles.dishCategoryLabel}>
            {getCategoryNameById(item.categoryId, categories)}
          </RNText>
        </View>
        <View style={styles.dishBody}>
          <RNText numberOfLines={1} style={styles.dishName}>
            {item.name}
          </RNText>
          {item.description ? (
            <RNText numberOfLines={2} style={styles.dishDescription}>
              {item.description}
            </RNText>
          ) : null}
          <View style={styles.dishFooter}>
            <RNText style={styles.dishPrice}>{formatCurrency(item.price)}</RNText>
            {!adminView && renderQuantityOrAdd(item)}
          </View>
          {adminView ? (
            <>
              <View style={styles.adminDishMetaRow}>
                <RNText style={styles.cartMeta}>
                  {item.available ? 'Đang bán' : 'Tạm hết'}
                </RNText>
                <RNText style={styles.cartMeta}>
                  {getCategoryNameById(item.categoryId, categories)}
                </RNText>
              </View>
              <View style={styles.adminCardActionsInline}>
                <Pressable onPress={() => onEditDish(item)} style={styles.secondaryButtonSmall}>
                  <RNText style={styles.secondaryButtonText}>Sửa</RNText>
                </Pressable>
                <Pressable onPress={() => onDeleteDish(item)} style={styles.dangerButtonSmall}>
                  <RNText style={styles.dangerButtonText}>Xoá</RNText>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </View>
    );
  };

  const renderCustomerMenu = () => {
    return (
      <View style={styles.customerShell}>
        {renderCategoryColumn()}
        <View style={styles.menuColumn}>
          <View style={styles.menuColumnHeader}>
            <View style={styles.menuTitleBlock}>
              <RNText style={styles.menuColumnTitle}>
                {selectedCategory?.name || 'Menu'}
              </RNText>
              <RNText style={styles.menuColumnHint}>
                Chọn món nhanh như quầy nhà hàng lớn
              </RNText>
            </View>
            <RNText style={styles.menuCountPill}>{visibleItems.length} món</RNText>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.menuGridContent}>
            {visibleItems.length === 0 ? (
              <View style={styles.emptyState}>
                <RNText style={styles.emptyIcon}>🍽️</RNText>
                <RNText style={styles.emptyText}>Chưa có món trong danh mục này</RNText>
                <RNText style={styles.emptySubText}>
                  Admin có thể thêm món mới trong dashboard.
                </RNText>
              </View>
            ) : (
              <View style={styles.menuGrid}>{visibleItems.map(item => renderDishCard(item))}</View>
            )}
          </ScrollView>
        </View>

        <Pressable onPress={openCart} style={styles.cartBottomBar}>
          <View style={styles.cartBarIconWrap}>
            <RNText style={styles.cartFloatingIcon}>🧺</RNText>
            <View style={styles.cartBadge}>
              <RNText style={styles.cartBadgeText}>{cartBadgeCount}</RNText>
            </View>
          </View>
          <View style={styles.cartBarMain}>
            <RNText style={styles.cartFloatingText}>Giỏ hàng</RNText>
            <RNText style={styles.cartBarSubText}>{cartBadgeCount} loại món</RNText>
          </View>
          <RNText style={styles.cartBarTotal}>{formatCurrency(cartTotal)}</RNText>
        </Pressable>
      </View>
    );
  };

  const renderCartRow = (row: (typeof cartRows)[number]) => {
    return (
      <View key={row.itemId} style={styles.cartRow}>
        <View style={styles.cartRowMain}>
          <RNText style={styles.cartItemName}>{row.item.name}</RNText>
          <RNText style={styles.cartMeta}>
            {formatCurrency(row.item.price)} × {row.quantity}
          </RNText>
        </View>
        <View style={styles.cartRowRight}>
          <RNText style={styles.cartLineTotal}>{formatCurrency(row.lineTotal)}</RNText>
          <View style={styles.quantityControlSmall}>
            <Pressable
              onPress={() => changeQuantity(row.itemId, -1)}
              style={styles.quantityButtonSmall}>
              <RNText style={styles.quantityButtonText}>−</RNText>
            </Pressable>
            <RNText style={styles.quantityTextSmall}>{row.quantity}</RNText>
            <Pressable
              onPress={() => changeQuantity(row.itemId, 1)}
              style={styles.quantityButtonSmall}>
              <RNText style={styles.quantityButtonText}>+</RNText>
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  const renderCartModal = () => {
    if (!cartModalVisible) {
      return null;
    }

    return (
      <RNView
        style={styles.cartModalRoot}
        onLayout={() => reinforceFullscreen('overlay-layout')}>
        <RNView style={styles.cartModalDimLayer} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.cartModalKeyboardLayer}>
          <RNView
            style={styles.cartModalCard}
            onTouchStart={() => {
              console.log('[CartOverlay] content pressed');
            }}>
            <View style={styles.cartModalHeader}>
              <View>
                <RNText style={styles.cartModalTitle}>Giỏ hàng</RNText>
                <RNText style={styles.cartModalSubTitle}>
                  {cartBadgeCount} loại món · {formatCurrency(cartTotal)}
                </RNText>
              </View>
              <Pressable
                onPress={() => closeCart('close-button')}
                style={styles.closeButton}>
                <RNText style={styles.closeButtonText}>×</RNText>
              </Pressable>
            </View>

            <ScrollView
              style={styles.cartList}
              contentContainerStyle={styles.cartListContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {cartRows.length === 0 ? (
                <View style={styles.emptyState}>
                  <RNText style={styles.emptyIcon}>🧺</RNText>
                  <RNText style={styles.emptyText}>Giỏ hàng đang trống</RNText>
                  <RNText style={styles.emptySubText}>
                    Chọn Coca, Fanta, Mirinda hoặc Pepsi để tạo đơn.
                  </RNText>
                </View>
              ) : (
                cartRows.map(renderCartRow)
              )}

              <View style={styles.totalRow}>
                <RNText style={styles.totalLabel}>Tổng tiền</RNText>
                <RNText style={styles.totalValue}>{formatCurrency(cartTotal)}</RNText>
              </View>

              {cartError ? <RNText style={styles.fieldErrorText}>{cartError}</RNText> : null}
            </ScrollView>

            <View style={styles.cartModalFooter}>
              {renderInput({
                label: 'SỐ BÀN',
                value: cart.tableNumber,
                onChangeText: text => {
                  setTableError('');
                  setCart(current => ({...current, tableNumber: text}));
                },
                placeholder: 'VD: Bàn 08',
                hasError: Boolean(tableError),
              })}
              {tableError ? (
                <RNText style={styles.fieldErrorText}>{tableError}</RNText>
              ) : null}
              {renderInput({
                label: 'GHI CHÚ',
                value: cart.note,
                onChangeText: text => setCart(current => ({...current, note: text})),
                placeholder: 'Ít đá, ra món sau trận...',
                multiline: true,
              })}
              <Pressable onPress={onSubmitOrder} style={styles.primaryButton}>
                <RNText style={styles.primaryButtonText}>Gửi đơn</RNText>
              </Pressable>
            </View>
          </RNView>
        </KeyboardAvoidingView>
      </RNView>
    );
  };

  const renderAuthCard = (authType: 'login' | 'register') => {
    const isLogin = authType === 'login';

    return (
      <ScrollView
        style={styles.adminScroll}
        contentContainerStyle={styles.authScrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.authHero}>
          <RNText style={styles.loginEyebrow}>APlus Restaurant Control</RNText>
          <RNText style={styles.loginTitle}>
            {isLogin ? 'Đăng nhập Admin' : 'Đăng ký Admin'}
          </RNText>
          <RNText style={styles.loginHint}>
            {isLogin
              ? 'Vào dashboard để quản lý danh mục, món ăn và đơn gọi tại bàn.'
              : 'Tạo tài khoản admin local để demo menu trước khi tách backend.'}
          </RNText>
        </View>

        <View style={styles.authCard}>
          {renderInput({
            label: 'TÊN TÀI KHOẢN',
            value: isLogin ? adminUsername : registerUsername,
            onChangeText: isLogin ? setAdminUsername : setRegisterUsername,
            placeholder: 'VD: admin',
            style: styles.fullField,
          })}
          {renderInput({
            label: 'MẬT KHẨU',
            value: isLogin ? adminPassword : registerPassword,
            onChangeText: isLogin ? setAdminPassword : setRegisterPassword,
            placeholder: 'Nhập mật khẩu',
            secureTextEntry: true,
            style: styles.fullField,
          })}
          {!isLogin
            ? renderInput({
                label: 'NHẬP LẠI MẬT KHẨU',
                value: registerConfirmPassword,
                onChangeText: setRegisterConfirmPassword,
                placeholder: 'Nhập lại mật khẩu',
                secureTextEntry: true,
                style: styles.fullField,
              })
            : null}

          <RNText style={styles.sectionHint}>
            Bản demo lưu mật khẩu local trong AsyncStorage. Khi lên production sẽ thay bằng backend auth.
          </RNText>

          <Pressable
            onPress={isLogin ? onLoginAdmin : onRegisterAdmin}
            style={styles.primaryButton}>
            <RNText style={styles.primaryButtonText}>
              {isLogin ? 'Đăng nhập' : 'Đăng ký'}
            </RNText>
          </Pressable>

          <View style={styles.authLinkRow}>
            <Pressable onPress={backToCustomer} style={styles.authTextButton}>
              <RNText style={styles.authTextButtonText}>Quay lại Menu</RNText>
            </Pressable>
            <Pressable
              onPress={isLogin ? openRegister : openLogin}
              style={styles.authTextButton}>
              <RNText style={styles.authTextButtonText}>
                {isLogin ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
              </RNText>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  };

  const renderAdminTabs = () => {
    const tabs: Array<{id: AdminTab; label: string}> = [
      {id: 'categories', label: 'Danh mục'},
      {id: 'menu', label: 'Món ăn'},
      {id: 'orders', label: 'Đơn hàng'},
    ];

    return (
      <View style={styles.adminTabs}>
        {tabs.map(tab => {
          const active = adminTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setAdminTab(tab.id)}
              style={[styles.adminTab, active ? styles.adminTabActive : null]}>
              <RNText style={active ? styles.adminTabTextActive : styles.adminTabText}>
                {tab.label}
              </RNText>
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderCategorySelector = () => {
    return (
      <View style={styles.categorySelector}>
        {categories.map(category => {
          const active = category.id === form.categoryId;
          return (
            <Pressable
              key={category.id}
              onPress={() => setForm(current => ({...current, categoryId: category.id}))}
              style={[
                styles.formCategoryChip,
                active ? styles.formCategoryChipActive : null,
              ]}>
              <RNText
                style={
                  active ? styles.formCategoryChipTextActive : styles.formCategoryChipText
                }>
                {category.name}
              </RNText>
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderAdminMenu = () => {
    return (
      <>
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <RNText style={styles.sectionTitle}>
                {form.id ? 'Sửa món' : 'Thêm món mới'}
              </RNText>
              <RNText style={styles.sectionHint}>
                Ảnh có thể chọn từ thư viện hoặc dán URL. Nếu trống, app dùng ảnh placeholder APlus.
              </RNText>
            </View>
          </View>

          <View style={styles.formGrid}>
            {renderInput({
              label: 'TÊN MÓN',
              value: form.name,
              onChangeText: text => setForm(current => ({...current, name: text})),
              placeholder: 'VD: Coca / Bò lúc lắc',
              style: styles.formField,
            })}
            {renderInput({
              label: 'GIÁ',
              value: form.price,
              onChangeText: text =>
                setForm(current => ({...current, price: normalisePriceInput(text)})),
              placeholder: 'VD: 25000',
              keyboardType: 'number-pad',
              style: styles.formField,
            })}
            {renderInput({
              label: 'URL ẢNH / ẢNH LOCAL',
              value: form.imageUri,
              onChangeText: text => setForm(current => ({...current, imageUri: text})),
              placeholder: 'https://... hoặc chọn từ thư viện',
              style: styles.fullField,
            })}
            {renderInput({
              label: 'MÔ TẢ MÓN',
              value: form.description,
              onChangeText: text =>
                setForm(current => ({...current, description: text})),
              placeholder: 'Mô tả ngắn để khách dễ chọn món',
              multiline: true,
              style: styles.fullField,
            })}
          </View>

          <RNText style={styles.blockLabel}>Danh mục món</RNText>
          {categories.length === 0 ? (
            <RNText style={styles.sectionHint}>Hãy tạo danh mục trước khi thêm món.</RNText>
          ) : (
            renderCategorySelector()
          )}

          <View style={styles.availabilityRow}>
            <View style={{flex: 1}}>
              <RNText style={styles.sectionTitle}>Trạng thái món</RNText>
              <RNText style={styles.sectionHint}>
                {form.available ? 'Đang còn món' : 'Tạm hết món'}
              </RNText>
            </View>
            <Pressable
              onPress={() =>
                setForm(current => ({...current, available: !current.available}))
              }
              style={form.available ? styles.primaryButton : styles.secondaryButton}>
              <RNText
                style={
                  form.available ? styles.primaryButtonText : styles.secondaryButtonText
                }>
                {form.available ? 'Còn món' : 'Hết món'}
              </RNText>
            </Pressable>
          </View>

          <View style={styles.formActions}>
            <Pressable onPress={onSaveDish} style={styles.primaryButton}>
              <RNText style={styles.primaryButtonText}>
                {form.id ? 'Lưu cập nhật' : 'Thêm món'}
              </RNText>
            </Pressable>
            <Pressable onPress={onChooseImage} style={styles.secondaryButton}>
              <RNText style={styles.secondaryButtonText}>Chọn ảnh</RNText>
            </Pressable>
            <Pressable onPress={resetForm} style={styles.secondaryButton}>
              <RNText style={styles.secondaryButtonText}>Làm mới form</RNText>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <RNText style={styles.sectionTitle}>Menu hiện tại</RNText>
              <RNText style={styles.sectionHint}>
                {items.length} món đang lưu local bằng AsyncStorage.
              </RNText>
            </View>
          </View>
          <View style={styles.adminMenuGrid}>
            {items.map(item => renderDishCard(item, true))}
          </View>
        </View>
      </>
    );
  };

  const renderAdminCategories = () => {
    return (
      <>
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <RNText style={styles.sectionTitle}>
                {categoryForm.id ? 'Sửa danh mục' : 'Thêm danh mục'}
              </RNText>
              <RNText style={styles.sectionHint}>
                Màn khách lấy danh mục trực tiếp từ danh sách admin quản lý.
              </RNText>
            </View>
          </View>

          {renderInput({
            label: 'TÊN DANH MỤC',
            value: categoryForm.name,
            onChangeText: text => setCategoryForm(current => ({...current, name: text})),
            placeholder: 'VD: Đồ uống / Đồ ăn / Combo...',
            style: styles.fullField,
          })}

          <View style={styles.formActions}>
            <Pressable onPress={onSaveCategory} style={styles.primaryButton}>
              <RNText style={styles.primaryButtonText}>
                {categoryForm.id ? 'Lưu danh mục' : 'Thêm danh mục'}
              </RNText>
            </Pressable>
            <Pressable onPress={resetCategoryForm} style={styles.secondaryButton}>
              <RNText style={styles.secondaryButtonText}>Làm mới</RNText>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <RNText style={styles.sectionTitle}>Danh mục hiện tại</RNText>
              <RNText style={styles.sectionHint}>
                Mặc định hiện có Đồ uống và Đồ ăn. Chỉ xoá được danh mục chưa có món.
              </RNText>
            </View>
          </View>

          <View style={styles.categoryManageList}>
            {categories.map(category => (
              <View key={category.id} style={styles.categoryManageRow}>
                <View style={styles.categoryManageInfo}>
                  <RNText style={styles.categoryManageName}>{category.name}</RNText>
                  <RNText style={styles.cartMeta}>
                    {categoryCounts[category.id] || 0} món
                  </RNText>
                </View>
                <View style={styles.adminCardActionsInline}>
                  <Pressable
                    onPress={() => onEditCategory(category)}
                    style={styles.secondaryButtonSmall}>
                    <RNText style={styles.secondaryButtonText}>Sửa</RNText>
                  </Pressable>
                  <Pressable
                    onPress={() => onDeleteCategory(category)}
                    style={styles.dangerButtonSmall}>
                    <RNText style={styles.dangerButtonText}>Xoá</RNText>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </View>
      </>
    );
  };

  const renderOrderCard = (order: RestaurantOrder) => {
    return (
      <View key={order.id} style={styles.orderCard}>
        <View style={styles.orderHeader}>
          <View>
            <RNText style={styles.orderTitle}>Bàn {order.tableNumber}</RNText>
            <RNText style={styles.orderTime}>{formatDateTime(order.createdAt)}</RNText>
          </View>
          <View
            style={[
              styles.statusPill,
              {backgroundColor: statusColors[order.status] || statusColors.new},
            ]}>
            <RNText style={styles.statusText}>{statusLabels[order.status]}</RNText>
          </View>
        </View>

        <View style={styles.orderItemsWrap}>
          {order.items.map(item => (
            <RNText key={`${order.id}_${item.itemId}`} style={styles.orderItemText}>
              • {item.name} × {item.quantity} · {formatCurrency(item.price * item.quantity)}
            </RNText>
          ))}
        </View>

        {order.note ? <RNText style={styles.orderNote}>Ghi chú: {order.note}</RNText> : null}

        <View style={styles.orderFooter}>
          <RNText style={styles.totalValue}>{formatCurrency(order.total)}</RNText>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statusActions}>
          {statusFlow.map(status => {
            const active = status === order.status;
            return (
              <Pressable
                key={status}
                onPress={() => onChangeOrderStatus(order.id, status)}
                style={[styles.statusButton, active ? styles.statusButtonActive : null]}>
                <RNText style={active ? styles.statusButtonTextActive : styles.statusButtonText}>
                  {statusLabels[status]}
                </RNText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const renderAdminOrders = () => {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderText}>
            <RNText style={styles.sectionTitle}>Đơn hàng</RNText>
            <RNText style={styles.sectionHint}>
              {orders.length} đơn local. Đơn mới nhất nằm trên cùng.
            </RNText>
          </View>
        </View>

        {orders.length === 0 ? (
          <View style={styles.emptyState}>
            <RNText style={styles.emptyIcon}>🧾</RNText>
            <RNText style={styles.emptyText}>Chưa có đơn hàng</RNText>
            <RNText style={styles.emptySubText}>
              Khi khách gửi đơn, admin sẽ thấy đơn tại đây.
            </RNText>
          </View>
        ) : (
          orders.map(renderOrderCard)
        )}
      </View>
    );
  };

  const renderAdmin = () => {
    return (
      <ScrollView
        style={styles.adminScroll}
        contentContainerStyle={styles.adminScrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.dashboardHero}>
          <RNText style={styles.loginEyebrow}>Local-first dashboard</RNText>
          <RNText style={styles.loginTitle}>Quản trị gọi món</RNText>
          <RNText style={styles.loginHint}>
            Quản lý danh mục, món ăn và trạng thái đơn theo đúng flow nhà hàng.
          </RNText>
        </View>
        {renderAdminTabs()}
        {adminTab === 'orders'
          ? renderAdminOrders()
          : adminTab === 'menu'
            ? renderAdminMenu()
            : renderAdminCategories()}
      </ScrollView>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.screenGlowTop} />
      <View style={styles.screenGlowBottom} />
      {renderTopBar()}
      {renderNotice()}
      {mode === 'customer'
        ? renderCustomerMenu()
        : mode === 'adminLogin'
          ? renderAuthCard('login')
          : mode === 'adminRegister'
            ? renderAuthCard('register')
            : renderAdmin()}
      {renderCartModal()}
    </View>
  );
};

export default memo(RestaurantMenuScreen);
