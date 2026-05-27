#pragma once

#include "pch.h"
#include "NativeModules.h"

namespace winrt::billiardsgrade::implementation
{
    // One Windows module for both parts of the remote flow:
    // 1) BLE scan/connect/notification, matching the Bluetooth remote flow in billiardsgrade.
    // 2) HID fallback for remotes that Windows exposes as a Bluetooth keyboard/media device.
    REACT_MODULE(RemoteControlModule, L"RemoteControl");
    struct RemoteControlModule
    {
        REACT_INIT(Initialize);
        void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept;

        REACT_METHOD(StartListening, L"startListening");
        void StartListening() noexcept;

        REACT_METHOD(SetEnabled, L"setEnabled");
        void SetEnabled(bool enabled) noexcept;

        REACT_METHOD(ScanAndConnect, L"scanAndConnect");
        winrt::fire_and_forget ScanAndConnect(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;

        REACT_METHOD(Disconnect, L"disconnect");
        winrt::fire_and_forget Disconnect(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;

        REACT_METHOD(Ping, L"ping");
        void Ping() noexcept {}

        // Required by NativeEventEmitter on RN/RNW.
        REACT_METHOD(AddListener, L"addListener");
        void AddListener(std::string eventName) noexcept;

        REACT_METHOD(RemoveListeners, L"removeListeners");
        void RemoveListeners(double count) noexcept;
    };
}
