// "Play Bounty TCG.exe" sits at the top of the unzipped download and starts the game in "Game files",
// so players don't have to find Bounty TCG.exe among Electron's files. build-windows.ps1 compiles it
// with the C# compiler that comes with Windows, so keep it to C# 5.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Bounty TCG")]
[assembly: AssemblyProduct("Bounty TCG")]

static class PlayBountyTcg {
  [STAThread]
  static void Main() {
    string game = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Game files");
    string exe = Path.Combine(game, "Bounty TCG.exe");
    if (!File.Exists(exe)) {
      MessageBox.Show("Couldn't find the game. Unzip the whole download first (right-click the zip and choose Extract All), then open Play Bounty TCG in the unzipped folder.",
        "Bounty TCG", MessageBoxButtons.OK, MessageBoxIcon.Warning);
      return;
    }
    ProcessStartInfo info = new ProcessStartInfo(exe);
    info.WorkingDirectory = game;
    info.UseShellExecute = false;
    try { Process.Start(info); }
    catch (Exception e) { MessageBox.Show("Couldn't start the game: " + e.Message, "Bounty TCG", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
  }
}
