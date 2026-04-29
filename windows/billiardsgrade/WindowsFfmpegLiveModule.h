#pragma once

#include "pch.h"
#include "NativeModules.h"

namespace winrt::billiardsgrade::implementation
{
    REACT_MODULE(WindowsFfmpegLiveModule, L"WindowsFfmpegLiveModule");
    struct WindowsFfmpegLiveModule
    {
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
    };
}
