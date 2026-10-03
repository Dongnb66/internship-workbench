// 实习工作台 · 本地助手 安装器（单文件，内嵌整包 zip）
//
// 为什么需要它：原来的用户路径是「解压 zip → 自己找到 start-hidden.vbs → 双击」，
// 还要先「右键 zip → 属性 → 解除锁定」（Windows 对下载文件的保护）。对普通用户是三道认知坎。
// 这个安装器把它们并成一次双击，并且顺手把「开机自启」也做了 —— 用户不会再忘了开助手。
//
// 设计边界：
//   · 只往 %LOCALAPPDATA%\InternshipWorkbench 写（或者 --target 指定的目录），不碰系统目录
//   · 覆盖式释放，**不删除**目标里多出来的文件（crawler\output\ 的产出、crawler\.profile\ 的登录态都保住）
//   · 跑完自检三样关键件，并等 /health 回话，把结果如实告诉用户
//   · C# 5 语法（csc v4.0.30319 只能编到 C# 5）：不用字符串插值、不用 ?. 、不用 nameof
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Management;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    private const string ZipResourceName = "agent.zip";
    private const string RunValueName = "InternshipWorkbenchAgent";
    private const string SiteUrl = "https://internship-workbench-47024.app.workbuddy.host/#crawler";
    private const string AgentHealth = "http://127.0.0.1:8787/health";

    private static readonly string[] RequiredRelPaths = new string[]
    {
        "start-hidden.vbs",
        "extension\\collector.js",
        "crawler\\node_modules\\playwright-core\\package.json",
        "crawler\\agent\\server.mjs",
    };

    private static Form _form;
    private static Label _label;
    private static ProgressBar _bar;
    private static readonly StringBuilder LogText = new StringBuilder();

    [STAThread]
    private static int Main(string[] args)
    {
        string target = null;
        bool autostart = true;
        bool quiet = false;
        bool start = true;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--target" && i + 1 < args.Length) { target = args[++i]; }
            else if (args[i] == "--no-autostart") { autostart = false; }
            else if (args[i] == "--quiet" || args[i] == "--silent") { quiet = true; }
            else if (args[i] == "--no-start") { start = false; }
            else if (args[i] == "--no-autostart-alias") { autostart = false; }
        }
        if (target == null || target.Length == 0)
        {
            target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InternshipWorkbench");
        }

        BuildWindow(quiet);
        try
        {
            Directory.CreateDirectory(target);
            Step("停掉正在运行的旧助手…", 4);
            Log("结束助手进程 " + StopAgent() + " 个");

            Step("释放文件到 " + target + " …", 8);
            int count = ExtractAll(target);
            Log("释放 " + count + " 个条目");

            Step("自检三样关键件…", 82);
            string missing = FindMissing(target);
            if (missing != null) { throw new Exception("释放后仍缺关键件：" + missing); }

            if (autostart)
            {
                Step("写入开机自启…", 86);
                WriteRunKey(target);
                Log("已写入 HKCU…\\Run\\" + RunValueName);
            }

            string health = null;
            if (start)
            {
                Step("启动助手…", 90);
                StartAgent(target);
                Step("等待助手就绪…", 94);
                health = WaitHealth(25);
                Log(health == null ? "助手 25 秒内没有回话" : "助手 /health：" + health);
            }
            else
            {
                Step("（--no-start：跳过启动与 /health）", 96);
                Log("--no-start：未启动助手");
                health = "(skipped)";
            }

            Finish(health != null, health, target, quiet);
            return health != null ? 0 : 1;
        }
        catch (Exception ex)
        {
            Log("失败：" + ex.Message);
            Finish(false, null, target, quiet);
            return 1;
        }
    }

    private static void BuildWindow(bool quiet)
    {
        if (quiet) { return; }
        _form = new Form();
        _form.Text = "实习工作台 · 本地助手安装";
        _form.ClientSize = new Size(470, 150);
        _form.FormBorderStyle = FormBorderStyle.FixedDialog;
        _form.StartPosition = FormStartPosition.CenterScreen;
        _form.MinimizeBox = false;
        _form.MaximizeBox = false;
        Label title = new Label();
        title.Text = "正在安装本地助手…";
        title.Font = new Font("Microsoft YaHei UI", 11F, FontStyle.Bold);
        title.SetBounds(16, 14, 430, 24);
        _form.Controls.Add(title);
        _label = new Label();
        _label.Text = "准备中…";
        _label.SetBounds(16, 44, 438, 42);
        _form.Controls.Add(_label);
        _bar = new ProgressBar();
        _bar.SetBounds(16, 96, 438, 18);
        _bar.Minimum = 0;
        _bar.Maximum = 100;
        _form.Controls.Add(_bar);
        _form.Show();
        Application.DoEvents();
    }

    private static void Step(string text, int percent)
    {
        Log(text);
        if (_label == null) { return; }
        _label.Text = text;
        _bar.Value = Math.Max(0, Math.Min(100, percent));
        Application.DoEvents();
    }

    private static void Log(string line)
    {
        LogText.AppendLine(DateTime.Now.ToString("HH:mm:ss") + "  " + line);
    }

    private static int StopAgent()
    {
        int killed = 0;
        try
        {
            using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='node.exe'"))
            {
                foreach (ManagementBaseObject mo in searcher.Get())
                {
                    object raw = mo["CommandLine"];
                    string line = raw == null ? "" : raw.ToString();
                    if (line.IndexOf("server.mjs", StringComparison.OrdinalIgnoreCase) < 0) { continue; }
                    try { Process.GetProcessById(Convert.ToInt32(mo["ProcessId"])).Kill(); killed++; }
                    catch { }
                }
            }
        }
        catch { }
        try
        {
            string outp = RunCommand("netstat", "-ano");
            string[] lines = outp.Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                string l = lines[i].Trim();
                if (l.IndexOf(":8787") < 0) { continue; }
                if (l.IndexOf("LISTENING", StringComparison.OrdinalIgnoreCase) < 0) { continue; }
                string[] parts = l.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                int pid;
                if (parts.Length >= 5 && int.TryParse(parts[parts.Length - 1], out pid))
                {
                    try { Process.GetProcessById(pid).Kill(); killed++; }
                    catch { }
                }
            }
        }
        catch { }
        Thread.Sleep(1200);
        return killed;
    }

    private static int ExtractAll(string target)
    {
        Assembly asm = Assembly.GetExecutingAssembly();
        using (Stream stream = asm.GetManifestResourceStream(ZipResourceName))
        {
            if (stream == null) { throw new Exception("安装包内部损坏：找不到内嵌的 " + ZipResourceName); }
            using (ZipArchive zip = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                int total = zip.Entries.Count;
                int done = 0;
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    string rel = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                    string dest = Path.Combine(target, rel);
                    if (entry.Name.Length == 0)
                    {
                        Directory.CreateDirectory(dest);
                    }
                    else
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(dest));
                        entry.ExtractToFile(dest, true);
                    }
                    done++;
                    if (done % 50 == 0)
                    {
                        Step("释放文件… " + done + "/" + total, 8 + (int)(72.0 * done / Math.Max(1, total)));
                    }
                }
                return done;
            }
        }
    }

    private static string FindMissing(string target)
    {
        for (int i = 0; i < RequiredRelPaths.Length; i++)
        {
            if (!File.Exists(Path.Combine(target, RequiredRelPaths[i]))) { return RequiredRelPaths[i]; }
        }
        return null;
    }

    private static void WriteRunKey(string target)
    {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
        {
            if (key == null) { throw new Exception("写不进 HKCU 的 Run 键"); }
            string vbs = Path.Combine(target, "start-hidden.vbs");
            key.SetValue(RunValueName, "wscript.exe \"" + vbs + "\"");
        }
    }

    private static void StartAgent(string target)
    {
        string vbs = Path.Combine(target, "start-hidden.vbs");
        if (!File.Exists(vbs)) { throw new Exception("没找到 " + vbs); }
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = "wscript.exe";
        psi.Arguments = "\"" + vbs + "\"";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        Process.Start(psi);
        Thread.Sleep(1500);
    }

    private static string WaitHealth(int seconds)
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(AgentHealth);
                req.Timeout = 3000;
                req.Method = "GET";
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    string body = reader.ReadToEnd();
                    if (body.IndexOf("\"ok\":true", StringComparison.Ordinal) >= 0) { return body; }
                }
            }
            catch { }
            Thread.Sleep(1000);
        }
        return null;
    }

    private static string RunCommand(string file, string args)
    {
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = file;
        psi.Arguments = args;
        psi.UseShellExecute = false;
        psi.RedirectStandardOutput = true;
        psi.CreateNoWindow = true;
        using (Process p = Process.Start(psi))
        {
            string outp = p.StandardOutput.ReadToEnd();
            p.WaitForExit(8000);
            return outp;
        }
    }

    private static string LogPath(string target)
    {
        return Path.Combine(target, "安装日志.txt");
    }

    private static void WriteLogFile(string target)
    {
        try { File.AppendAllText(LogPath(target), LogText.ToString(), Encoding.UTF8); }
        catch { }
    }

    private static void Finish(bool ok, string health, string target, bool quiet)
    {
        Step(ok ? "完成" : "出错了", 100);
        WriteLogFile(target);
        if (quiet) { return; }
        if (ok)
        {
            string msg = "本地助手安装完成。\r\n\r\n· 已在后台运行，并已设为开机自启\r\n· 回网页刷新一下（Ctrl+F5），卡片会自动变绿\r\n\r\n";
            MessageBox.Show(msg, "实习工作台 · 本地助手", MessageBoxButtons.OK, MessageBoxIcon.Information);
            try { Process.Start(SiteUrl); } catch { }
        }
        else
        {
            string msg = "安装没有走完。\r\n\r\n安装目录：" + target + "\r\n日志：" + LogPath(target) + "\r\n\r\n把「安装日志.txt」发我们看看。";
            MessageBox.Show(msg, "安装失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        if (_form != null) { _form.Close(); }
    }
}
