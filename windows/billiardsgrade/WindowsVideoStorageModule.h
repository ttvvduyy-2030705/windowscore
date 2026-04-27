#pragma once

#include "pch.h"
#include "NativeModules.h"

namespace winrt::billiardsgrade::implementation
{
    REACT_MODULE(WindowsVideoStorageModule, L"WindowsVideoStorageModule");
    struct WindowsVideoStorageModule
    {
        REACT_METHOD(GetFallbackBaseDir, L"getFallbackBaseDir");
        void GetFallbackBaseDir(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

        REACT_METHOD(Exists, L"exists");
        void Exists(std::string path, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;

        REACT_METHOD(Mkdir, L"mkdir");
        void Mkdir(std::string path, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;

        REACT_METHOD(ReadDir, L"readDir");
        void ReadDir(std::string path, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

        REACT_METHOD(Stat, L"stat");
        void Stat(std::string path, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

        REACT_METHOD(ReadFile, L"readFile");
        void ReadFile(std::string path, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

        REACT_METHOD(WriteFile, L"writeFile");
        void WriteFile(std::string path, std::string content, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;

        REACT_METHOD(AppendFile, L"appendFile");
        void AppendFile(std::string path, std::string content, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;

        REACT_METHOD(Unlink, L"unlink");
        void Unlink(std::string path, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;

        REACT_METHOD(CopyFile, L"copyFile");
        void CopyFile(std::string from, std::string to, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;

        REACT_METHOD(MoveFile, L"moveFile");
        void MoveFile(std::string from, std::string to, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;
    };
}
