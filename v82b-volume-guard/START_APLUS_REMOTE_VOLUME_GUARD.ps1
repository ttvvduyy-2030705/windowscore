# Aplus Remote Volume Guard v82
# Runs outside the packaged app, catches global VolumeUp/VolumeDown while Aplus Score is focused,
# blocks Windows volume OSD/change, then sends F13/F14 to the app.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

$code = @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class AplusRemoteVolumeGuard
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint VK_VOLUME_DOWN = 0xAE;
    private const uint VK_VOLUME_UP = 0xAF;
    private const ushort VK_F13 = 0x7C;
    private const ushort VK_F14 = 0x7D;

    private static IntPtr _hookId = IntPtr.Zero;
    private static LowLevelKeyboardProc _proc = HookCallback;

    public static void Start()
    {
        if (_hookId != IntPtr.Zero) return;
        _hookId = SetHook(_proc);
        Application.Run();
    }

    public static void Stop()
    {
        if (_hookId != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hookId);
            _hookId = IntPtr.Zero;
        }
        Application.ExitThread();
    }

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule)
        {
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(curModule.ModuleName), 0);
        }
    }

    private static bool IsAplusForeground()
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return false;
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (pid == 0) return false;
        try
        {
            Process p = Process.GetProcessById((int)pid);
            string name = (p.ProcessName ?? "").ToLowerInvariant();
            string title = (p.MainWindowTitle ?? "").ToLowerInvariant();
            return name.Contains("billiardsgrade") || name.Contains("aplus") || title.Contains("aplus") || title.Contains("billiards");
        }
        catch
        {
            return false;
        }
    }

    private static void SendKey(ushort vk)
    {
        INPUT[] inputs = new INPUT[2];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].ki.wVk = vk;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].ki.wVk = vk;
        inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && lParam != IntPtr.Zero)
        {
            int msg = wParam.ToInt32();
            KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            bool isVolume = info.vkCode == VK_VOLUME_DOWN || info.vkCode == VK_VOLUME_UP;
            if (isVolume && IsAplusForeground())
            {
                bool isDown = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
                bool isUp = msg == WM_KEYUP || msg == WM_SYSKEYUP;
                if (isDown)
                {
                    SendKey(info.vkCode == VK_VOLUME_DOWN ? VK_F13 : VK_F14);
                }
                // Swallow both down and up, so Windows does not change volume/show OSD.
                if (isDown || isUp) return (IntPtr)1;
            }
        }
        return CallNextHookEx(_hookId, nCode, wParam, lParam);
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
}
"@

Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition $code -Language CSharp
Write-Host "Aplus Remote Volume Guard v82 is running. Keep this window open. Ctrl+C to stop."
Write-Host "VolumeDown -> F13 -> Bấm giờ. VolumeUp -> F14 -> Thêm giờ. Windows volume should not change while Aplus Score is focused."
[AplusRemoteVolumeGuard]::Start()
