import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {memo, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {Image, Platform, Pressable, ScrollView, StyleSheet, Switch, View} from 'react-native';

import images from 'assets';
import AppImage from 'components/Image';
import Container from 'components/Container';
import Text from 'components/Text';
import {LanguageContext} from 'context/language';
import useAdaptiveLayout from 'scenes/game/useAdaptiveLayout';
import useScreenSystemUI from 'theme/systemUI';
import {screens} from 'scenes/screens';
import createBrandedScreenChrome from 'scenes/shared/createBrandedScreenChrome';
import getBrandedScreenMetrics from 'scenes/shared/getBrandedScreenMetrics';
import {Navigation} from 'types/navigation';
import {useAplusPro} from 'features/subscription';
import i18n from 'i18n';

import facebookLogo from './facebook.png';
import youtubeLogo from './youtube.png';

export interface Props extends Navigation {}
export const CURRENT_PLATFORM_KEY = '@current_livestream_platform';

type PlatformKey = 'facebook' | 'youtube' | 'device';
type PlatformItem = {key: PlatformKey; label: string; image?: any};

const createStyles = (adaptive: ReturnType<typeof useAdaptiveLayout>) => {
  const chrome = createBrandedScreenChrome(adaptive);
  const metrics = getBrandedScreenMetrics(adaptive);
  const stacked = !adaptive.isLandscape || adaptive.width < 1100;

  return StyleSheet.create({
    screen: chrome.screen,
    scrollView: {flex: 1, width: '100%', alignSelf: 'stretch'},
    content: {flexGrow: 1, width: '100%', alignSelf: 'stretch', paddingBottom: metrics.s(8)},
    contentInner: {width: '100%', alignSelf: 'stretch', paddingHorizontal: metrics.screenPaddingX, paddingTop: metrics.sectionGap},
    headerGlow: chrome.headerGlow,
    headerBackButton: chrome.headerBackButton,
    headerBackFrame: chrome.headerBackFrame,
    headerBackInner: chrome.headerBackInner,
    headerBackArrow: {color:'#FFFFFF', fontSize:metrics.fs(22), fontWeight:'900', marginRight:metrics.s(10)},
    headerBackLogoImage: chrome.headerBackLogoImage,
    headerTitleWrap: chrome.headerTitleWrap,
    logoButton:{width:metrics.s(120), justifyContent:'center', alignItems:'flex-start', paddingVertical:metrics.s(6)},
    logoImage:{width:metrics.s(92), height:metrics.s(34)},
    headerTitle: chrome.headerTitle,
    headerSpacer:{width:metrics.s(120)},
    gridShell:{width:'100%', alignSelf:'stretch', marginTop: metrics.sectionGap, borderRadius: metrics.panelRadius + metrics.s(2), borderWidth: 1, borderColor:'rgba(201,29,36,0.72)', backgroundColor:'rgba(201,29,36,0.06)', padding: metrics.s(10)},
    grid:{width:'100%', alignSelf:'stretch', alignItems:'stretch', gap: metrics.sectionGap, flexDirection: stacked ? 'column' : 'row'},
    card:{
      flex: 1,
      minHeight: adaptive.s(stacked ? 150 : 178),
      borderRadius: metrics.panelRadius,
      borderWidth: 1,
      borderColor:'rgba(255,255,255,0.08)',
      backgroundColor:'#050505',
      overflow:'hidden',
      alignItems:'center',
      justifyContent:'center',
      padding: metrics.panelPadding,
    },
    cardInline:{},
    cardStacked:{width:'100%'},
    cardActive:{backgroundColor:'#8F1318', borderColor:'rgba(255,255,255,0.12)'},
    deviceBadge:{width:adaptive.s(72), height:adaptive.s(72), borderRadius:adaptive.s(36), backgroundColor:'rgba(255,255,255,0.08)', alignItems:'center', justifyContent:'center', marginBottom:metrics.s(16)},
    cardTitle:{color:'#FFFFFF', fontSize:metrics.fs(stacked ? 15 : 16), fontWeight:'800', textAlign:'center'},
    switchBox:{width:'100%', alignSelf:'stretch', backgroundColor:'#050505', borderWidth:1, borderColor:'rgba(255,255,255,0.08)', borderRadius:metrics.panelRadius, paddingHorizontal:metrics.panelPadding, paddingVertical:metrics.panelPadding, flexDirection:'row', alignItems:'center', justifyContent:'space-between'},
    switchTextWrap:{flex:1, paddingRight:metrics.s(12)},
    switchTitle:{color:'#FFFFFF', fontSize:metrics.fs(16), fontWeight:'800'},
    switchDescription:{color:'#8C8C8C', marginTop:metrics.s(6), lineHeight:metrics.fs(18)},
  });
};

const LivePlatform = (props: any) => {
  useScreenSystemUI({variant: 'fullscreen', barStyle: 'light-content'});
  const {language} = useContext(LanguageContext);
  const adaptive = useAdaptiveLayout();
  const styles = useMemo(() => createStyles(adaptive), [adaptive.styleKey]);
  const metrics = useMemo(() => getBrandedScreenMetrics(adaptive), [adaptive.styleKey]);
  const [saveToDeviceWhileStreaming, setSaveToDeviceWhileStreaming] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformKey | null>(null);
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {requireAplusPro} = useAplusPro();
  const isCompact = !adaptive.isLandscape || adaptive.width < 1100;


  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
      }
    };
  }, []);

  const localized = useMemo(() => {
    return {
      title: i18n.t('livePlatformTitle'),
      subtitle: i18n.t('livePlatformSubtitle'),
      deviceLabel: i18n.t('liveDeviceLabel'),
      saveBadge: i18n.t('liveSaveBadge'),
      switchTitle: i18n.t('liveSaveSwitchTitle'),
      switchDescription: i18n.t('liveSaveSwitchDescription'),
    };
  }, [language]);

  const ui = useMemo(() => ({
    horizontalPadding: metrics.screenPaddingX,
    topGap: metrics.sectionGap,
    gridGap: metrics.sectionGap,
    iconSize: adaptive.s(isCompact ? 56 : 66),
    titleSize: metrics.fs(isCompact ? 15 : 16),
    subtitleSize: metrics.fs(isCompact ? 12 : 13),
  }), [adaptive, isCompact, metrics]);
  const platformItems: PlatformItem[] = useMemo(() => [{key:'device', label:localized.deviceLabel}, {key:'youtube', label: 'YouTube', image:youtubeLogo}, {key:'facebook', label:'Facebook', image:facebookLogo}], [localized.deviceLabel]);

  const onBack = useCallback(() => { if (typeof props?.goBack === 'function') { props.goBack(); return; } if (typeof props?.navigation?.goBack === 'function') { props.navigation.goBack(); } }, [props]);

  const selectPlatformUnlocked = useCallback(async (platform: PlatformKey) => {
    setSelectedPlatform(platform);

    if (navigationTimeoutRef.current) {
      clearTimeout(navigationTimeoutRef.current);
    }

    navigationTimeoutRef.current = setTimeout(async () => {
      if (platform === 'device') {
        await AsyncStorage.removeItem(CURRENT_PLATFORM_KEY);
        props.navigate?.(screens.gameSettings, {livestreamPlatform: platform, saveToDeviceWhileStreaming});
        return;
      }
      await AsyncStorage.setItem(CURRENT_PLATFORM_KEY, platform);
      const params = {livestreamPlatform: platform, saveToDeviceWhileStreaming};
      if (platform === 'facebook') { props.navigate?.(screens.livePlatformSetupFacebook, params); return; }
      props.navigate?.(screens.livePlatformSetupYoutube, params);
    }, 120);
  }, [props, saveToDeviceWhileStreaming]);

  const onSelectPlatform = useCallback(async (platform: PlatformKey) => {
    if (platform === 'youtube' || platform === 'facebook') {
      requireAplusPro(platform, () => {
        selectPlatformUnlocked(platform);
      });
      return;
    }

    selectPlatformUnlocked(platform);
  }, [requireAplusPro, selectPlatformUnlocked]);

  return (
    <Container style={styles.screen}>
      <View style={styles.headerGlow}>
        <Pressable
          onPress={onBack}
          style={styles.headerBackButton}
          android_ripple={{color:'rgba(255,255,255,0.08)', borderless:false}}>
          <View style={styles.headerBackFrame}>
            <View style={styles.headerBackInner}>
              <AppImage
                source={require('../../assets/images/logo-back.png')}
                resizeMode="contain"
                style={{width: adaptive.s(18), height: adaptive.s(18), marginRight: adaptive.s(8)}}
              />
              <AppImage
                source={images.logoSmall || images.logo}
                resizeMode="contain"
                style={styles.headerBackLogoImage}
              />
            </View>
          </View>
        </Pressable>
        <View pointerEvents="none" style={styles.headerTitleWrap}>
          <Text color={'#FFFFFF'} style={styles.headerTitle}>{localized.title}</Text>
        </View>
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.contentInner}>
          <Text color={'#8C8C8C'} fontSize={ui.subtitleSize}>{localized.subtitle}</Text>
          <View style={styles.gridShell}>
            <View style={styles.grid}> 
              {platformItems.map(item => {
                const isActive = selectedPlatform === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => onSelectPlatform(item.key)}
                    style={[styles.card, isActive && styles.cardActive, isCompact ? styles.cardStacked : styles.cardInline]}>
                    {item.image ? (
                      <Image source={item.image} resizeMode="contain" style={{width: ui.iconSize, height: ui.iconSize, marginBottom: adaptive.s(16)}} />
                    ) : (
                      <View style={styles.deviceBadge}><Text color={'#FFFFFF'} fontWeight={'900'} fontSize={metrics.fs(18)}>{localized.saveBadge}</Text></View>
                    )}
                    <Text color={'#FFFFFF'} style={styles.cardTitle}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={[styles.switchBox, {marginTop: ui.topGap}]}> 
            <View style={styles.switchTextWrap}><Text color={'#FFFFFF'} style={styles.switchTitle}>{localized.switchTitle}</Text><Text color={'#8C8C8C'} style={styles.switchDescription}>{localized.switchDescription}</Text></View>
            <Switch value={saveToDeviceWhileStreaming} onValueChange={setSaveToDeviceWhileStreaming} trackColor={{false:'#2A2A2A', true:'#C91D24'}} thumbColor={saveToDeviceWhileStreaming ? '#FFFFFF' : '#BDBDBD'} ios_backgroundColor="#2A2A2A" />
          </View>
        </View>
      </ScrollView>
    </Container>
  );
};

export default memo(LivePlatform);
