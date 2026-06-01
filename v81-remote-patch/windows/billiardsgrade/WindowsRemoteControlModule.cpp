#include "pch.h"
#include "WindowsRemoteControlModule.h"

#include <algorithm>
#include <cctype>
#include <iomanip>
#include <cwctype>
#include <memory>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#ifndef APLUS_REMOTE_LOWLEVEL_KEYBOARD_HOOK_AVAILABLE
#if defined(WINAPI_FAMILY_PARTITION) && WINAPI_FAMILY_PARTITION(WINAPI_PARTITION_DESKTOP)
#define APLUS_REMOTE_LOWLEVEL_KEYBOARD_HOOK_AVAILABLE 1
#else
#define APLUS_REMOTE_LOWLEVEL_KEYBOARD_HOOK_AVAILABLE 0
#endif
#endif

#include <winrt/Windows.ApplicationModel.Core.h>
#include <winrt/Windows.Devices.Bluetooth.h>
#include <winrt/Windows.Devices.Bluetooth.Advertisement.h>
#include <winrt/Windows.Devices.Bluetooth.GenericAttributeProfile.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.UI.Core.h>
#include <winrt/Windows.UI.Xaml.Controls.h>
#include <winrt/Windows.UI.Xaml.Input.h>

using namespace winrt;
using namespace winrt::Microsoft::ReactNative;
using namespace winrt::Windows::ApplicationModel::Core;
using namespace winrt::Windows::Devices::Bluetooth;
using namespace winrt::Windows::Devices::Bluetooth::Advertisement;
using namespace winrt::Windows::Devices::Bluetooth::GenericAttributeProfile;
using namespace winrt::Windows::Storage::Streams;
using namespace winrt::Windows::System;
using namespace winrt::Windows::UI::Core;
using namespace winrt::Windows::UI::Xaml;
using namespace winrt::Windows::UI::Xaml::Controls;
using namespace winrt::Windows::UI::Xaml::Input;

namespace
{
    struct BleSubscription
    {
        GattCharacteristic characteristic{nullptr};
        winrt::event_token token{};
    };

    std::mutex g_remoteMutex;
    std::shared_ptr<ReactContext> g_reactContext;
    bool g_enabled = false;
    bool g_keyboardHooked = false;
    bool g_scanActive = false;
    bool g_connecting = false;
    winrt::event_token g_keyDownToken{};
    winrt::event_token g_keyUpToken{};
    winrt::event_token g_acceleratorKeyToken{};
    winrt::event_token g_characterReceivedToken{};
    BluetoothLEAdvertisementWatcher g_watcher{nullptr};
    winrt::event_token g_watcherReceivedToken{};
    winrt::event_token g_watcherStoppedToken{};
    BluetoothLEDevice g_bleDevice{nullptr};
    std::vector<BleSubscription> g_bleSubscriptions;
    std::wstring g_connectedDeviceName;
    uint64_t g_connectedBluetoothAddress = 0;
    std::string g_lastBleLogicalKey;
    bool g_bleLogicalKeyDown = false;
#if APLUS_REMOTE_LOWLEVEL_KEYBOARD_HOOK_AVAILABLE
    HHOOK g_lowLevelKeyboardHook = nullptr;
    std::set<DWORD> g_lowLevelDownKeys;
#endif

    std::wstring ToLower(std::wstring value)
    {
        std::transform(value.begin(), value.end(), value.begin(), [](wchar_t ch) {
            return static_cast<wchar_t>(std::towlower(ch));
        });
        return value;
    }

    bool Contains(std::wstring const &value, std::wstring const &needle)
    {
        return ToLower(value).find(ToLower(needle)) != std::wstring::npos;
    }

    bool IsTargetRemoteName(std::wstring const &name)
    {
        // Same names as DiscoverableDevices in src/types/bluetooth.tsx from billiardsgrade.
        return Contains(name, L"AJBHJZ001") ||
               Contains(name, L"MOCUTE-052Fe-AUTO") ||
               Contains(name, L"M585/M590") ||
               Contains(name, L"MOCUTE") ||
               Contains(name, L"APLU") ||
               Contains(name, L"REMOTE");
    }

    std::string Narrow(std::wstring const &value)
    {
        return winrt::to_string(winrt::hstring(value));
    }

    void RejectPromise(ReactPromise<JSValueObject> const &promise, std::string const &message) noexcept
    {
        auto error = ReactError();
        error.Message = message;
        promise.Reject(error);
    }

    std::string BytesToHex(std::vector<uint8_t> const &bytes)
    {
        std::ostringstream stream;
        for (size_t i = 0; i < bytes.size(); ++i)
        {
            if (i > 0)
            {
                stream << " ";
            }
            stream << std::uppercase << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(bytes[i]);
        }
        return stream.str();
    }

    std::string BytesToText(std::vector<uint8_t> const &bytes)
    {
        std::string text;
        text.reserve(bytes.size());
        for (auto byte : bytes)
        {
            if (byte >= 32 && byte <= 126)
            {
                text.push_back(static_cast<char>(byte));
            }
        }
        return text;
    }

