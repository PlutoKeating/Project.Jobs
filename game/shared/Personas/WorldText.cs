// 游戏内文本：/jw 命令的中英双语输出、时钟换算。两个游戏端共用，避免各写一份。
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using JobsWorld.Shared.Protocol;
using JobsWorld.Shared.Town;

namespace JobsWorld.Shared.Personas
{
    public static class ClockMath
    {
        /// <summary>
        /// 世界时钟分钟（0..1440）→ Terraria 时间。白天 04:30–19:30 = 54000 帧，夜晚 19:30–04:30 = 32400 帧，1 分钟 = 60 帧
        /// </summary>
        public static (bool dayTime, double time) FromMinute(double minute)
        {
            double m = ((minute % 1440) + 1440) % 1440;
            if (m >= 270 && m < 1170) return (true, (m - 270) * 60.0);
            return (false, ((m - 1170 + 1440) % 1440) * 60.0);
        }

        /// <summary>解析 HH:MM，失败返回 null</summary>
        public static string? NormalizeHHMM(string s)
        {
            var parts = s.Split(':');
            if (parts.Length != 2 || !int.TryParse(parts[0], out var h) || !int.TryParse(parts[1], out var m)) return null;
            if (h < 0 || h > 23 || m < 0 || m > 59) return null;
            return $"{h:00}:{m:00}";
        }
    }

    public sealed class WorldText
    {
        public bool En;
        private readonly Func<string, L10n?> _place;

        public WorldText(bool en, Func<string, L10n?> placeName) { En = en; _place = placeName; }

        public string T(string zh, string en) => En ? en : zh;

        public string Place(string id)
        {
            if (id == "street") return T("街上", "street");
            var n = _place(id);
            return n == null ? id : (En ? n.En : n.Zh);
        }

        public string ModeLabel(PersonaLive p) => p.Mode switch
        {
            "session" => T("正在用", "using") + " " + (p.Session?.App ?? "?"),
            "replay" => T("回放", "replay") + " " + (p.Session?.App ?? "?"),
            "travel" => T("在路上", "on the way"),
            "event" => T("遇到事件", "event"),
            _ => "",
        };

        public IEnumerable<string> Who(IEnumerable<PersonaLive> people)
        {
            var list = people.OrderByDescending(p => p.Session != null).ThenBy(p => p.PlaceId).ToList();
            yield return T($"JobsWorld 共 {list.Count} 人：", $"JobsWorld — {list.Count} people:");
            foreach (var p in list)
            {
                var mode = ModeLabel(p);
                yield return $"[c/ffd27f:{p.Name}] @{Place(p.PlaceId)} · {FakePlayerDirector.Shorten(p.Activity, 28)}{(mode.Length > 0 ? " · " + mode : "")}";
            }
        }

        public IEnumerable<string> Detail(PersonaLive p)
        {
            yield return $"[c/ffd27f:{p.Name}] {p.Age}{T("岁", "y")} {p.Gender} · {p.Occupation}";
            yield return T("位置：", "Where: ") + Place(p.PlaceId) + (p.Floor != 0 ? T($" {p.Floor}层", $" floor {p.Floor}") : "");
            yield return T("正在：", "Doing: ") + p.Activity;
            if (!string.IsNullOrEmpty(p.Intent)) yield return T("打算：", "Intent: ") + FakePlayerDirector.Shorten(p.Intent, 120);
            if (p.Needs != null) yield return T("状态：", "State: ") + p.Needs.Describe(!En) + (p.Phone.HasValue && p.Phone.Value >= 0.5 ? T("，手机在手边", ", phone at hand") : "");
            if (p.Prev != null) yield return T("之前：", "Before: ") + $"{p.Prev.From}-{p.Prev.To} {p.Prev.Activity} @{Place(p.Prev.PlaceId)}";
            if (p.Next != null) yield return T("接下来：", "Next: ") + $"{p.Next.From}-{p.Next.To} {p.Next.Activity} @{Place(p.Next.PlaceId)}";
            var s = p.Session;
            if (s != null)
            {
                yield return T("软件：", "App: ") + $"{s.App} {s.AppVersion} · {T("第", "step ")}{s.StepIdx + 1}{(s.StepsTotal.HasValue ? "/" + s.StepsTotal : "")}{T("步", "")}{(s.Replay == true ? T("（回放）", " (replay)") : "")}";
                if (!string.IsNullOrEmpty(s.Monologue)) yield return T("心里想：", "Thinking: ") + FakePlayerDirector.Shorten(s.Monologue, 160);
                if (!string.IsNullOrEmpty(s.Action)) yield return T("动作：", "Action: ") + FakePlayerDirector.Shorten(s.Action, 120);
            }
        }

        /// <summary>jw.ask 应答 → 文本</summary>
        public string AskAnswer(AskReply r)
        {
            if (!string.IsNullOrEmpty(r.Error)) return T("出错：", "Error: ") + r.Error;
            if (r.Busy == true) return T("他正在使用软件，等这次体验结束再问吧。", "Busy in a session right now — ask after it ends.");
            if (r.None == true) return T("他还没有完成过任何 Session，暂时没法回答。", "No finished session yet, nothing to ask about.");
            if (r.Answer is JsonElement a)
            {
                if (a.ValueKind == JsonValueKind.String) return a.GetString() ?? "";
                if (a.ValueKind == JsonValueKind.Object)
                {
                    foreach (var k in new[] { "answer", "text", "reply", "content" })
                        if (a.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String) return v.GetString() ?? "";
                }
                return a.GetRawText();
            }
            return T("（没有回答）", "(no answer)");
        }
    }
}
