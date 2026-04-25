#include "pch.h"
#include "WindowsCameraRecordingModule.h"

#include <winrt/Windows.Media.Capture.h>
#include <winrt/Windows.Media.MediaProperties.h>
#include <winrt/Windows.Storage.h>

using namespace winrt;
using namespace Windows::Media::Capture;
using namespace Windows::Storage;
using namespace Windows::Media::MediaProperties;
using namespace Microsoft::ReactNative;

namespace
{
    void RejectRecordingPromise(ReactPromise<std::string> promise, std::string const &message) noexcept
    {
        auto error = ReactError();
        error.Message = message;
        promise.Reject(error);
    }
}

namespace winrt::billiardsgrade::implementation
{
    Windows::Foundation::IAsyncOperation<winrt::hstring> WindowsCameraStartRecordingAsync(winrt::hstring const &requestedPath);
    Windows::Foundation::IAsyncOperation<winrt::hstring> WindowsCameraStopRecordingAsync();

    winrt::fire_and_forget WindowsCameraRecordingModule::StartRecording(std::string outputPath, ReactPromise<std::string> promise) noexcept
    {
        auto capturedPromise = promise;

        try
        {
            auto actualPath = co_await WindowsCameraStartRecordingAsync(winrt::to_hstring(outputPath));
            capturedPromise.Resolve(winrt::to_string(actualPath));
        }
        catch (hresult_error const &ex)
        {
            RejectRecordingPromise(capturedPromise, winrt::to_string(ex.message()));
        }
        catch (std::exception const &ex)
        {
            RejectRecordingPromise(capturedPromise, ex.what());
        }
        catch (...)
        {
            RejectRecordingPromise(capturedPromise, "Windows camera recording start failed");
        }
    }

    winrt::fire_and_forget WindowsCameraRecordingModule::StopRecording(ReactPromise<std::string> promise) noexcept
    {
        auto capturedPromise = promise;

        try
        {
            auto actualPath = co_await WindowsCameraStopRecordingAsync();
            capturedPromise.Resolve(winrt::to_string(actualPath));
        }
        catch (hresult_error const &ex)
        {
            RejectRecordingPromise(capturedPromise, winrt::to_string(ex.message()));
        }
        catch (std::exception const &ex)
        {
            RejectRecordingPromise(capturedPromise, ex.what());
        }
        catch (...)
        {
            RejectRecordingPromise(capturedPromise, "Windows camera recording stop failed");
        }
    }
}