    std::string TrimUpper(std::string value)
    {
        auto trimLeft = std::find_if(value.begin(), value.end(), [](unsigned char ch) { return !std::isspace(ch); });
        auto trimRight = std::find_if(value.rbegin(), value.rend(), [](unsigned char ch) { return !std::isspace(ch); }).base();
        if (trimLeft >= trimRight)
        {
            return "";
        }
        std::string trimmed(trimLeft, trimRight);
        std::transform(trimmed.begin(), trimmed.end(), trimmed.begin(), [](unsigned char ch) { return static_cast<char>(std::toupper(ch)); });
        return trimmed;
    }

    std::string LogicalKeyFromString(std::string raw)
    {
        auto key = TrimUpper(raw);
        std::replace(key.begin(), key.end(), '-', '_');
        std::replace(key.begin(), key.end(), ' ', '_');

        if (key.empty())
        {
            return "";
        }

        if (key == "19" || key == "38" || key == "UP" || key == "DPAD_UP" || key == "ARROW_UP" || key == "VK_UP")
            return "UP";
        if (key == "20" || key == "40" || key == "DOWN" || key == "DPAD_DOWN" || key == "ARROW_DOWN" || key == "VK_DOWN")
            return "DOWN";
        if (key == "21" || key == "37" || key == "LEFT" || key == "DPAD_LEFT" || key == "ARROW_LEFT" || key == "VK_LEFT")
            return "LEFT";
        if (key == "22" || key == "39" || key == "RIGHT" || key == "DPAD_RIGHT" || key == "ARROW_RIGHT" || key == "VK_RIGHT")
            return "RIGHT";

        if (key == "24" || key == "EXTENSION" || key == "EXTRA_TIME" || key == "ADD_TIME")
            return "EXTENSION";
        if (key == "175" || key == "VOLUME_UP")
            return "EXTENSION";
        if (key == "25" || key == "TIMER" || key == "TIME" || key == "CLOCK")
            return "TIMER";
        if (key == "174" || key == "VOLUME_DOWN")
            return "TIMER";
        if (key == "29" || key == "85" || key == "126" || key == "127" || key == "179" || key == "START" || key == "PLAY" || key == "PAUSE" || key == "PLAY_PAUSE" || key == "MEDIA_PLAY" || key == "MEDIA_PLAY_PAUSE" || key == "MEDIA_PAUSE")
            return "START";
        if (key == "30" || key == "88" || key == "177" || key == "WARM" || key == "WARMUP" || key == "WARM_UP" || key == "MEDIA_PREVIOUS" || key == "MEDIA_PREVIOUS_TRACK" || key == "MEDIA_REWIND")
            return "WARM_UP";
        if (key == "31" || key == "67" || key == "86" || key == "169" || key == "173" || key == "178" || key == "183" || key == "STOP" || key == "MEDIA_STOP" || key == "VOLUME_MUTE" || key == "MEDIA_MUTE" || key == "BROWSER_STOP" || key == "BROWSER_SEARCH")
            return "STOP";
        if (key == "32" || key == "82" || key == "87" || key == "90" || key == "166" || key == "167" || key == "176" || key == "180" || key == "181" || key == "182" || key == "BREAK" || key == "MEDIA_NEXT" || key == "MEDIA_NEXT_TRACK" || key == "MEDIA_FAST_FORWARD" || key == "BROWSER_BACK" || key == "BROWSER_FORWARD" || key == "LAUNCH_MAIL" || key == "LAUNCH_MEDIA_SELECT" || key == "LAUNCH_APP1" || key == "LAUNCH_APP2")
            return "BREAK";
        if (key == "23" || key == "66" || key == "13" || key == "160" || key == "NEWGAME" || key == "NEW_GAME" || key == "RESET" || key == "RESTART" || key == "ENTER" || key == "OK" || key == "DPAD_CENTER" || key == "CENTER")
            return "NEW_GAME";

        return "";
    }

    std::string LogicalKeyFromByte(uint8_t byte)
    {
        // Android KeyEvent codes used by billiardsgrade remote.
        switch (byte)
        {
        case 19:
            return "UP";
        case 20:
            return "DOWN";
        case 21:
            return "LEFT";
        case 22:
            return "RIGHT";
        case 24:
            return "EXTENSION";
        case 25:
            return "TIMER";
        case 29:
            return "START";
        case 30:
            return "WARM_UP";
        case 31:
            return "STOP";
        case 32:
            return "BREAK";
        case 23:
        case 66:
            return "NEW_GAME";
        case 85:
        case 126:
        case 127:
        case 179:
        case 205: // common consumer HID low byte for play/pause
            return "START";
        case 86:
        case 169:
        case 173:
        case 178:
        case 183: // common consumer HID low byte for stop
            return "STOP";
        case 87:
        case 90:
        case 166:
        case 167:
        case 176:
        case 180:
        case 181:
        case 182: // next/launch/browser keys used by some remotes for Break
            return "BREAK";
        case 88:
        case 177:
        case 182: // previous track
            return "WARM_UP";
        default:
            break;
        }

        // Some BLE button boards send ASCII letters or Windows virtual key values.
        auto textKey = LogicalKeyFromString(std::string(1, static_cast<char>(byte)));
        if (!textKey.empty())
        {
            return textKey;
        }

        return LogicalKeyFromString(std::to_string(static_cast<int>(byte)));
    }

