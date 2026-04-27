import {call, put, takeLatest} from 'redux-saga/effects';
import {historyActions, historyTypes} from '../actions/history';
import {BSON} from 'realm';
import {GameSettings} from 'types/settings';
import {DeleteGame} from 'data/realm/RQL/game';
import {deleteReplayFolder} from 'services/replay/localReplay';

const deleteHistory = function* ({payload}: any) {
  const {realm, item} = payload as {
    realm: Realm;
    item: GameSettings & {id: BSON.ObjectId; createdAt: Date; updatedAt: Date};
  };

  if (item.webcamFolderName) {
    yield call(deleteReplayFolder, item.webcamFolderName, {includeArchive: true});
  }

  yield call(DeleteGame, realm, item.id);
  yield put(historyActions.deleteHistorySuccess());
};

const watcher = function* () {
  yield takeLatest(historyTypes.DELETE_HISTORY, deleteHistory);
};

export default watcher();
