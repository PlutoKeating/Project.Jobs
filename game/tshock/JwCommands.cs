// /jw 命令（中文默认，/jw lang en 切换英文；子命令同时接受中英别名）
using System;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using JobsWorld.Shared.Personas;
using JobsWorld.Shared.Protocol;
using JobsWorld.Shared.Town;
using Microsoft.Xna.Framework;
using TShockAPI;

namespace JobsWorld.TShock
{
    public sealed partial class JobsWorldPlugin
    {
        private static readonly string[] EventKinds = { "weak_network", "crowd", "rain", "power_cut", "noise" };

        private WorldText Text(TSPlayer p) => new WorldText(_english.Contains(p.Index), id => _layout?.Places.FirstOrDefault(x => x.Id == id)?.Name);

        private void JwCommand(CommandArgs args)
        {
            var p = args.Player;
            var t = Text(p);
            var a = args.Parameters;
            string sub = a.Count > 0 ? a[0].ToLowerInvariant() : "help";
            string rest = a.Count > 1 ? string.Join(" ", a.Skip(1)) : "";
            switch (sub)
            {
                case "who": case "谁": case "list": Who(p, t); break;
                case "goto": case "tp": case "去": Goto(p, t, rest); break;
                case "follow": case "跟随": FollowCmd(p, t, rest); break;
                case "info": case "详情": Info(p, t, rest); break;
                case "ask": case "问": Ask(p, t, a); break;
                case "login": case "登录": Login(p, t, rest); break;
                case "lang": case "语言":
                    if (rest.StartsWith("en", StringComparison.OrdinalIgnoreCase)) _english.Add(p.Index); else _english.Remove(p.Index);
                    p.SendSuccessMessage(Text(p).T("已切换为中文。", "Switched to English."));
                    break;
                case "clock": case "时钟": if (RequireAdmin(p, t)) Clock(p, t, a); break;
                case "event": case "事件": if (RequireAdmin(p, t)) EventCmd(p, t, a); break;
                case "replay": case "回放": if (RequireAdmin(p, t)) Replay(p, t, rest); break;
                case "rebuild": case "重建": if (RequireAdmin(p, t)) Rebuild(p, t); break;
                case "paste": case "粘贴": if (RequireAdmin(p, t)) Paste(p, t, rest); break;
                case "status": case "状态": Status(p, t); break;
                default:
                    // 发布主线（两个游戏端共用一份逻辑）：/jw launches | publish | promote | invite
                    if (!LaunchCommands.Handle(sub, a, t, () => RequireAdmin(p, t), Request, (msg, tone) => { if (tone == Tone.Err) p.SendErrorMessage(msg); else if (tone == Tone.Ok) p.SendSuccessMessage(msg); else p.SendInfoMessage(msg); })) Help(p, t);
                    break;
            }
        }

        private void Help(TSPlayer p, WorldText t)
        {
            p.SendInfoMessage(t.T("JobsWorld 命令：", "JobsWorld commands:"));
            p.SendInfoMessage(t.T("/jw who — 所有人在哪、在做什么", "/jw who — where everyone is and what they're doing"));
            p.SendInfoMessage(t.T("/jw goto <地点|人名> — 传送", "/jw goto <place|person> — teleport"));
            p.SendInfoMessage(t.T("/jw follow <人名> — 跟随（再次输入或 /jw follow off 取消）", "/jw follow <person> — follow (again or 'off' to stop)"));
            p.SendInfoMessage(t.T("/jw info <人名> — 人物详情", "/jw info <person> — details"));
            p.SendInfoMessage(t.T("/jw ask <人名> <问题> — Session 结束后追问", "/jw ask <person> <question> — follow-up interview"));
            p.SendInfoMessage(t.T(LaunchCommands.HelpZh[0], LaunchCommands.HelpEn[0]));
            p.SendInfoMessage(t.T("/jw lang en|zh — 切换语言；/jw status — 状态", "/jw lang en|zh — language; /jw status — status"));
            p.SendInfoMessage(t.T("管理员：/jw login <口令>；/jw clock pause|resume|speed <n>|jump HH:MM；/jw event <地点> <weak_network|crowd|rain|power_cut|noise> [分钟]；/jw replay <session_id>；/jw rebuild；/jw paste <蓝图>",
                "Admin: /jw login <passcode>; /jw clock pause|resume|speed <n>|jump HH:MM; /jw event <place> <weak_network|crowd|rain|power_cut|noise> [minutes]; /jw replay <session_id>; /jw rebuild; /jw paste <schematic>"));
            p.SendInfoMessage(t.T(LaunchCommands.HelpZh[1], LaunchCommands.HelpEn[1]));
        }