    std::string LogicalKeyFromBleBytes(std::vector<uint8_t> const &bytes)
    {
        if (bytes.empty())
        {
            return "";
        }

        auto text = BytesToText(bytes);
        if (!text.empty())
        {
            auto direct = LogicalKeyFromString(text);
            if (!direct.empty())
            {
                return direct;
            }
        }

        // Prefer the last non-zero byte because many BLE button reports are [header, reportId, key].
        for (auto iterator = bytes.rbegin(); iterator != bytes.rend(); ++iterator)
        {
            if (*iterator == 0)
            {
                continue;
            }

            auto logical = LogicalKeyFromByte(*iterator);
            if (!logical.empty())
            {
                return logical;
            }
        }

        return "";
    }

    bool IsTextInputFocused() noexcept
    {
        try
        {
            auto focused = FocusManager::GetFocusedElement();
            if (!focused)
            {
                return false;
            }

            if (focused.try_as<TextBox>() || focused.try_as<PasswordBox>() || focused.try_as<RichEditBox>())
            {
                return true;
            }
        }
        catch (...)
        {
        }

        return false;
    }

    std::shared_ptr<ReactContext> CurrentReactContext()
    {
        std::lock_guard<std::mutex> lock(g_remoteMutex);
        return g_reactContext;
    }

    void EmitJSEvent(std::wstring const &eventName, JSValueObject payload)
    {
        auto reactContext = CurrentReactContext();
        if (!reactContext)
        {
            return;
        }

        try
        {
            reactContext->EmitJSEvent(L"RCTDeviceEventEmitter", winrt::hstring(eventName), std::move(payload));
        }
        catch (...)
        {
        }
    }

    void EmitRemoteStatus(std::string const &status, std::string const &message = "")
    {
        JSValueObject payload;
        payload["status"] = JSValue(status);
        payload["message"] = JSValue(message);
        payload["enabled"] = JSValue(g_enabled);
        payload["scanActive"] = JSValue(g_scanActive);
        payload["connecting"] = JSValue(g_connecting);
        payload["deviceName"] = JSValue(Narrow(g_connectedDeviceName));
        payload["bluetoothAddress"] = JSValue(static_cast<double>(g_connectedBluetoothAddress));
        EmitJSEvent(L"onRemoteStatus", std::move(payload));
    }

    void EmitRemoteKey(
        std::string const &logicalKey,
        int action,
        int keyCodeInt,
        int scanCode,
        std::string const &source,
        std::string const &keyName = "",
        int repeatCount = 0,
        std::string const &hex = "",
        std::string const &text = "",
        std::string const &serviceUuid = "",
        std::string const &characteristicUuid = "")
    {
        if (!g_enabled || logicalKey.empty())
        {
            return;
        }

        JSValueObject payload;
        payload["keyCode"] = JSValue(logicalKey);
        payload["keyCodeInt"] = JSValue(keyCodeInt);
        payload["scanCode"] = JSValue(scanCode);
        payload["action"] = JSValue(action);
        payload["repeatCount"] = JSValue(repeatCount);
        payload["key"] = JSValue(keyName.empty() ? logicalKey : keyName);
        payload["resolvedKey"] = JSValue(logicalKey);
        payload["code"] = JSValue(keyName.empty() ? logicalKey : keyName);
        payload["source"] = JSValue(source);

        if (!hex.empty())
        {
            payload["hex"] = JSValue(hex);
        }
        if (!text.empty())
        {
            payload["text"] = JSValue(text);
        }
        if (!serviceUuid.empty())
        {
            payload["serviceUUID"] = JSValue(serviceUuid);
        }
        if (!characteristicUuid.empty())
        {
            payload["characteristicUUID"] = JSValue(characteristicUuid);
        }

        EmitJSEvent(action == 1 ? L"onRemoteKeyUp" : L"onRemoteKeyDown", std::move(payload));
    }

    std::string LogicalKeyFromVirtualKey(VirtualKey key)
    {
        switch (static_cast<int>(key))
        {
        case 38:
            return "UP";
        case 40:
            return "DOWN";
        case 37:
            return "LEFT";
        case 39:
            return "RIGHT";
        case 32:
        case 65:
        case 80:
        case 179:
            return "START";
        case 83:
        case 169:
        case 173:
        case 178:
        case 183:
            return "STOP";
        case 166:
        case 167:
        case 176:
        case 180:
        case 181:
        case 182:
            return "BREAK";
        case 66: // APLUS remote WARM UP sends keyboard B on Windows
        case 87:
        case 177:
            return "WARM_UP";
        case 69:
        case 107:
            return "EXTENSION";
        case 175: // Real Windows HID mapping: physical Thêm giờ sends VolumeUp.
            return "EXTENSION";
        case 84:
        case 109:
            return "TIMER";
        case 174: // Real Windows HID mapping: physical Bấm giờ sends VolumeDown.
            return "TIMER";
        case 13:
        case 30:
        case 41:
        case 78:
            return "NEW_GAME";
        default:
            return "";
        }
    }

