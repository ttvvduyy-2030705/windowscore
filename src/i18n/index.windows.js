import AsyncStorage from '@react-native-async-storage/async-storage';
import {I18n} from 'i18n-js';
import Numeral from 'numeral';
import 'numeral/locales';

import vi from './vi';
import en from './en';

const i18n = new I18n({vi, en});

export const LANGUAGES = ['vi', 'en'];

export const loadLanguage = async () => {
  const currentLanguage = await AsyncStorage.getItem('language');

  console.log('[Windows i18n] lang ' + currentLanguage);

  const systemLanguage = 'vi';

  const language =
    currentLanguage && LANGUAGES.includes(currentLanguage)
      ? currentLanguage
      : LANGUAGES.includes(systemLanguage)
        ? systemLanguage
        : 'vi';

  Numeral.locale(language);

  i18n.locale = language;
  i18n.defaultLocale = 'vi';
  i18n.translations = {vi, en};

  return language;
};

export const setLanguage = async language => {
  i18n.defaultLocale = language;
  i18n.locale = language;
  Numeral.locale(language);

  await AsyncStorage.setItem('language', language);
};

export default i18n;