        private void Status(TSPlayer p, WorldText t)
        {
            p.SendInfoMessage(t.T("NATS：", "NATS: ") + (_nats?.Connected == true ? "OK" : t.T("未连接", "disconnected")));
            p.SendInfoMessage(t.T("城镇：", "Town: ") + (_marker != null ? $"v{_marker.Version} @({_marker.OriginX},{_marker.OriginY})" : t.T("尚未就绪", "not ready")));
            p.SendInfoMessage(t.T("假玩家：", "Fake players: ") + (_director?.Count ?? 0) + t.T("　时钟：", "  clock: ") + (_latestClock?.Clock ?? "?") + (_latestClock?.Paused == true ? t.T("（暂停）", " (paused)") : ""));
        }

        private void Who(TSPlayer p, WorldText t)
        {
            var people = People.ToList();
            if (people.Count == 0) { p.SendInfoMessage(t.T("暂时没有人物（世界服务未运行？）", "No one here yet (is the world service running?)")); return; }
            foreach (var line in t.Who(people)) p.SendInfoMessage(line);
        }

        private bool TeleportTown(TSPlayer p, double tx, double ty)
        {
            if (_director == null || !_director.Ready) return false;
            var (px, py) = _director.ToWorldPixels(tx, ty);
            return p.Teleport(px, py);
        }

        private void Goto(TSPlayer p, WorldText t, string q)
        {
            if (string.IsNullOrWhiteSpace(q)) { p.SendErrorMessage(t.T("用法：/jw goto <地点|人名>", "Usage: /jw goto <place|person>")); return; }
            var f = _director?.Find(q);
            if (f != null)
            {
                p.Teleport(f.CurX + 24 * (f.Dir > 0 ? -1 : 1), f.CurY);
                p.SendSuccessMessage(t.T($"已传送到 {f.Persona.Name} 身边。", $"Teleported next to {f.Persona.Name}."));
                return;
            }
            var place = FindPlace(q);
            if (place == null)
            {
                var names = string.Join("、", (_layout?.Places ?? new()).Select(x => $"{x.Id}({(t.En ? x.Name.En : x.Name.Zh)})"));
                p.SendErrorMessage(t.T($"没有找到“{q}”。可用地点：{names}", $"'{q}' not found. Places: {names}"));
                return;
            }
            var spot = _layout!.Spots.FirstOrDefault(s => s.PlaceId == place.Id);
            double tx = spot?.X ?? place.X + place.W / 2.0, ty = spot?.Y ?? 0;
            if (TeleportTown(p, tx, ty)) p.SendSuccessMessage(t.T($"已传送到 {place.Name.Zh}。", $"Teleported to {place.Name.En}."));
            else p.SendErrorMessage(t.T("城镇尚未就绪。", "Town not ready."));
        }

        private PlaceLayout? FindPlace(string q)
        {
            if (_layout == null) return null;
            q = q.Trim();
            return _layout.Places.FirstOrDefault(x => string.Equals(x.Id, q, StringComparison.OrdinalIgnoreCase) || x.Name.Zh == q || string.Equals(x.Name.En, q, StringComparison.OrdinalIgnoreCase))
                ?? _layout.Places.FirstOrDefault(x => x.Name.Zh.Contains(q) || x.Name.En.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0 || x.Kind == q);
        }

        private void FollowCmd(TSPlayer p, WorldText t, string q)
        {
            if (string.IsNullOrWhiteSpace(q) || q == "off" || q == "关闭" || (_follow.TryGetValue(p.Index, out var cur) && _director?.Find(q)?.Persona.Id == cur))
            {
                _follow.Remove(p.Index);
                p.SendSuccessMessage(t.T("已停止跟随。", "Stopped following."));
                return;
            }
            var f = _director?.Find(q);
            if (f == null) { p.SendErrorMessage(t.T($"没有找到人物“{q}”。", $"No person named '{q}'.")); return; }
            _follow[p.Index] = f.Persona.Id;
            p.Teleport(f.CurX - 32, f.CurY);
            p.SendSuccessMessage(t.T($"开始跟随 {f.Persona.Name}（再输一次 /jw follow {f.Persona.Name} 取消）。", $"Following {f.Persona.Name} (repeat the command to stop)."));
        }

        private void Info(TSPlayer p, WorldText t, string q)
        {
            var f = _director?.Find(q);
            if (f == null) { p.SendErrorMessage(t.T($"没有找到人物“{q}”。用法：/jw info <人名>", $"No person named '{q}'. Usage: /jw info <person>")); return; }
            var id = f.Persona.Id;
            var fallback = f.Persona;
            Request(Subjects.Detail, Json.Stringify(new { persona_id = id }), TimeSpan.FromSeconds(8), (ok, data) =>
            {
                var live = fallback;
                if (ok) { var r = Safe(() => Json.Parse<DetailReply>(data!)); if (r?.Live != null) live = r.Live; }
                foreach (var line in t.Detail(live)) p.SendInfoMessage(line);
            });
        }