    std::string VirtualKeyName(VirtualKey key)
    {
        switch (static_cast<int>(key))
        {
        case 38:
            return "UP";
        case 40:
            return "DOWN";
        case 37:
            return "LEFT";
        case 39:
            return "RIGHT";
        case 32:
            return "SPACE";
        case 65:
            return "A";
        case 66:
            return "B";
        case 222:
            return "APOSTROPHE";
        case 13:
            return "ENTER";
        case 30:
            return "ACCEPT";
        case 41:
            return "SELECT";
        case 179:
            return "MEDIA_PLAY_PAUSE";
        case 166:
            return "BROWSER_BACK";
        case 167:
            return "BROWSER_FORWARD";
        case 169:
            return "BROWSER_STOP";
        case 178:
            return "MEDIA_STOP";
        case 180:
            return "LAUNCH_MAIL";
        case 181:
            return "LAUNCH_MEDIA_SELECT";
        case 182:
            return "LAUNCH_APP1";
        case 183:
            return "LAUNCH_APP2";
        case 176:
            return "MEDIA_NEXT_TRACK";
        case 177:
            return "MEDIA_PREVIOUS_TRACK";
        case 175:
            return "VOLUME_UP";
        case 174:
            return "VOLUME_DOWN";
        case 173:
            return "VOLUME_MUTE";
        default:
            return std::to_string(static_cast<int>(key));
        }
    }

    bool IsAplusRemoteNoiseKey(VirtualKey key)
    {
        // Some APLUS remote WARM UP presses emit an apostrophe before B.
        // Swallow it while remote control mode is enabled so it does not type into inputs.
        return static_cast<int>(key) == 222;
    }

    void EmitHidRemoteEvent(std::wstring const &, CoreWindow const &, KeyEventArgs const &args, int action)
    {
        if (!g_enabled)
        {
            return;
        }

        auto key = args.VirtualKey();
        auto logicalKey = LogicalKeyFromVirtualKey(key);

        if (logicalKey.empty())
        {
            if (IsAplusRemoteNoiseKey(key))
            {
                args.Handled(true);
            }
            return;
        }

        // Important for this real APLUS Bluetooth remote: Windows exposes it as a HID
        // keyboard/media device. Mark handled so START/WARM UP do not type "aaaa"/"bb"
        // and arrow/media keys do not get consumed by the focused input/system volume.
        args.Handled(true);

        auto status = args.KeyStatus();
        auto keyName = VirtualKeyName(key);
        auto repeatCount = static_cast<int>(status.RepeatCount > 0 ? status.RepeatCount - 1 : 0);
        EmitRemoteKey(logicalKey, action, static_cast<int>(key), static_cast<int>(status.ScanCode), "windows-hid", keyName, repeatCount);
    }

    bool IsAcceleratorRemoteKey(VirtualKey key)
    {
        switch (static_cast<int>(key))
        {
        case 166: // BrowserBack
        case 167: // BrowserForward
        case 169: // BrowserStop
        case 173: // VolumeMute
        case 174: // VolumeDown
        case 175: // VolumeUp
        case 176: // MediaNextTrack
        case 177: // MediaPreviousTrack
        case 178: // MediaStop
        case 179: // MediaPlayPause
        case 180: // LaunchMail
        case 181: // LaunchMediaSelect
        case 182: // LaunchApp1
        case 183: // LaunchApp2
        case 205: // Play/Pause on some SDKs/remotes
            return true;
        default:
            return false;
        }
    }

    void EmitAcceleratorRemoteEvent(CoreDispatcher const &, AcceleratorKeyEventArgs const &args)
    {
        if (!g_enabled)
        {
            return;
        }

        auto key = args.VirtualKey();
        if (!IsAcceleratorRemoteKey(key))
        {
            return;
        }

        auto logicalKey = LogicalKeyFromVirtualKey(key);
        if (logicalKey.empty())
        {
            return;
        }

        auto eventType = args.EventType();
        bool isKeyDown = eventType == CoreAcceleratorKeyEventType::KeyDown ||
                         eventType == CoreAcceleratorKeyEventType::SystemKeyDown;
        bool isKeyUp = eventType == CoreAcceleratorKeyEventType::KeyUp ||
                       eventType == CoreAcceleratorKeyEventType::SystemKeyUp;

        if (!isKeyDown && !isKeyUp)
        {
            return;
        }

        // This is the important part for the APLUS remote on Windows:
        // This remote exposes Bấm giờ / Thêm giờ as system volume keys on Windows.
        // Marking the accelerator as handled prevents Windows from changing system volume
        // and lets the scoreboard receive the button press instead.
        args.Handled(true);

        auto status = args.KeyStatus();
        auto keyName = VirtualKeyName(key);
        auto repeatCount = static_cast<int>(status.RepeatCount > 0 ? status.RepeatCount - 1 : 0);
        EmitRemoteKey(logicalKey, isKeyUp ? 1 : 0, static_cast<int>(key), static_cast<int>(status.ScanCode), "windows-hid-accelerator", keyName, repeatCount);
    }

