#include "pch.h"
#include "ReactPackageProvider.h"
#include "NativeModules.h"
#include "WindowsCameraViewManager.h"
#include "WindowsCameraRecordingModule.h"

using namespace winrt::Microsoft::ReactNative;

namespace winrt::billiardsgrade::implementation
{

void ReactPackageProvider::CreatePackage(IReactPackageBuilder const &packageBuilder) noexcept
{
    AddAttributedModules(packageBuilder, true);
    packageBuilder.AddViewManager(L"WindowsCameraView", []() -> IViewManager { return winrt::make<WindowsCameraViewManager>(); });
}

} // namespace winrt::billiardsgrade::implementation
