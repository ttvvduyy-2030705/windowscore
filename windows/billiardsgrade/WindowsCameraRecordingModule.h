#pragma once

#include "pch.h"
#include "NativeModules.h"

namespace winrt::billiardsgrade::implementation
{
    REACT_MODULE(WindowsCameraRecordingModule, L"WindowsCameraRecordingModule");
    struct WindowsCameraRecordingModule
    {
        REACT_METHOD(StartRecording, L"startRecording");
        winrt::fire_and_forget StartRecording(std::string outputPath, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

        REACT_METHOD(StopRecording, L"stopRecording");
        winrt::fire_and_forget StopRecording(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;
    };
}