    void SwallowAplusRemoteCharacters(CoreWindow const &, CharacterReceivedEventArgs const &args)
    {
        if (!g_enabled)
        {
            return;
        }

        auto ch = static_cast<uint32_t>(args.KeyCode());
        if (ch == static_cast<uint32_t>('a') ||
            ch == static_cast<uint32_t>('A') ||
            ch == static_cast<uint32_t>('b') ||
            ch == static_cast<uint32_t>('B') ||
            ch == static_cast<uint32_t>('\''))
        {
            args.Handled(true);
        }
    }

#if APLUS_REMOTE_LOWLEVEL_KEYBOARD_HOOK_AVAILABLE
    bool IsLowLevelRemoteVirtualKey(DWORD vkCode)
    {
        switch (vkCode)
        {
        case VK_UP:
        case VK_DOWN:
        case VK_LEFT:
        case VK_RIGHT:
        case VK_RETURN:
        case VK_SPACE:
        case VK_VOLUME_UP:
        case VK_VOLUME_DOWN:
        case VK_VOLUME_MUTE:
        case VK_MEDIA_NEXT_TRACK:
        case VK_MEDIA_PREV_TRACK:
        case VK_MEDIA_STOP:
        case VK_MEDIA_PLAY_PAUSE:
        case 'A':
        case 'B':
        case 'E':
        case 'N':
        case 'P':
        case 'S':
        case 'T':
        case 'W':
        case VK_OEM_7:
            return true;
        default:
            return false;
        }
    }

    LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam)
    {
        if (nCode != HC_ACTION || lParam == 0)
        {
            return CallNextHookEx(g_lowLevelKeyboardHook, nCode, wParam, lParam);
        }

        auto info = reinterpret_cast<KBDLLHOOKSTRUCT *>(lParam);
        DWORD vkCode = info ? info->vkCode : 0;

        if (!g_enabled || !IsLowLevelRemoteVirtualKey(vkCode))
        {
            return CallNextHookEx(g_lowLevelKeyboardHook, nCode, wParam, lParam);
        }

        auto key = static_cast<VirtualKey>(vkCode);
        auto logicalKey = LogicalKeyFromVirtualKey(key);

        if (logicalKey.empty())
        {
            if (vkCode == VK_OEM_7)
            {
                // Swallow apostrophe noise produced by the WARM UP button on some units.
                return 1;
            }
            return CallNextHookEx(g_lowLevelKeyboardHook, nCode, wParam, lParam);
        }

        const bool isKeyDown = wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN;
        const bool isKeyUp = wParam == WM_KEYUP || wParam == WM_SYSKEYUP;

        if (!isKeyDown && !isKeyUp)
        {
            return 1;
        }

        int repeatCount = 0;
        if (isKeyDown)
        {
            if (g_lowLevelDownKeys.find(vkCode) != g_lowLevelDownKeys.end())
            {
                repeatCount = 1;
            }
            else
            {
                g_lowLevelDownKeys.insert(vkCode);
            }
        }
        else
        {
            g_lowLevelDownKeys.erase(vkCode);
        }

        auto keyName = VirtualKeyName(key);
        EmitRemoteKey(
            logicalKey,
            isKeyUp ? 1 : 0,
            static_cast<int>(vkCode),
            static_cast<int>(info ? info->scanCode : 0),
            "windows-lowlevel-hid",
            keyName,
            repeatCount);

        // Critical: block Windows from receiving the system volume/media/text key.
        return 1;
    }

#endif

    void EnsureLowLevelKeyboardHook() noexcept
    {
#if APLUS_REMOTE_LOWLEVEL_KEYBOARD_HOOK_AVAILABLE
        std::lock_guard<std::mutex> lock(g_remoteMutex);
        if (g_lowLevelKeyboardHook != nullptr)
        {
            return;
        }

        try
        {
            g_lowLevelKeyboardHook = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                LowLevelKeyboardProc,
                GetModuleHandleW(nullptr),
                0);
        }
        catch (...)
        {
            g_lowLevelKeyboardHook = nullptr;
        }
#else
        // React Native Windows UWP/AppContainer builds do not expose the desktop
        // low-level hook APIs (CallNextHookEx / SetWindowsHookEx). Keep the app
        // buildable and use CoreWindow/AcceleratorKey HID handling instead.
