#pragma once

#include "pch.h"

namespace winrt::billiardsgrade::implementation
{
    struct WindowsCameraViewManager : winrt::implements<WindowsCameraViewManager, winrt::Microsoft::ReactNative::IViewManager>
    {
        winrt::hstring Name() noexcept;
        winrt::Windows::UI::Xaml::FrameworkElement CreateView() noexcept;
    };
} // namespace winrt::billiardsgrade::implementation
