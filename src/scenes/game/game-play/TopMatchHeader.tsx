import React, {memo, useContext, useMemo} from 'react';
import {StyleSheet, Text as RNText} from 'react-native';

import View from 'components/View';
import Button from 'components/Button';
import Image from 'components/Image';
import Switch from 'components/Switch';

import images from 'assets';
import colors from 'configuration/colors';
import i18n from 'i18n';
import {
  isPoolGame,
  isPool9Game,
  isPool10Game,
  isPool15Game,
  isPool15OnlyGame,
} from 'utils/game';
import useDesignSystem from 'theme/useDesignSystem';
import {createGameplayLayoutRules} from './layoutRules';
import {LanguageContext} from 'context/language';

interface Props {
  title: string;
  soundEnabled: boolean;
  onToggleSound: () => void;
  remoteEnabled?: boolean;
  onToggleRemote?: (value: boolean) => void;
  proModeEnabled?: boolean;
  onToggleProMode?: (value: boolean) => void;
  gameSettings?: any;
  totalPlayers?: number;
  centerTimeText?: string;
  compactTitleLeft?: boolean;
}

const localeText = (vi: string, en: string) => {
  const locale = String(
    (i18n as any)?.locale || (i18n as any)?.language || '',
  ).toLowerCase();
  return locale.startsWith('en') ? en : vi;
};