#endif
    }

    void RemoveLowLevelKeyboardHook() noexcept
    {
#if APLUS_REMOTE_LOWLEVEL_KEYBOARD_HOOK_AVAILABLE
        std::lock_guard<std::mutex> lock(g_remoteMutex);
        g_lowLevelDownKeys.clear();
        if (g_lowLevelKeyboardHook != nullptr)
        {
            try
            {
                UnhookWindowsHookEx(g_lowLevelKeyboardHook);
            }
            catch (...)
            {
            }
            g_lowLevelKeyboardHook = nullptr;
        }
#endif
    }

    void EnsureKeyboardHook() noexcept
    {
        // CoreWindow handlers do not always receive media/volume keys before Windows.
        // The low-level hook is the reliable path for the Bluetooth HID remote.
        EnsureLowLevelKeyboardHook();

        try
        {
            auto coreWindow = CoreApplication::MainView().CoreWindow();
            if (!coreWindow)
            {
                return;
            }

            auto dispatcher = coreWindow.Dispatcher();
            dispatcher.RunAsync(CoreDispatcherPriority::Normal, []() {
                std::lock_guard<std::mutex> lock(g_remoteMutex);
                if (g_keyboardHooked)
                {
                    return;
                }

                auto window = CoreApplication::MainView().CoreWindow();
                if (!window)
                {
                    return;
                }

                g_keyDownToken = window.KeyDown([](CoreWindow const &sender, KeyEventArgs const &args) {
                    EmitHidRemoteEvent(L"onRemoteKeyDown", sender, args, 0);
                });

                g_keyUpToken = window.KeyUp([](CoreWindow const &sender, KeyEventArgs const &args) {
                    EmitHidRemoteEvent(L"onRemoteKeyUp", sender, args, 1);
                });

                g_acceleratorKeyToken = window.Dispatcher().AcceleratorKeyActivated([](CoreDispatcher const &sender, AcceleratorKeyEventArgs const &args) {
                    EmitAcceleratorRemoteEvent(sender, args);
                });

                g_characterReceivedToken = window.CharacterReceived([](CoreWindow const &sender, CharacterReceivedEventArgs const &args) {
                    SwallowAplusRemoteCharacters(sender, args);
                });

                g_keyboardHooked = true;
            });
        }
        catch (...)
        {
        }
    }

    void StopBleWatcher() noexcept
    {
        try
        {
            if (g_watcher)
            {
                if (g_watcherReceivedToken.value != 0)
                {
                    g_watcher.Received(g_watcherReceivedToken);
                    g_watcherReceivedToken = {};
                }
                if (g_watcherStoppedToken.value != 0)
                {
                    g_watcher.Stopped(g_watcherStoppedToken);
                    g_watcherStoppedToken = {};
                }
                if (g_watcher.Status() == BluetoothLEAdvertisementWatcherStatus::Started ||
                    g_watcher.Status() == BluetoothLEAdvertisementWatcherStatus::Created)
                {
                    g_watcher.Stop();
                }
            }
        }
        catch (...)
        {
        }
        g_watcher = nullptr;
        g_scanActive = false;
    }

    void ClearBleSubscriptions() noexcept
    {
        for (auto &subscription : g_bleSubscriptions)
        {
            try
            {
                if (subscription.characteristic && subscription.token.value != 0)
                {
                    subscription.characteristic.ValueChanged(subscription.token);
                }
            }
            catch (...)
            {
            }
        }
        g_bleSubscriptions.clear();
    }

    void CloseBleDevice() noexcept
    {
        ClearBleSubscriptions();
        try
        {
            if (g_bleDevice)
            {
                g_bleDevice.Close();
            }
        }
        catch (...)
        {
        }
        g_bleDevice = nullptr;
        g_connectedDeviceName.clear();
        g_connectedBluetoothAddress = 0;
        g_connecting = false;
        g_lastBleLogicalKey.clear();
        g_bleLogicalKeyDown = false;
    }

    void HandleBleValueChanged(GattCharacteristic const &characteristic, GattValueChangedEventArgs const &args)
    {
        try
        {
            auto buffer = args.CharacteristicValue();
            auto reader = DataReader::FromBuffer(buffer);
            std::vector<uint8_t> bytes(reader.UnconsumedBufferLength());
            if (!bytes.empty())
            {
                reader.ReadBytes(bytes);
            }

            auto hex = BytesToHex(bytes);
            auto text = BytesToText(bytes);
            auto logicalKey = LogicalKeyFromBleBytes(bytes);

            auto serviceUuid = winrt::to_string(winrt::to_hstring(characteristic.Service().Uuid()));
            auto characteristicUuid = winrt::to_string(winrt::to_hstring(characteristic.Uuid()));

            JSValueObject notification;
            notification["serviceUUID"] = JSValue(serviceUuid);
            notification["characteristicUUID"] = JSValue(characteristicUuid);
            notification["hex"] = JSValue(hex);
            notification["text"] = JSValue(text);
            notification["keyCode"] = JSValue(logicalKey);
            notification["deviceName"] = JSValue(Narrow(g_connectedDeviceName));
            EmitJSEvent(L"onRemoteBluetoothNotification", std::move(notification));

            // BLE HID remotes usually send an input report on press and an all-zero/empty report on release.
            // Keep that press/release shape so NEW_GAME can only run when the button is really held for 3 seconds.
            if (logicalKey.empty())
            {
                if (g_bleLogicalKeyDown && !g_lastBleLogicalKey.empty())
                {
                    EmitRemoteKey(g_lastBleLogicalKey, 1, 0, 0, "windows-ble", g_lastBleLogicalKey, 0, hex, text, serviceUuid, characteristicUuid);
                    g_lastBleLogicalKey.clear();
                    g_bleLogicalKeyDown = false;
                }
                return;
            }

            if (g_bleLogicalKeyDown && !g_lastBleLogicalKey.empty() && g_lastBleLogicalKey != logicalKey)
            {
                EmitRemoteKey(g_lastBleLogicalKey, 1, 0, 0, "windows-ble", g_lastBleLogicalKey, 0, hex, text, serviceUuid, characteristicUuid);
            }

            g_lastBleLogicalKey = logicalKey;
            g_bleLogicalKeyDown = true;
            EmitRemoteKey(logicalKey, 0, 0, 0, "windows-ble", logicalKey, 0, hex, text, serviceUuid, characteristicUuid);
        }
        catch (winrt::hresult_error const &error)
        {
            EmitRemoteStatus("ble-notification-error", winrt::to_string(error.message()));
        }
        catch (...)
        {
            EmitRemoteStatus("ble-notification-error", "Unknown BLE notification error");
        }
    }

    winrt::fire_and_forget ConnectToBleDeviceAsync(uint64_t bluetoothAddress, std::wstring deviceName)
    {
        g_connecting = true;
        g_scanActive = false;
        EmitRemoteStatus("connecting", Narrow(deviceName));

        try
        {
            auto device = co_await BluetoothLEDevice::FromBluetoothAddressAsync(bluetoothAddress);
            if (!device)
            {
                g_connecting = false;
                EmitRemoteStatus("connect-failed", "Cannot open BLE device. Pair it in Windows Bluetooth settings first, then try again.");
                co_return;
            }

            CloseBleDevice();
            g_bleDevice = device;
            g_connectedDeviceName = device.Name().empty() ? deviceName : std::wstring(device.Name().c_str());
            g_connectedBluetoothAddress = bluetoothAddress;
            g_connecting = false;
            EmitRemoteStatus("connected", Narrow(g_connectedDeviceName));

            auto servicesResult = co_await device.GetGattServicesAsync(BluetoothCacheMode::Uncached);
            if (servicesResult.Status() != GattCommunicationStatus::Success)
            {
                EmitRemoteStatus("gatt-services-failed", "Connected, but cannot read GATT services");
                co_return;
            }

            uint32_t subscriptions = 0;
            for (auto const &service : servicesResult.Services())
            {
                auto charsResult = co_await service.GetCharacteristicsAsync(BluetoothCacheMode::Uncached);
                if (charsResult.Status() != GattCommunicationStatus::Success)
                {
                    continue;
                }

                for (auto const &characteristic : charsResult.Characteristics())
                {
                    auto properties = characteristic.CharacteristicProperties();
                    bool canNotify = (properties & GattCharacteristicProperties::Notify) == GattCharacteristicProperties::Notify;
                    bool canIndicate = (properties & GattCharacteristicProperties::Indicate) == GattCharacteristicProperties::Indicate;
                    if (!canNotify && !canIndicate)
                    {
                        continue;
                    }

                    auto descriptorValue = canNotify
                        ? GattClientCharacteristicConfigurationDescriptorValue::Notify
                        : GattClientCharacteristicConfigurationDescriptorValue::Indicate;

                    auto writeResult = co_await characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(descriptorValue);
                    if (writeResult != GattCommunicationStatus::Success)
                    {
                        continue;
                    }

                    auto token = characteristic.ValueChanged([](GattCharacteristic const &sender, GattValueChangedEventArgs const &eventArgs) {
                        HandleBleValueChanged(sender, eventArgs);
                    });

                    g_bleSubscriptions.push_back(BleSubscription{characteristic, token});
                    subscriptions += 1;
                }
            }

            if (subscriptions == 0)
            {
                EmitRemoteStatus("connected-no-notify", "Connected, but this remote exposed no BLE notification characteristic. If it is a HID remote, Windows will still deliver button events through the paired Bluetooth device path.");
            }
            else
            {
                EmitRemoteStatus("ready", "BLE remote connected and notifications enabled");
            }
        }
        catch (winrt::hresult_error const &error)
        {
            g_connecting = false;
            EmitRemoteStatus("connect-error", winrt::to_string(error.message()));
        }
        catch (...)
        {
            g_connecting = false;
            EmitRemoteStatus("connect-error", "Unknown BLE connect error");
        }
    }

    void StartBleScan() noexcept
    {
        StopBleWatcher();

        try
        {
            BluetoothLEAdvertisementWatcher watcher;
            watcher.ScanningMode(BluetoothLEScanningMode::Active);

            g_watcherReceivedToken = watcher.Received([](BluetoothLEAdvertisementWatcher const &sender, BluetoothLEAdvertisementReceivedEventArgs const &args) {
                std::wstring name(args.Advertisement().LocalName().c_str());
                if (name.empty())
                {
                    return;
                }

                if (!IsTargetRemoteName(name))
                {
                    return;
                }

                try
                {
                    sender.Stop();
                }
                catch (...)
                {
                }

                g_scanActive = false;
                ConnectToBleDeviceAsync(args.BluetoothAddress(), name);
            });

            g_watcherStoppedToken = watcher.Stopped([](BluetoothLEAdvertisementWatcher const &, BluetoothLEAdvertisementWatcherStoppedEventArgs const &) {
                g_scanActive = false;
                if (!g_bleDevice && !g_connecting)
                {
                    EmitRemoteStatus("scan-stopped", "No matching BLE remote found");
                }
            });

            g_watcher = watcher;
            g_scanActive = true;
            watcher.Start();
            EmitRemoteStatus("scanning", "Scanning BLE remote: AJBHJZ001 / MOCUTE-052Fe-AUTO / M585/M590");
        }
        catch (winrt::hresult_error const &error)
        {
            g_scanActive = false;
            EmitRemoteStatus("scan-error", winrt::to_string(error.message()));
        }
        catch (...)
        {
            g_scanActive = false;
            EmitRemoteStatus("scan-error", "Unknown BLE scan error");
        }
    }
}

