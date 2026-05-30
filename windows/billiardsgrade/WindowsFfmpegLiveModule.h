#pragma once

#include "pch.h"
#include "NativeModules.h"

namespace winrt::billiardsgrade::implementation
{
    REACT_MODULE(WindowsFfmpegLiveModule, L"WindowsFfmpegLiveModule");
    struct WindowsFfmpegLiveModule
    {
        REACT_INIT(Initialize);
        void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept;

        REACT_METHOD(CheckFfmpegAvailable, L"checkFfmpegAvailable");
        void CheckFfmpegAvailable(std::string ffmpegPath, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;

        REACT_METHOD(ListDevices, L"listDevices");
        void ListDevices(std::string ffmpegPath, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;

        REACT_METHOD(Start, L"start");
        void Start(winrt::Microsoft::ReactNative::JSValueObject payload, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;

        REACT_METHOD(Stop, L"stop");
        void Stop(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;

        REACT_METHOD(Status, L"status");
        void Status(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;

        REACT_METHOD(ReleaseCameraForExternalUse, L"releaseCameraForExternalUse");
        winrt::fire_and_forget ReleaseCameraForExternalUse(winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;

        REACT_METHOD(CaptureOverlayView, L"captureOverlayView");
        void CaptureOverlayView(int64_t nativeTag, int32_t width, int32_t height, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

    private:
        winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
    };
}
