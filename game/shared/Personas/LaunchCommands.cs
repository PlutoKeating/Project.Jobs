// 游戏里的发布主线：/jw launches | publish | promote | invite。
// 两个游戏端共用同一份逻辑：各自只提供「发 NATS 请求」和「给玩家回话」两个动作。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using JobsWorld.Shared.Protocol;

namespace JobsWorld.Shared.Personas
{
    public enum Tone { Info, Ok, Err }

    public static class LaunchCommands
    {
        /// <summary>NATS 请求；done 在主线程回调（ok=false 时 data 为错误信息）</summary>
        public delegate void RequestFn(string subject, string body, TimeSpan timeout, Action<bool, string?> done);

        public static readonly string[] HelpZh =
        {
            "/jw launches — 已发布的产品和各自的人数",
            "管理员：/jw publish <网址> <名字> <一句话> — 发布产品；/jw promote <产品> <0-100|pause|resume|end> — 调宣发；/jw invite <产品> [人数] — 把手机递给几个人",
        };
        public static readonly string[] HelpEn =
        {
            "/jw launches — published products and their head counts",
            "Admin: /jw publish <url> <name> <one line> — publish a product; /jw promote <product> <0-100|pause|resume|end> — promotion; /jw invite <product> [n] — hand it to a few people",
        };

        /// <summary>一行说清一个产品此刻的状况（人数是这座城里实际发生的，模拟）</summary>
        public static string Line(LaunchLive l, bool en)
        {
            string rating = l.Rating.HasValue ? (en ? $" · rated {l.Rating.Value.ToString("0.0", CultureInfo.InvariantCulture)} ({l.Reviews})" : $" · 评分 {l.Rating.Value.ToString("0.0", CultureInfo.InvariantCulture)}（{l.Reviews} 条）") : "";
            string state = l.Status == "live" ? "" : l.Status == "paused" ? (en ? " [paused]" : "【已暂停】") : (en ? " [ended]" : "【已结束】");
            int pct = (int)Math.Round(l.Intensity * 100);
            return en
                ? $"{l.Name}{state} — saw {l.Reached} > noticed {l.Noticed} > interested {l.Interested} > opened {l.Opened} > came back {l.CameBack}{(l.UsingNow > 0 ? $" ({l.UsingNow} using it now)" : "")} · promotion {pct}%{rating}"
                : $"{l.Name}{state} — 看到 {l.Reached} → 注意到 {l.Noticed} → 有兴趣 {l.Interested} → 打开过 {l.Opened} → 回来再用 {l.CameBack}{(l.UsingNow > 0 ? $"（此刻 {l.UsingNow} 人在用）" : "")} · 宣发 {pct}%{rating}";
        }