namespace winrt::billiardsgrade::implementation
{
    void RemoteControlModule::Initialize(ReactContext const &reactContext) noexcept
    {
        {
            std::lock_guard<std::mutex> lock(g_remoteMutex);
            g_reactContext = std::make_shared<ReactContext>(reactContext);
        }
        // Do not touch CoreWindow during module initialization.
        // Calling the keyboard hook while the UWP splash screen is still active can
        // block React Native Windows from finishing startup on some machines.
        // BLE scan/connect is started only after the in-game Remote button is enabled.
    }

    void RemoteControlModule::StartListening() noexcept
    {
        // Windows Bluetooth remotes are usually exposed as HID keyboard/media devices,
        // not as BLE GATT controllers. Attach the CoreWindow keyboard/accelerator hook
        // lazily when JS asks for remote control, so buttons go to the app instead of Windows.
        EnsureKeyboardHook();
        EmitRemoteStatus("hid-listening", "Windows HID remote listener is active v81-break-stop-extension-guard");
    }

    void RemoteControlModule::SetEnabled(bool enabled) noexcept
    {
        g_enabled = enabled;

        if (enabled)
        {
            // Must be installed when the in-game Điều khiển toggle is enabled.
            // Without this, the paired remote controls Windows volume/text input only.
            EnsureKeyboardHook();
        }

        EmitRemoteStatus(enabled ? "enabled" : "disabled", enabled ? "Remote control enabled v81-break-stop-extension-guard" : "Remote control disabled");

        if (!enabled)
        {
            RemoveLowLevelKeyboardHook();
            StopBleWatcher();
            CloseBleDevice();
        }
    }

