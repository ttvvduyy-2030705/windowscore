import React, {useCallback} from 'react';
import {Pressable, Text, View} from 'react-native';

import i18n from 'i18n';
import {CUSHION, LIBRE, POOL, SNOOKER} from 'constants/category';
import {
  GAME_COUNT_DOWN_TIME,
  GAME_EXTRA_TIME_BONUS,
  GAME_EXTRA_TIME_TURN,
  GAME_MODE,
  GAME_WARM_UP_TIME,
} from 'constants/game-settings';
import {BilliardCategory} from 'types/category';
import {isPoolGame, isSnookerGame} from 'utils/game';
import {
  GameCountDownTime,
  GameExtraTimeBonus,
  GameExtraTimeTurns,
  GameMode,
  GameSettingsMode,
  GameWarmUpTime,
} from 'types/settings';

import useAdaptiveLayout from '../../useAdaptiveLayout';
import createStyles from './styles';

interface Props {
  adaptive?: ReturnType<typeof useAdaptiveLayout>;
  showTitle?: boolean;
  category?: BilliardCategory;
  gameMode?: GameMode;
  gameSettingsMode?: GameSettingsMode;
  extraTimeTurnsEnabled: boolean;
  countdownEnabled: boolean;
  warmUpEnabled: boolean;
  extraTimeBonusEnabled: boolean;
  onSelectCategory: (_selectedCategory: BilliardCategory) => void;
  onSelectGameMode: (_selectedGameMode: GameMode) => void;
  onSelectExtraTimeTurns: (_selectedExtraTimeTurns: GameExtraTimeTurns) => void;
  onSelectCountdown: (_selectedCountdownTime: GameCountDownTime) => void;
  onSelectWarmUp: (selectedWarmUpTime: GameWarmUpTime) => void;
  onSelectExtraTimeBonus: (_selectedExtraTimeBonus: GameExtraTimeBonus) => void;
}

const getLocale = () => {
  const maybeCurrentLocale =
    typeof (i18n as any)?.currentLocale === 'function'
      ? (i18n as any).currentLocale()
      : '';

  return String((i18n as any)?.locale ?? maybeCurrentLocale ?? '').toLowerCase();
};

const CategorySettings = ({
  adaptive: adaptiveProp,
  showTitle = true,
  category,
  gameSettingsMode,
  extraTimeTurnsEnabled,
  countdownEnabled,
  warmUpEnabled,
  extraTimeBonusEnabled,
  onSelectCategory,
  onSelectGameMode,
  onSelectExtraTimeTurns,
  onSelectCountdown,
  onSelectWarmUp,
  onSelectExtraTimeBonus,
}: Props) => {
  const adaptive = adaptiveProp ?? useAdaptiveLayout();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);
  const isEnglish = getLocale().startsWith('en');

  const pickLabel = useCallback(
    (vi: string, en: string) => (isEnglish ? en : vi),
    [isEnglish],
  );

  const translateValue = useCallback(
    (lookup: string, fallback: string) => {
      const translated = i18n.t(lookup as never);
      if (translated && translated !== lookup && !String(translated).includes('[missing')) {
        return translated as string;
      }
      return fallback;
    },
    [],
  );

  const categoryTitle = pickLabel('Thể loại', 'Category');
  const setupTitle = pickLabel('Thiết lập', 'Setup');
  const modeTitle = pickLabel('Chế độ', 'Mode');
  const caromTitle = pickLabel('Carom', 'Carom');
  const libreTitle = pickLabel('Libre', 'Libre');
  const poolTitle = pickLabel('Pool', 'Pool');
  const snookerTitle = pickLabel('Snooker', 'Snooker');
  const extraTurnsTitle = pickLabel('Lượt thêm giờ', 'Extra turns');
  const countdownTitle = pickLabel('Đếm ngược', 'Countdown');
  const warmUpTitle = pickLabel('Khởi động', 'Warm up');
  const extraTimeTitle = pickLabel('Thời gian thêm', 'Extra time');

  const renderButtons = useCallback(
    (
      label: string,
      data: Record<string, string | number | undefined>,
      currentItem: string | number | undefined,
      onSelect: (item: any) => void,
      useKey = false,
    ) => {
      return (
        <View style={styles.optionsWrap}>
          {Object.keys(data).map(key => {
            const item = data[key];
            const lookupKey = useKey ? key : String(item);
            const labelText = translateValue(lookupKey, String(item));
            const isActive = item === currentItem;

            return (
              <Pressable
                key={`${label}-${key}`}
                onPress={() => onSelect(item)}
                style={({pressed}) => [
                  styles.optionButton,
                  isActive && styles.optionButtonActive,
                  pressed && styles.optionButtonPressed,
                ]}>
                <Text
                  style={[
                    styles.optionText,
                    isActive && styles.optionTextActive,
                  ]}>
                  {labelText}
                </Text>
              </Pressable>
            );
          })}
        </View>
      );
    },
    [styles, translateValue],
  );

  const renderInlineRow = useCallback(
    (
      label: string,
      data: Record<string, string | number | undefined>,
      currentItem: string | number | undefined,
      onSelect: (item: any) => void,
      useKey = false,
      rowStyle?: any,
    ) => {
      return (
        <View style={[styles.inlineRow, rowStyle]}>
          <Text style={styles.inlineLabel}>{label}</Text>
          <View style={styles.inlineOptions}>
            {renderButtons(label, data, currentItem, onSelect, useKey)}
          </View>
        </View>
      );
    },
    [renderButtons, styles],
  );

  return (
    <View style={styles.container}>
      {showTitle ? <Text style={styles.mainTitle}>{categoryTitle}</Text> : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{categoryTitle}</Text>
        <View style={styles.sectionDivider} />

        {renderInlineRow(caromTitle, CUSHION, category, onSelectCategory)}
        {renderInlineRow(libreTitle, LIBRE, category, onSelectCategory)}

        <View style={styles.poolBlock}>
          <Text style={styles.inlineLabel}>{poolTitle}</Text>
          {renderButtons(poolTitle, POOL, category, onSelectCategory)}
        </View>

        {renderInlineRow(snookerTitle, SNOOKER, category, onSelectCategory)}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{setupTitle}</Text>
        <View style={styles.sectionDivider} />

        <View style={styles.modeOnlyRow}>
          {renderButtons(
            modeTitle,
            GAME_MODE,
            gameSettingsMode?.mode,
            onSelectGameMode,
          )}
        </View>

        {extraTimeTurnsEnabled &&
          renderInlineRow(
            extraTurnsTitle,
            GAME_EXTRA_TIME_TURN,
            gameSettingsMode?.extraTimeTurns,
            onSelectExtraTimeTurns,
            true,
            styles.compactOptionRow,
          )}

        {countdownEnabled &&
          renderInlineRow(
            countdownTitle,
            GAME_COUNT_DOWN_TIME,
            gameSettingsMode?.countdownTime,
            onSelectCountdown,
            true,
            styles.compactOptionRow,
          )}

        {warmUpEnabled &&
          renderInlineRow(
            warmUpTitle,
            GAME_WARM_UP_TIME,
            gameSettingsMode?.warmUpTime,
            onSelectWarmUp,
            true,
            styles.compactOptionRow,
          )}

        {extraTimeBonusEnabled && !isPoolGame(category) && !isSnookerGame(category) &&
          renderInlineRow(
            extraTimeTitle,
            GAME_EXTRA_TIME_BONUS,
            gameSettingsMode?.extraTimeBonus ?? 0,
            onSelectExtraTimeBonus,
            true,
            styles.compactOptionRow,
          )}
      </View>
    </View>
  );
};

export default CategorySettings;
