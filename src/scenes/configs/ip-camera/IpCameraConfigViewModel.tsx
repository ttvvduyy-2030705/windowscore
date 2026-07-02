import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  DEFAULT_IP_CAMERA_CONFIG,
  IpCameraConfig,
  buildRtspCameraCandidates,
  loadIpCameraConfig,
  normalizeIpCameraConfig,
  saveIpCameraConfig,
} from 'services/camera/ipCameraConfig';

const IpCameraConfigViewModel = () => {
  const [config, setConfig] = useState<IpCameraConfig>(DEFAULT_IP_CAMERA_CONFIG);
  const [savedMessageVisible, setSavedMessageVisible] = useState(false);
  const [testUrl, setTestUrl] = useState('');
  const [testCandidates, setTestCandidates] = useState<string[]>([]);
  const [testMessage, setTestMessage] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  useEffect(() => {
    let mounted = true;

    loadIpCameraConfig()
      .then(value => {
        if (mounted) {
          setConfig(normalizeIpCameraConfig(value));
        }
      })
      .catch(error => {
        console.log('[IPCameraConfig] load failed:', error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const updateField = useCallback(
    (field: keyof IpCameraConfig) => (value: string | boolean) => {
      setSavedMessageVisible(false);
      setTestMessage('');
      setTestStatus('idle');
      setTestUrl('');
      setTestCandidates([]);
      setConfig(prev => normalizeIpCameraConfig({...prev, [field]: value}));
    },
    [],
  );

  const onSave = useCallback(async () => {
    const normalized = normalizeIpCameraConfig({
      ...config,
      enabled: Boolean((config.ipAddress && config.password) || config.customRtspUrl),
      name: config.name || 'Camera IP',
    });
    const saved = await saveIpCameraConfig(normalized);
    setConfig(saved);
    setSavedMessageVisible(true);
  }, [config]);

  const onTest = useCallback(() => {
    const normalized = normalizeIpCameraConfig({
      ...config,
      enabled: Boolean((config.ipAddress && config.password) || config.customRtspUrl),
    });
    const candidates = buildRtspCameraCandidates(normalized);
    const nextUrl = candidates[0] || '';
    setTestCandidates(candidates);
    setTestUrl(nextUrl);
    setTestStatus(nextUrl ? 'loading' : 'error');
    setTestMessage(nextUrl ? 'Đang kiểm tra camera...' : 'Chưa đủ thông tin RTSP để kiểm tra.');
    console.log('[IPCameraConfig] test-connect', {
      configured: Boolean(nextUrl),
      candidateCount: candidates.length,
    });
  }, [config]);

  const onTestLoad = useCallback(() => {
    setTestStatus('success');
    setTestMessage('Kết nối camera thành công.');
    console.log('[IPCameraConfig] test-success');
  }, []);

  const onTestError = useCallback((error: any) => {
    setTestStatus('error');
    setTestMessage('Không mở được camera. Kiểm tra IP/Safety Code/mật khẩu, RTSP và FFmpeg.');
    console.log('[IPCameraConfig] test-error', error);
  }, []);


  const onClear = useCallback(async () => {
    const saved = await saveIpCameraConfig(DEFAULT_IP_CAMERA_CONFIG);
    setConfig(saved);
    setSavedMessageVisible(false);
    setTestMessage('');
    setTestStatus('idle');
    setTestUrl('');
    setTestCandidates([]);
  }, []);

  const canSave = Boolean((config.ipAddress && config.password) || config.customRtspUrl);

  return useMemo(
    () => ({
      config,
      savedMessageVisible,
      testUrl,
      testCandidates,
      testMessage,
      testStatus,
      canSave,
      onChangeIpAddress: updateField('ipAddress'),
      onChangePassword: updateField('password'),
      onChangeCustomRtspUrl: updateField('customRtspUrl'),
      onSave,
      onClear,
      onTest,
      onTestLoad,
      onTestError,
    }),
    [
      config,
      savedMessageVisible,
      testUrl,
      testCandidates,
      testMessage,
      testStatus,
      canSave,
      updateField,
      onSave,
      onClear,
      onTest,
      onTestLoad,
      onTestError,
    ],
  );
};

export default IpCameraConfigViewModel;