    winrt::fire_and_forget RemoteControlModule::ScanAndConnect(ReactPromise<JSValueObject> promise) noexcept
    {
        try
        {
            g_enabled = true;
            // Even when BLE scan does not find anything, a paired Bluetooth remote can still
            // be visible to Windows as HID keyboard/media keys. Keep that listener active.
            EnsureKeyboardHook();
            StartBleScan();

            JSValueObject result;
            result["ok"] = JSValue(true);
            result["status"] = JSValue("scanning");
            result["message"] = JSValue("Scanning for BLE remote");
            promise.Resolve(std::move(result));
        }
        catch (winrt::hresult_error const &error)
        {
            RejectPromise(promise, std::string("scanAndConnect: ") + winrt::to_string(error.message()));
        }
        catch (...)
        {
            RejectPromise(promise, "scanAndConnect: Unknown scanAndConnect error");
        }
        co_return;
    }

    winrt::fire_and_forget RemoteControlModule::Disconnect(ReactPromise<JSValueObject> promise) noexcept
    {
        try
        {
            StopBleWatcher();
            CloseBleDevice();
            g_enabled = false;
            EmitRemoteStatus("disconnected", "Remote disconnected");

            JSValueObject result;
            result["ok"] = JSValue(true);
            result["status"] = JSValue("disconnected");
            promise.Resolve(std::move(result));
        }
        catch (winrt::hresult_error const &error)
        {
            RejectPromise(promise, std::string("disconnect: ") + winrt::to_string(error.message()));
        }
        catch (...)
        {
            RejectPromise(promise, "disconnect: Unknown disconnect error");
        }
        co_return;
    }

    void RemoteControlModule::AddListener(std::string) noexcept
    {
    }

    void RemoteControlModule::RemoveListeners(double) noexcept
    {
    }
}