        private void Ask(TSPlayer p, WorldText t, System.Collections.Generic.List<string> a)
        {
            if (a.Count < 3) { p.SendErrorMessage(t.T("用法：/jw ask <人名> <问题>", "Usage: /jw ask <person> <question>")); return; }
            var f = _director?.Find(a[1]);
            if (f == null) { p.SendErrorMessage(t.T($"没有找到人物“{a[1]}”。", $"No person named '{a[1]}'.")); return; }
            var question = string.Join(" ", a.Skip(2));
            var name = f.Persona.Name;
            p.SendInfoMessage(t.T($"正在问 {name}……（可能需要几十秒）", $"Asking {name}… (may take a while)"));
            Request(Subjects.Ask, Json.Stringify(new { persona_id = f.Persona.Id, question }), TimeSpan.FromSeconds(120), (ok, data) =>
            {
                if (!ok) { p.SendErrorMessage(t.T("请求失败：", "Request failed: ") + data); return; }
                var r = Safe(() => Json.Parse<AskReply>(data!));
                if (r == null) { p.SendErrorMessage(t.T("回答无法解析。", "Unreadable reply.")); return; }
                p.SendMessage($"{name}: {t.AskAnswer(r)}", new Color(255, 230, 160));
            });
        }

        private void Login(TSPlayer p, WorldText t, string pass)
        {
            var expect = Environment.GetEnvironmentVariable("JW_ADMIN_PASSCODE");
            if (string.IsNullOrEmpty(expect)) { p.SendErrorMessage(t.T("服务器未设置管理员口令（JW_ADMIN_PASSCODE）。", "No admin passcode configured (JW_ADMIN_PASSCODE).")); return; }
            if (pass != expect) { p.SendErrorMessage(t.T("口令错误。", "Wrong passcode.")); Log($"{p.Name} 管理员口令错误"); return; }
            _sessionAdmins.Add(p.Index);
            p.SendSuccessMessage(t.T("已获得本次连接的 JobsWorld 管理员权限（可建造、控制时钟与事件）。", "JobsWorld admin granted for this session (build, clock, events)."));
            Log($"{p.Name} 以口令登录为 JobsWorld 管理员");
        }

        private bool RequireAdmin(TSPlayer p, WorldText t)
        {
            if (IsAdmin(p)) return true;
            p.SendErrorMessage(t.T("需要管理员权限：先 /jw login <口令>。", "Admin only: /jw login <passcode> first."));
            return false;
        }

        private void Clock(TSPlayer p, WorldText t, System.Collections.Generic.List<string> a)
        {
            var op = a.Count > 1 ? a[1].ToLowerInvariant() : "";
            object? cmd = op switch
            {
                "pause" or "暂停" => new ClockCmd { Paused = true },
                "resume" or "继续" => new ClockCmd { Paused = false },
                "speed" or "倍速" when a.Count > 2 && double.TryParse(a[2], out var n) && n > 0 && n <= 3600 => new ClockCmd { Speed = n },
                "jump" or "跳到" when a.Count > 2 && ClockMath.NormalizeHHMM(a[2]) != null => new ClockCmd { JumpTo = ClockMath.NormalizeHHMM(a[2]) },
                _ => null,
            };
            if (cmd == null) { p.SendErrorMessage(t.T("用法：/jw clock pause|resume|speed <n>|jump HH:MM", "Usage: /jw clock pause|resume|speed <n>|jump HH:MM")); return; }
            Request(Subjects.CmdClock, Json.Stringify(cmd), TimeSpan.FromSeconds(5), (ok, data) =>
            {
                if (!ok) { p.SendErrorMessage(t.T("请求失败：", "Request failed: ") + data); return; }
                var c = Safe(() => Json.Parse<ClockMsg>(data!));
                p.SendSuccessMessage(t.T("时钟：", "Clock: ") + (c != null ? $"{c.Clock} ×{c.Speed}{(c.Paused ? t.T("（暂停）", " (paused)") : "")}" : data));
            });
        }

