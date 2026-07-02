import React, {memo} from 'react';
import {TextInput as RNTextInput} from 'react-native';

import Button from 'components/Button';
import Text from 'components/Text';
import Video from 'components/Video';
import View from 'components/View';
import i18n from 'i18n';
import {WebcamType} from 'types/webcam';

import IpCameraConfigViewModel from './IpCameraConfigViewModel';
import styles from './styles';

const Field = ({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'numeric' | 'number-pad' | 'decimal-pad';
}) => (
  <View style={styles.field}>
    <Text color={'#FFFFFF'} style={styles.label}>{label}</Text>
    <RNTextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={'#666B73'}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType || 'default'}
      autoCapitalize={'none'}
      autoCorrect={false}
      style={styles.input}
    />
  </View>
);

const IpCameraConfig = () => {
  const viewModel = IpCameraConfigViewModel();

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View flex={'1'}>
          <Text color={'#FFFFFF'} style={styles.title}>{i18n.t('ipCameraConfig')}</Text>
          <Text color={'#A8A8A8'} style={styles.hint}>{i18n.t('ipCameraHint')}</Text>
        </View>
        <View
          style={[
            styles.statusPill,
            viewModel.config.enabled ? styles.statusPillActive : undefined,
          ]}>
          <Text color={'#FFFFFF'} style={styles.statusText}>
            {viewModel.config.enabled ? i18n.t('configured') : i18n.t('notConfigured')}
          </Text>
        </View>
      </View>

      <View style={styles.templateBox}>
        <Text color={'#FFFFFF'} style={styles.templateTitle}>{i18n.t('ipCameraTemplate')}</Text>
        <Text color={'#A8A8A8'} style={styles.templateNote}>{i18n.t('ipCameraTemplateNote')}</Text>
      </View>

      <View style={styles.simpleBox}>
        <Field
          label={i18n.t('ipCameraAddress')}
          value={viewModel.config.ipAddress}
          onChangeText={viewModel.onChangeIpAddress}
          placeholder={'192.168.1.50'}
        />
        <Field
          label={i18n.t('ipCameraSafetyCode')}
          value={viewModel.config.password}
          onChangeText={viewModel.onChangePassword}
          placeholder={'Safety Code / mật khẩu camera'}
          secureTextEntry
        />
        <Field
          label={i18n.t('ipCameraCustomRtsp')}
          value={viewModel.config.customRtspUrl}
          onChangeText={viewModel.onChangeCustomRtspUrl}
          placeholder={'rtsp://admin:***@192.168.1.50:554/cam/realmonitor?channel=1&subtype=0'}
        />
      </View>

      <Text color={'#8D8D8D'} style={styles.noteText}>
        {i18n.t('ipCameraSimpleNote')}
      </Text>

      <View direction={'row'} alignItems={'center'} style={styles.actionRow}>
        <Button style={styles.clearButton} onPress={viewModel.onTest}>
          <Text color={'#FFFFFF'} style={styles.clearText}>{i18n.t('test')}</Text>
        </Button>
        <Button
          style={[styles.saveButton, !viewModel.canSave ? styles.saveButtonDisabled : undefined]}
          onPress={viewModel.canSave ? viewModel.onSave : undefined}>
          <Text color={'#FFFFFF'} style={styles.saveText}>{i18n.t('saveConfig')}</Text>
        </Button>
        <Button style={styles.clearButton} onPress={viewModel.onClear}>
          <Text color={'#FFFFFF'} style={styles.clearText}>{i18n.t('clearConfig')}</Text>
        </Button>
        {viewModel.savedMessageVisible ? (
          <Text color={'#23D447'} style={styles.savedText}>{i18n.t('ipCameraSaved')}</Text>
        ) : null}
      </View>

      {viewModel.testMessage ? (
        <Text color={viewModel.testStatus === 'success' || viewModel.testStatus === 'loading' ? '#23D447' : '#FF5A5F'} style={styles.noteText}>
          {viewModel.testMessage}
        </Text>
      ) : null}

      {viewModel.testUrl ? (
        <View style={styles.previewBox}>
          <Video
            webcamType={WebcamType.webcam}
            source={{uri: viewModel.testUrl, type: 'rtsp', rtspCandidates: viewModel.testCandidates} as any}
            isStarted={false}
            isPaused={false}
            isPreview={false}
            setIsCameraReady={() => {}}
            onLoad={viewModel.onTestLoad}
            onError={viewModel.onTestError}
            suppressCameraFallbackOverlay
          />
        </View>
      ) : null}
    </View>
  );
};

export default memo(IpCameraConfig);