const TopMatchHeader = ({
  title,
  soundEnabled,
  onToggleSound,
  remoteEnabled = false,
  onToggleRemote,
  proModeEnabled = false,
  onToggleProMode,
  gameSettings,
  totalPlayers = 2,
  centerTimeText,
  compactTitleLeft = false,
}: Props) => {
  const {language} = useContext(LanguageContext);
  void language;
  const isAnyPoolMode =
    isPoolGame(gameSettings?.category) ||
    isPool9Game(gameSettings?.category) ||
    isPool10Game(gameSettings?.category) ||
    isPool15Game(gameSettings?.category) ||
    isPool15OnlyGame(gameSettings?.category);

  const {adaptive, design} = useDesignSystem();
  const layoutRules = useMemo(() => createGameplayLayoutRules(adaptive, design), [adaptive.styleKey]);
  const isHandheldLandscape =
    adaptive.isLandscape &&
    (adaptive.systemMetrics.smallestScreenWidthDp < 600 ||
      adaptive.isConstrainedLandscape);

  const useBalancedHeader = compactTitleLeft || !!centerTimeText;
  const showProModeToggle = !isAnyPoolMode && totalPlayers <= 2;
  const useSingleLineSwitchRow = showProModeToggle;

  const dynamicStyles = useMemo(() => {
    const headerHeight = layoutRules.headerHeight;

    const logoWidth = isHandheldLandscape ? adaptive.s(60) : adaptive.s(98);
    const logoHeight = isHandheldLandscape ? adaptive.s(24) : adaptive.s(40);
    const soundButtonSize = isHandheldLandscape ? adaptive.s(28) : adaptive.s(36);
    const soundButtonGap = isHandheldLandscape ? adaptive.s(8) : adaptive.s(12);
    const leftSlotWidth = isHandheldLandscape
      ? adaptive.s(170)
      : adaptive.s(300);
    const rightSlotWidth = isHandheldLandscape
      ? adaptive.s(isAnyPoolMode ? 230 : 300)
      : adaptive.s(isAnyPoolMode ? 330 : 420);
    const switchGroupWidth = Math.max(
      adaptive.s(isAnyPoolMode ? 170 : 320),
      rightSlotWidth - soundButtonSize - soundButtonGap,
    );

    return {
      header: {
        minHeight: useSingleLineSwitchRow
          ? adaptive.s(Math.max(40, headerHeight - 6))
          : headerHeight,
        borderRadius: isHandheldLandscape ? design.radius.lg : layoutRules.panelRadius,
        paddingHorizontal: isHandheldLandscape ? design.spacing.sm : design.spacing.lg,
        paddingVertical: useSingleLineSwitchRow
          ? adaptive.s(4)
          : isHandheldLandscape
            ? design.spacing.xs
            : design.spacing.sm,
      },
      balancedLeftSlot: {
        width: leftSlotWidth,
      },
      balancedLogoWrap: {
        width: logoWidth,
      },
      logo: {
        width: logoWidth,
        height: logoHeight,
      },
      balancedTitleWrap: {
        marginLeft: isHandheldLandscape ? adaptive.s(8) : adaptive.s(12),
        paddingRight: isHandheldLandscape ? adaptive.s(10) : adaptive.s(14),
      },
      balancedTitleText: {
        fontSize: isHandheldLandscape
          ? adaptive.fs(13, 0.8, 0.9)
          : adaptive.fs(18, 0.84, 0.94),
        lineHeight: isHandheldLandscape
          ? adaptive.fs(15, 0.8, 0.9)
          : adaptive.fs(22, 0.84, 0.94),
      },
      centerTimeSlot: {
        paddingHorizontal: isHandheldLandscape ? adaptive.s(10) : adaptive.s(16),
      },
      centerTimeText: {
        fontSize: isHandheldLandscape
          ? adaptive.fs(24, 0.78, 0.96)
          : adaptive.fs(38, 0.9, 1.04),
        lineHeight: isHandheldLandscape
          ? adaptive.fs(28, 0.78, 0.96)
          : adaptive.fs(42, 0.9, 1.04),
      },
      titleText: {
        fontSize: isHandheldLandscape
          ? adaptive.fs(24, 0.68, 0.9)
          : adaptive.fs(35, 0.82, 1.02),
        lineHeight: isHandheldLandscape
          ? adaptive.fs(28, 0.68, 0.9)
          : adaptive.fs(40, 0.82, 1.02),
      },
      logoSlot: {
        width: leftSlotWidth,
      },
      rightSlot: {
        width: rightSlotWidth,
      },
      switchGroup: {
        width: switchGroupWidth,
      },
      switchRow: {
        minHeight: useSingleLineSwitchRow
          ? adaptive.s(18)
          : isHandheldLandscape
            ? adaptive.s(20)
            : adaptive.s(30),
      },
      switchLine: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        columnGap: adaptive.s(6),
        minHeight: adaptive.s(20),
      },
      switchInlineItem: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        columnGap: adaptive.s(4),
      },
      switchLabel: {
        fontSize: useSingleLineSwitchRow
          ? adaptive.fs(9, 0.74, 0.86)
          : isHandheldLandscape
            ? adaptive.fs(10, 0.76, 0.9)
            : adaptive.fs(14, 0.86, 1),
      },
      soundButton: {
        width: soundButtonSize,
        height: soundButtonSize,
        marginLeft: soundButtonGap,
      },
      soundIcon: {
        width: isHandheldLandscape ? adaptive.s(18) : adaptive.s(22),
        height: isHandheldLandscape ? adaptive.s(18) : adaptive.s(22),
      },
    };
  }, [adaptive, isAnyPoolMode, isHandheldLandscape, useSingleLineSwitchRow]);

  return (
    <View style={[styles.header, dynamicStyles.header]}>
      {useBalancedHeader ? (
        <>
          <View style={[styles.balancedLeftSlot, dynamicStyles.balancedLeftSlot]}>
            <View style={[styles.balancedLogoWrap, dynamicStyles.balancedLogoWrap]}>
              <Image
                source={images.logoSmall || images.logo}
                resizeMode="contain"
                style={[styles.logo, dynamicStyles.logo]}
              />
            </View>

            <View style={[styles.balancedTitleWrap, dynamicStyles.balancedTitleWrap]}>
              <RNText
                style={[
                  styles.balancedTitleText,
                  dynamicStyles.balancedTitleText,
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}>
                {title}
              </RNText>
            </View>
          </View>

          <View style={[styles.centerTimeSlot, dynamicStyles.centerTimeSlot]}>
            <RNText
              style={[styles.centerTimeText, dynamicStyles.centerTimeText]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}>
              {centerTimeText || '00:00:00'}
            </RNText>
          </View>
        </>
      ) : (
        <>
          <View style={[styles.logoSlot, dynamicStyles.logoSlot]}>
            <Image
              source={images.logoSmall || images.logo}
              resizeMode="contain"
              style={[styles.logo, dynamicStyles.logo]}
            />
          </View>

          <View style={styles.titleSlot}>
            <RNText
              style={[styles.titleText, dynamicStyles.titleText]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.62}>
              {title}
            </RNText>
          </View>
        </>
      )}

      <View style={[styles.rightSlot, dynamicStyles.rightSlot]}>
        <View style={[styles.switchGroup, dynamicStyles.switchGroup]}>
          {useSingleLineSwitchRow ? (
            <View style={[styles.switchLine, dynamicStyles.switchLine]}>
              <View style={[styles.switchInlineItem, dynamicStyles.switchInlineItem]}>
                <RNText
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  style={[styles.switchLabel, dynamicStyles.switchLabel]}>
                  {localeText('Chuyên nghiệp', 'Pro mode')}
                </RNText>
                <Switch
                  defaultValue={proModeEnabled}
                  onChange={value => onToggleProMode?.(value)}
                />
              </View>

              <View style={[styles.switchInlineItem, dynamicStyles.switchInlineItem]}>
                <RNText
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  style={[styles.switchLabel, dynamicStyles.switchLabel]}>
                  {localeText('Điều khiển', 'Remote')}
                </RNText>
                <Switch
                  defaultValue={remoteEnabled}
                  onChange={value => onToggleRemote?.(value)}
                />
              </View>
            </View>
          ) : (
            <>
              {showProModeToggle ? (
                <View style={[styles.switchRow, dynamicStyles.switchRow]}>
                  <RNText style={[styles.switchLabel, dynamicStyles.switchLabel]}>
                    {localeText('Chuyên nghiệp', 'Pro mode')}
                  </RNText>
                  <Switch
                    defaultValue={proModeEnabled}
                    onChange={value => onToggleProMode?.(value)}
                  />
                </View>
              ) : null}

              <View style={[styles.switchRow, dynamicStyles.switchRow]}>
                <RNText style={[styles.switchLabel, dynamicStyles.switchLabel]}>
                  {localeText('Điều khiển', 'Remote')}
                </RNText>
                <Switch
                  defaultValue={remoteEnabled}
                  onChange={value => onToggleRemote?.(value)}
                />
              </View>
            </>
          )}
        </View>

        <Button onPress={onToggleSound} style={[styles.soundButton, dynamicStyles.soundButton]}>
          <Image
            source={soundEnabled ? images.game.soundOn : images.game.soundOff}
            style={[
              styles.soundIcon,
              dynamicStyles.soundIcon,
              {tintColor: soundEnabled ? '#FFFFFF' : '#7A7A7A'},
            ]}
            resizeMode={'contain'}
          />
        </Button>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    minHeight: 74,
    borderRadius: 24,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 32, 32, 0.55)',
    backgroundColor: '#0A0B0E',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    shadowColor: '#ff1f1f',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 0},
    elevation: 10,
  },
  balancedLeftSlot: {
    width: 300,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  balancedLogoWrap: {
    justifyContent: 'center',
    alignItems: 'flex-start',
    zIndex: 2,
    flexShrink: 0,
  },
  balancedTitleWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoSlot: {
    width: 170,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  logo: {
    width: 98,
    height: 40,
  },
  titleSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  centerTimeSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 35,
    lineHeight: 40,
    fontWeight: '900',
    textAlign: 'center',
    includeFontPadding: false,
    width: '100%',
  },
  balancedTitleText: {
    color: '#FFFFFF',
    fontWeight: '900',
    textAlign: 'center',
    includeFontPadding: false,
    width: '100%',
    opacity: 0.96,
  },
  centerTimeText: {
    color: '#FF2D2D',
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '900',
    textAlign: 'center',
    includeFontPadding: false,
    width: '100%',
  },
  rightSlot: {
    width: 224,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  switchGroup: {
    width: 172,
  },
  switchRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchInlineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  soundButton: {
    width: 36,
    height: 36,
    marginLeft: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soundIcon: {
    width: 22,
    height: 22,
    tintColor: '#FFFFFF',
  },
});

export default memo(TopMatchHeader);