        private void EventCmd(TSPlayer p, WorldText t, System.Collections.Generic.List<string> a)
        {
            if (a.Count < 3 || !EventKinds.Contains(a[2])) { p.SendErrorMessage(t.T("用法：/jw event <地点> <weak_network|crowd|rain|power_cut|noise> [分钟]", "Usage: /jw event <place> <weak_network|crowd|rain|power_cut|noise> [minutes]")); return; }
            var placeId = a[1] == "street" ? "street" : FindPlace(a[1])?.Id;
            if (placeId == null) { p.SendErrorMessage(t.T($"没有地点“{a[1]}”。", $"No place '{a[1]}'.")); return; }
            int? minutes = a.Count > 3 && int.TryParse(a[3], out var m) ? m : (int?)null;
            Request(Subjects.CmdEvent, Json.Stringify(new EventCmd { PlaceId = placeId, Kind = a[2], Minutes = minutes, By = p.Name }), TimeSpan.FromSeconds(5), (ok, data) =>
            {
                if (ok && data != null && !data.Contains("\"error\"")) p.SendSuccessMessage(t.T($"已在 {t.Place(placeId)} 制造事件 {a[2]}。", $"Event {a[2]} started at {t.Place(placeId)}."));
                else p.SendErrorMessage(t.T("失败：", "Failed: ") + data);
            });
        }

        private void Replay(TSPlayer p, WorldText t, string sid)
        {
            if (string.IsNullOrWhiteSpace(sid)) { p.SendErrorMessage(t.T("用法：/jw replay <session_id>", "Usage: /jw replay <session_id>")); return; }
            Request(Subjects.CmdReplay, Json.Stringify(new ReplayCmd { SessionId = sid.Trim() }), TimeSpan.FromSeconds(15), (ok, data) =>
            {
                if (ok && data != null && !data.Contains("\"error\"")) p.SendSuccessMessage(t.T("开始回放：", "Replay started: ") + data);
                else p.SendErrorMessage(t.T("失败：", "Failed: ") + data);
            });
        }

        private void Rebuild(TSPlayer p, WorldText t)
        {
            if (_layout == null) { p.SendErrorMessage(t.T("还没有收到城镇布局。", "No town layout yet.")); return; }
            p.SendInfoMessage(t.T("正在重建城镇……", "Rebuilding town…"));
            EnsureTown(_layout, force: true);
            p.SendSuccessMessage(t.T("重建完成。", "Rebuilt."));
        }

        /// <summary>管理员：把 schematics 目录里的 .TEditSch 蓝图以自己脚下为左下角粘贴（调试 / 临时摆放用，不写入城镇布局）</summary>
        private void Paste(TSPlayer p, WorldText t, string file)
        {
            if (string.IsNullOrWhiteSpace(file)) { p.SendErrorMessage(t.T("用法：/jw paste <文件名.TEditSch>", "Usage: /jw paste <file.TEditSch>")); return; }
            try
            {
                var s = LoadSchematic(file.EndsWith(".TEditSch", StringComparison.OrdinalIgnoreCase) ? file : file + ".TEditSch");
                if (s == null) { p.SendErrorMessage(t.T("蓝图不存在：", "Schematic not found: ") + file); return; }
                int left = p.TileX, bottom = p.TileY + 2;
                int n = s.Paste(new TShockTileWriter(), left, bottom);
                Terraria.WorldGen.RangeFrame(left, bottom - s.Height, left + s.Width, bottom + 1);
                for (int cx = left; cx < left + s.Width; cx += 32)
                    for (int cy = bottom - s.Height + 1; cy <= bottom; cy += 32)
                        Terraria.NetMessage.SendTileSquare(-1, cx, cy, Math.Min(32, left + s.Width - cx), Math.Min(32, bottom + 1 - cy));
                p.SendSuccessMessage(t.T($"已粘贴 {s.Name}（{s.Width}×{s.Height}，{n} 格，V{s.FormatVersion}）", $"Pasted {s.Name} ({s.Width}x{s.Height}, {n} tiles, V{s.FormatVersion})"));
                Log($"{p.Name} 粘贴蓝图 {file} 于 ({left},{bottom})：{s.Width}x{s.Height}，{n} 格");
            }
            catch (Exception e) { p.SendErrorMessage(t.T("粘贴失败：", "Paste failed: ") + e.Message); }
        }

        /// <summary>NATS 请求；回调在主线程执行（ok=false 时 data 为错误信息）</summary>
        private void Request(string subject, string body, TimeSpan timeout, Action<bool, string?> done)
        {
            var nats = _nats;
            if (nats == null || !nats.Connected) { done(false, "NATS 未连接"); return; }
            Task.Run(async () =>
            {
                try
                {
                    var m = await nats.RequestAsync(subject, body, timeout);
                    var text = m.Text;
                    RunOnMain(() => done(true, text));
                }
                catch (Exception e) { RunOnMain(() => done(false, e.Message)); }
            });
        }
    }
}
