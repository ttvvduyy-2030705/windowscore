import React, {memo} from 'react';
import {Switch as RNSwitch} from 'react-native';
import SwitchViewModel, {Props} from './SwitchViewModel';

const Switch = (props: Props) => {
  const viewModel = SwitchViewModel(props);

  return (
    <RNSwitch
      value={viewModel.value}
      onValueChange={viewModel.onToggle}
      trackColor={{false: '#535760', true: '#0A84FF'}}
      thumbColor={viewModel.value ? '#FFFFFF' : '#F2F2F2'}
      ios_backgroundColor={'#535760'}
    />
  );
};

export default memo(Switch);
