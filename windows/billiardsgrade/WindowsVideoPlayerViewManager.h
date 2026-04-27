#pragma once

#include "pch.h"

namespace winrt::billiardsgrade::implementation
{
    struct WindowsVideoPlayerViewManager :
        winrt::implements<
            WindowsVideoPlayerViewManager,
            winrt::Microsoft::ReactNative::IViewManager,
            winrt::Microsoft::ReactNative::IViewManagerWithNativeProperties>
    {
        winrt::hstring Name() noexcept;
        winrt::Windows::UI::Xaml::FrameworkElement CreateView() noexcept;

        winrt::Windows::Foundation::Collections::IMapView<
            winrt::hstring,
            winrt::Microsoft::ReactNative::ViewManagerPropertyType>
        NativeProps() noexcept;

        void UpdateProperties(
            winrt::Windows::UI::Xaml::FrameworkElement const &view,
            winrt::Microsoft::ReactNative::IJSValueReader const &propertyMapReader) noexcept;
    };
}
