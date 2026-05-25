import {useEffect, useMemo, useRef, useState} from 'react';
import {captureRef} from 'react-native-view-shot';
import RNFS from 'react-native-fs';

import {PlayerSettings} from 'types/player';
import {GameSettings} from 'types/settings';
import {
  MATCH_COUNTDOWN,
  MATCH_IMAGE,
  WEBCAM_BASE_CAMERA_FOLDER,
} from 'constants/webcam';

export interface Props {
  isStarted: boolean;
  isPaused: boolean;
  isMatchPaused: boolean;
  goal: number;
  totalTurns: number;
  countdownTime: number;
  currentPlayerIndex: number;
  gameSettings: GameSettings;
  playerSettings: PlayerSettings;
  compact?: boolean;
  /**
   * Keep the small scoreboard drawn inside the camera independent from the
   * normal console scoreboard above the camera.
   */
  cameraOverlay?: boolean;
  /**
   * Fullscreen overlay has its own taller/narrower layout without affecting
   * the normal console scoreboard or the camera overlay.
   */
  fullscreenOverlay?: boolean;
}

const CaromInfoViewModel = (props: Props) => {
  //const matchRef = useRef(null);
  //const matchCountdownRef = useRef(null);

  const [animationStarted, setAnimationStarted] = useState(false);
  const [isResumed, setIsResumed] = useState(false);

  useEffect(() => {
    if (props.isPaused || props.isMatchPaused) {
      setIsResumed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isPaused, props.isMatchPaused]);

  useEffect(() => {
    if (props.countdownTime > (props.gameSettings.mode?.countdownTime || 0)) {
      setAnimationStarted(false);
      return;
    }

    if (props.countdownTime === (props.gameSettings.mode?.countdownTime || 0)) {
      setAnimationStarted(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.countdownTime, props.gameSettings]);

  useEffect(() => {
    if (
      !props.isStarted ||
      props.isPaused ||
      props.isMatchPaused ||
      (!props.isPaused && !isResumed && animationStarted)
    ) {
      return;
    }

    if (isResumed) {
      setIsResumed(false);
    }

    if (!animationStarted) {
      setAnimationStarted(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.isStarted,
    props.isPaused,
    props.isMatchPaused,
    isResumed,
    animationStarted,
  ]);

  // useEffect(() => {
  //   if (
  //     !matchRef.current ||
  //     !matchCountdownRef.current ||
  //     !props.playerSettings ||
  //     props.playerSettings.playingPlayers.length > 2
  //   ) {
  //     return;
  //   }

  //   const timeout = setTimeout(() => {
  //     if (!matchRef.current || !matchCountdownRef.current) {
  //       return;
  //     }

  //     // captureRef(matchRef, {
  //     //   format: 'png',
  //     //   quality: 0.01,
  //     //   width: 128,
  //     // })
  //     //   .then(
  //     //     async uri => {
  //     //       const matchImagePath = `${RNFS.DownloadDirectoryPath}/${WEBCAM_BASE_CAMERA_FOLDER}/${MATCH_IMAGE}`;
  //     //       const _path = uri.slice(7);
  //     //       console.log('path connection', _path);

  //     //       RNFS.copyFile(_path, matchImagePath);
  //     //     },
  //     //     error => console.error('Oops, match info failed', error),
  //     //   )
  //     //   .catch(e => {
  //     //     if (__DEV__) {
  //     //       console.log('Capture match info error', e);
  //     //     }
  //     //   });

  //     clearTimeout(timeout);
  //   }, 1000);

  //   // captureRef(matchCountdownRef, {
  //   //   format: 'png',
  //   //   quality: 0.01,
  //   //   width: 256,
  //   // })
  //   //   .then(
  //   //     async uri => {
  //   //       const matchCountdownImagePath = `${RNFS.DownloadDirectoryPath}/${WEBCAM_BASE_CAMERA_FOLDER}/${MATCH_COUNTDOWN}`;

  //   //       console.log("matchCountdownImagePath" + matchCountdownImagePath)

  //   //       const _path = uri.slice(7);
  //   //       console.log("prh" + _path)

  //   //       RNFS.copyFile(_path, matchCountdownImagePath);
  //   //     },
  //   //     error => console.error('Oops, match countdown failed', error),
  //   //   )
  //   //   .catch(e => {
  //   //     if (__DEV__) {
  //   //       console.log('Capture countdown error', e);
  //   //     }
  //   //   });
  // }, [props.countdownTime, props.playerSettings]);

  return useMemo(() => {
    const currentTotalPoints =
      props.playerSettings.playingPlayers[props.currentPlayerIndex].totalPoint;
    const player0 = props.playerSettings.playingPlayers[0];
    const player1 = props.playerSettings.playingPlayers[1];

    return {
      //matchRef,
      //matchCountdownRef,
      currentTotalPoints,
      player0,
      player1,
    };
  }, [
    // matchRef,
    // matchCountdownRef,
    props.currentPlayerIndex,
    props.playerSettings,
  ]);
};

export default CaromInfoViewModel;