        /// <summary>处理一条发布相关的命令；不是这类命令时返回 false</summary>
        public static bool Handle(string sub, IReadOnlyList<string> args, WorldText t, Func<bool> requireAdmin, RequestFn request, Action<string, Tone> say)
        {
            switch (sub)
            {
                case "launches": case "products": case "产品":
                    request(Subjects.LaunchesGet, "{}", TimeSpan.FromSeconds(8), (ok, data) =>
                    {
                        var r = ok ? Safe(() => Json.Parse<LaunchesReply>(data!)) : null;
                        if (r == null || r.Error != null) { say(t.T("请求失败：", "Request failed: ") + (r?.Error ?? data), Tone.Err); return; }
                        if (r.Launches.Count == 0) { say(t.T("还没有发布过产品。/jw publish <网址> <名字> <一句话>", "Nothing published yet. /jw publish <url> <name> <one line>"), Tone.Info); return; }
                        foreach (var l in r.Launches) say(Line(l, t.En), Tone.Info);
                    });
                    return true;

                case "publish": case "发布":
                {
                    if (!requireAdmin()) return true;
                    if (args.Count < 4) { say(t.T("用法：/jw publish <网址> <名字> <一句话>", "Usage: /jw publish <url> <name> <one line>"), Tone.Err); return true; }
                    var cmd = new PublishCmd { Url = args[1], Name = args[2], Tagline = string.Join(" ", args.Skip(3)) };
                    say(t.T($"正在发布「{cmd.Name}」…", $"Publishing \"{cmd.Name}\"…"), Tone.Info);
                    request(Subjects.CmdPublish, Json.Stringify(cmd), TimeSpan.FromSeconds(120), (ok, data) =>
                    {
                        var r = ok ? Safe(() => Json.Parse<LaunchAck>(data!)) : null;
                        if (r == null || r.Error != null) { say(t.T("发布失败：", "Publish failed: ") + (r?.Error ?? data), Tone.Err); return; }
                        say(t.T($"已发布「{r.Name}」。城里的人接下来会自己遇到它；/jw launches 看人数，/jw invite {r.Name} 3 请几个人现在就试。", $"Published \"{r.Name}\". People will come across it on their own; /jw launches for head counts, /jw invite {r.Name} 3 to hand it to a few people now."), Tone.Ok);
                    });
                    return true;
                }

                case "promote": case "宣发":
                {
                    if (!requireAdmin()) return true;
                    if (args.Count < 3) { say(t.T("用法：/jw promote <产品> <0-100|pause|resume|end>", "Usage: /jw promote <product> <0-100|pause|resume|end>"), Tone.Err); return true; }
                    var cmd = new PromoteCmd { LaunchId = args[1] };
                    var op = args[2].ToLowerInvariant().TrimEnd('%');
                    if (op == "pause" || op == "暂停") cmd.Status = "paused";
                    else if (op == "resume" || op == "继续") cmd.Status = "live";
                    else if (op == "end" || op == "结束") cmd.Status = "ended";
                    else if (double.TryParse(op, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && n >= 0 && n <= 100) cmd.Intensity = n / 100.0;
                    else { say(t.T("用法：/jw promote <产品> <0-100|pause|resume|end>", "Usage: /jw promote <product> <0-100|pause|resume|end>"), Tone.Err); return true; }
                    request(Subjects.CmdPromote, Json.Stringify(cmd), TimeSpan.FromSeconds(8), (ok, data) =>
                    {
                        var r = ok ? Safe(() => Json.Parse<LaunchAck>(data!)) : null;
                        if (r == null || r.Error != null || r.Name == null) { say(t.T("失败：", "Failed: ") + (r?.Error ?? data), Tone.Err); return; }
                        int pct = (int)Math.Round((r.Intensity ?? 0) * 100);
                        string st = r.Status == "paused" ? t.T("已暂停", "paused") : r.Status == "ended" ? t.T("已结束", "ended") : t.T("进行中", "live");
                        say(t.T($"「{r.Name}」：{st}，宣发强度 {pct}%。", $"\"{r.Name}\": {st}, promotion {pct}%."), Tone.Ok);
                    });
                    return true;
                }

                case "invite": case "递手机":
                {
                    if (!requireAdmin()) return true;
                    if (args.Count < 2) { say(t.T("用法：/jw invite <产品> [人数]", "Usage: /jw invite <product> [n]"), Tone.Err); return true; }
                    var cmd = new InviteCmd { LaunchId = args[1], N = args.Count > 2 && int.TryParse(args[2], out var n) ? Math.Max(1, Math.Min(20, n)) : 3 };
                    request(Subjects.CmdInvite, Json.Stringify(cmd), TimeSpan.FromSeconds(60), (ok, data) =>
                    {
                        var r = ok ? Safe(() => Json.Parse<LaunchAck>(data!)) : null;
                        if (r == null || r.Error != null) { say(t.T("失败：", "Failed: ") + (r?.Error ?? data), Tone.Err); return; }
                        say(t.T($"已把手机递给 {r.Invited ?? 0} 个人。他们用的时候头上会冒出想法；/jw who 找到他们。", $"Handed it to {r.Invited ?? 0} people. Their thoughts show above their heads as they use it; /jw who to find them."), Tone.Ok);
                    });
                    return true;
                }
            }
            return false;
        }

        private static T? Safe<T>(Func<T?> f) where T : class { try { return f(); } catch { return null; } }
    }
}
