#include "pch.h"
#include "ReactPackageProvider.h"
#include "NativeModules.h"
#include "WindowsCameraViewManager.h"
#include "WindowsCameraRecordingModule.h"
#include "WindowsVideoStorageModule.h"
#include "WindowsVideoPlayerViewManager.h"
#include "WindowsFfmpegLiveModule.h"
#include "WindowsRemoteControlModule.h"

using namespace winrt::Microsoft::ReactNative;

namespace winrt::billiardsgrade::implementation
{

void ReactPackageProvider::CreatePackage(IReactPackageBuilder const &packageBuilder) noexcept
{
    // Register app-local attributed modules as classic NativeModules so JS can access them via NativeModules.
    // Passing true registers TurboModules only, which made WindowsCameraRecordingModule unavailable
    // to the existing JS recording path.
    AddAttributedModules(packageBuilder, false);
    packageBuilder.AddViewManager(L"WindowsCameraView", []() -> IViewManager { return winrt::make<WindowsCameraViewManager>(); });
    packageBuilder.AddViewManager(L"WindowsVideoPlayerView", []() -> IViewManager { return winrt::make<WindowsVideoPlayerViewManager>(); });
}

} // namespace winrt::billiardsgrade::implementation
