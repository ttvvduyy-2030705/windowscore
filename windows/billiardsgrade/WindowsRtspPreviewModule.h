#pragma once

#include "pch.h"
#include "NativeModules.h"

namespace winrt::billiardsgrade::implementation
{
    REACT_MODULE(WindowsRtspPreviewModule, L"WindowsRtspPreviewModule");
    struct WindowsRtspPreviewModule
    {
        REACT_METHOD(Start, L"start");
        void Start(winrt::Microsoft::ReactNative::JSValueObject payload, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;

        REACT_METHOD(Stop, L"stop");
        void Stop(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;

        REACT_METHOD(Status, L"status");
        void Status(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;

        REACT_METHOD(StartRecording, L"startRecording");
        void StartRecording(winrt::Microsoft::ReactNative::JSValueObject payload, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;

        REACT_METHOD(StopRecording, L"stopRecording");
        void StopRecording(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;
    };
}
