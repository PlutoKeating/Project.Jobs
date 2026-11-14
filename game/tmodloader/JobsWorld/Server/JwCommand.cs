// /jw 聊天命令（CommandType.World：多人模式下在服务器执行；中文默认，/jw lang en 切换英文；子命令同时接受中英别名）
using System;
using System.Linq;
using JobsWorld.Shared.Personas;
using JobsWorld.Shared.Protocol;
using Microsoft.Xna.Framework;
using Terraria;
using Terraria.ModLoader;

namespace JobsWorld.Server
{
    public sealed class JwCommand : ModCommand
    {
        private static readonly string[] EventKinds = { "weak_network", "crowd", "rain", "power_cut", "noise" };
        private static readonly Color Info = new Color(255, 240, 200), Ok = new Color(160, 230, 160), Err = new Color(255, 120, 120);

        public override CommandType Type => CommandType.World | CommandType.Console;
        public override string Command => "jw";
        public override string Usage => "/jw help";
        public override string Description => "JobsWorld：/jw who | goto | follow | info | ask | login | clock | event | replay";

        public override void Action(CommandCaller caller, string input, string[] args)
        {
            var sys = ModContent.GetInstance<JwServerSystem>();
            if (!Main.dedServ) { caller.Reply("JobsWorld 只在多人服务器上可用。 / JobsWorld only works on a multiplayer server.", Err); return; }
            int who = caller.Player?.whoAmI ?? -1;
            if (caller.CommandType == CommandType.Console) who = -1;
            var t = sys.Text(who);
            string sub = args.Length > 0 ? args[0].ToLowerInvariant() : "help";
            string rest = args.Length > 1 ? string.Join(" ", args.Skip(1)) : "";
            void Say(string s, Color c) => caller.Reply(s, c);
            bool console = who < 0;

            switch (sub)
            {
                case "who": case "谁": case "list":
                {
                    var people = sys.People.ToList();
                    if (people.Count == 0) { Say(t.T("暂时没有人物（世界服务未运行？）", "No one here yet (is the world service running?)"), Info); return; }
                    foreach (var line in t.Who(people)) Say(line, Info);
                    return;
                }
                case "goto": case "tp": case "去":
                {
                    if (console) { Say("console cannot teleport", Err); return; }
                    if (string.IsNullOrWhiteSpace(rest)) { Say(t.T("用法：/jw goto <地点|人名>", "Usage: /jw goto <place|person>"), Err); return; }
                    if (sys.Director?.Find(rest) != null) { sys.GotoPersona(who, rest, out var m); Say(m, Ok); return; }
                    var place = sys.FindPlace(rest);
                    if (place == null)
                    {
                        var names = string.Join("、", (sys.Layout?.Places ?? new()).Select(x => $"{x.Id}({(t.En ? x.Name.En : x.Name.Zh)})"));
                        Say(t.T($"没有找到“{rest}”。可用地点：{names}", $"'{rest}' not found. Places: {names}"), Err);
                        return;
                    }
                    if (sys.GotoPlace(who, place)) Say(t.T($"已传送到 {place.Name.Zh}。", $"Teleported to {place.Name.En}."), Ok);
                    else Say(t.T("城镇尚未就绪。", "Town not ready."), Err);
                    return;
                }
                case "follow": case "跟随":
                {
                    if (console) { Say("console cannot follow", Err); return; }
                    var cur = sys.FollowingId(who);
                    if (string.IsNullOrWhiteSpace(rest) || rest == "off" || rest == "关闭" || (cur != null && sys.Director?.Find(rest)?.Persona.Id == cur))
                    {
                        sys.StopFollow(who);
                        Say(t.T("已停止跟随。", "Stopped following."), Ok);
                        return;
                    }
                    bool started = sys.StartFollow(who, rest, out var msg);
                    Say(msg, started ? Ok : Err);
                    return;
                }
                case "info": case "详情":
                {
                    var f = sys.Director?.Find(rest);
                    if (f == null) { Say(t.T($"没有找到人物“{rest}”。用法：/jw info <人名>", $"No person named '{rest}'. Usage: /jw info <person>"), Err); return; }
                    var fallback = f.Persona;
                    sys.Request(Subjects.Detail, Json.Stringify(new { persona_id = f.Persona.Id }), TimeSpan.FromSeconds(8), (ok, data) =>
                    {
                        var live = fallback;
                        if (ok && data != null) { try { var r = Json.Parse<DetailReply>(data); if (r?.Live != null) live = r.Live; } catch { } }
                        foreach (var line in t.Detail(live)) JwServerSystem.Reply(who, line, Info);
                    });
                    return;
                }
                case "ask": case "问":
                {
                    if (args.Length < 3) { Say(t.T("用法：/jw ask <人名> <问题>", "Usage: /jw ask <person> <question>"), Err); return; }
                    sys.Ask(who, args[1], string.Join(" ", args.Skip(2)));
                    return;
                }
                case "login": case "登录":
                {
                    if (console) { Say("console is already admin", Ok); return; }
                    if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("JW_ADMIN_PASSCODE"))) { Say(t.T("服务器未设置管理员口令（JW_ADMIN_PASSCODE）。", "No admin passcode configured (JW_ADMIN_PASSCODE)."), Err); return; }
                    if (sys.Login(who, rest)) { Say(t.T("已获得本次连接的 JobsWorld 管理员权限（可建造、控制时钟与事件）。", "JobsWorld admin granted for this session (build, clock, events)."), Ok); JwServerSystem.Log($"{caller.Player?.name} 以口令登录为 JobsWorld 管理员"); }
                    else { Say(t.T("口令错误。", "Wrong passcode."), Err); JwServerSystem.Log($"{caller.Player?.name} 管理员口令错误"); }
                    return;
                }
                case "lang": case "语言":
                    sys.SetLang(who, rest.StartsWith("en", StringComparison.OrdinalIgnoreCase));
                    Say(sys.Text(who).T("已切换为中文。", "Switched to English."), Ok);
                    sys.SendHello(who);
                    return;
                case "clock": case "时钟":
                    if (RequireAdmin(sys, who, t, Say)) Clock(sys, who, t, args, Say);
                    return;
                case "event": case "事件":
                    if (RequireAdmin(sys, who, t, Say)) Event(sys, who, t, args, caller.Player?.name ?? "console", Say);
                    return;
                case "replay": case "回放":
                    if (!RequireAdmin(sys, who, t, Say)) return;
                    if (string.IsNullOrWhiteSpace(rest)) { Say(t.T("用法：/jw replay <session_id>", "Usage: /jw replay <session_id>"), Err); return; }
                    sys.Request(Subjects.CmdReplay, Json.Stringify(new ReplayCmd { SessionId = rest.Trim() }), TimeSpan.FromSeconds(15), (ok, data) =>
                    {
                        if (ok && data != null && !data.Contains("\"error\"")) JwServerSystem.Reply(who, t.T("开始回放：", "Replay started: ") + data, Ok);
                        else JwServerSystem.Reply(who, t.T("失败：", "Failed: ") + data, Err);
                    });
                    return;
                case "rebuild": case "重建":
                    if (!RequireAdmin(sys, who, t, Say)) return;
                    if (sys.Layout == null) { Say(t.T("还没有收到城镇布局。", "No town layout yet."), Err); return; }
                    sys.Rebuild();
                    Say(t.T("重建完成。", "Rebuilt."), Ok);
                    return;
                case "paste": case "粘贴":
                    if (console) { Say("console cannot paste", Err); return; }
                    if (!RequireAdmin(sys, who, t, Say)) return;
                    if (string.IsNullOrWhiteSpace(rest)) { Say(t.T("用法：/jw paste <文件名.TEditSch>", "Usage: /jw paste <file.TEditSch>"), Err); return; }
                    try { Say(sys.Paste(who, rest.Trim()), Ok); }
                    catch (Exception e) { Say(t.T("粘贴失败：", "Paste failed: ") + e.Message, Err); }
                    return;
                case "status": case "状态":
                {
                    var m = sys.Marker; var c = sys.LatestClock;
                    Say(t.T("NATS：", "NATS: ") + (sys.NatsConnected ? "OK" : t.T("未连接", "disconnected")), Info);
                    Say(t.T("城镇：", "Town: ") + (m != null ? $"v{m.Version} @({m.OriginX},{m.OriginY})" : t.T("尚未就绪", "not ready")), Info);
                    Say(t.T("假玩家：", "Fake players: ") + (sys.Director?.Count ?? 0) + t.T("　时钟：", "  clock: ") + (c?.Clock ?? "?") + (c?.Paused == true ? t.T("（暂停）", " (paused)") : ""), Info);
                    return;
                }
                default:
                    Help(t, Say);
                    return;
            }
        }

        private static bool RequireAdmin(JwServerSystem sys, int who, WorldText t, Action<string, Color> say)
        {
            if (who < 0 || sys.IsAdmin(who)) return true;
            say(t.T("需要管理员权限：先 /jw login <口令>。", "Admin only: /jw login <passcode> first."), Err);
            return false;
        }

        private static void Help(WorldText t, Action<string, Color> say)
        {
            say(t.T("JobsWorld 命令（也可以直接点击人物打开面板）：", "JobsWorld commands (or just click a person):"), Info);
            say(t.T("/jw who — 所有人在哪、在做什么", "/jw who — where everyone is and what they're doing"), Info);
            say(t.T("/jw goto <地点|人名> — 传送", "/jw goto <place|person> — teleport"), Info);
            say(t.T("/jw follow <人名>|off — 跟随 / 取消", "/jw follow <person>|off — follow / stop"), Info);
            say(t.T("/jw info <人名> — 人物详情", "/jw info <person> — details"), Info);
            say(t.T("/jw ask <人名> <问题> — Session 结束后追问", "/jw ask <person> <question> — follow-up interview"), Info);
            say(t.T("/jw lang en|zh — 切换语言；/jw status — 状态", "/jw lang en|zh — language; /jw status — status"), Info);
            say(t.T("管理员：/jw login <口令>；/jw clock pause|resume|speed <n>|jump HH:MM；/jw event <地点> <weak_network|crowd|rain|power_cut|noise> [分钟]；/jw replay <session_id>；/jw rebuild；/jw paste <蓝图>",
                "Admin: /jw login <passcode>; /jw clock pause|resume|speed <n>|jump HH:MM; /jw event <place> <weak_network|crowd|rain|power_cut|noise> [minutes]; /jw replay <session_id>; /jw rebuild; /jw paste <schematic>"), Info);
        }

        private static void Clock(JwServerSystem sys, int who, WorldText t, string[] a, Action<string, Color> say)
        {
            var op = a.Length > 1 ? a[1].ToLowerInvariant() : "";
            ClockCmd? cmd = op switch
            {
                "pause" or "暂停" => new ClockCmd { Paused = true },
                "resume" or "继续" => new ClockCmd { Paused = false },
                "speed" or "倍速" when a.Length > 2 && double.TryParse(a[2], out var n) && n > 0 && n <= 3600 => new ClockCmd { Speed = n },
                "jump" or "跳到" when a.Length > 2 && ClockMath.NormalizeHHMM(a[2]) != null => new ClockCmd { JumpTo = ClockMath.NormalizeHHMM(a[2]) },
                _ => null,
            };
            if (cmd == null) { say(t.T("用法：/jw clock pause|resume|speed <n>|jump HH:MM", "Usage: /jw clock pause|resume|speed <n>|jump HH:MM"), Err); return; }
            sys.Request(Subjects.CmdClock, Json.Stringify(cmd), TimeSpan.FromSeconds(5), (ok, data) =>
            {
                if (!ok) { JwServerSystem.Reply(who, t.T("请求失败：", "Request failed: ") + data, Err); return; }
                ClockMsg? c = null;
                try { c = Json.Parse<ClockMsg>(data!); } catch { }
                JwServerSystem.Reply(who, t.T("时钟：", "Clock: ") + (c != null ? $"{c.Clock} ×{c.Speed}{(c.Paused ? t.T("（暂停）", " (paused)") : "")}" : data), Ok);
            });
        }

        private static void Event(JwServerSystem sys, int who, WorldText t, string[] a, string by, Action<string, Color> say)
        {
            if (a.Length < 3 || !EventKinds.Contains(a[2])) { say(t.T("用法：/jw event <地点> <weak_network|crowd|rain|power_cut|noise> [分钟]", "Usage: /jw event <place> <weak_network|crowd|rain|power_cut|noise> [minutes]"), Err); return; }
            var placeId = a[1] == "street" ? "street" : sys.FindPlace(a[1])?.Id;
            if (placeId == null) { say(t.T($"没有地点“{a[1]}”。", $"No place '{a[1]}'."), Err); return; }
            int? minutes = a.Length > 3 && int.TryParse(a[3], out var m) ? m : (int?)null;
            var kind = a[2];
            sys.Request(Subjects.CmdEvent, Json.Stringify(new EventCmd { PlaceId = placeId, Kind = kind, Minutes = minutes, By = by }), TimeSpan.FromSeconds(5), (ok, data) =>
            {
                if (ok && data != null && !data.Contains("\"error\"")) JwServerSystem.Reply(who, t.T($"已在 {t.Place(placeId)} 制造事件 {kind}。", $"Event {kind} started at {t.Place(placeId)}."), Ok);
                else JwServerSystem.Reply(who, t.T("失败：", "Failed: ") + data, Err);
            });
        }
    }
}
