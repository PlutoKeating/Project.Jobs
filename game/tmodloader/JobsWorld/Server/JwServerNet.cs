// 服务端 ↔ 客户端：HUD / 人物名册广播，面板请求（详情、追问、跟随、传送）转 NATS。
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using JobsWorld.Common;
using JobsWorld.Shared.Personas;
using JobsWorld.Shared.Protocol;
using Microsoft.Xna.Framework;
using Terraria;
using Terraria.ModLoader;

namespace JobsWorld.Server
{
    public sealed partial class JwServerSystem
    {
        private ModPacket Packet(Pkt type)
        {
            var p = Mod.GetPacket();
            p.Write((byte)type);
            return p;
        }

        /// <summary>截图访问令牌：与 apps/api/src/auth.ts 的 evidenceKey() 相同算法（网页设置了 JW_PASSCODE 时，游戏面板凭它加载截图）</summary>
        private static string EvidenceKey()
        {
            var pass = Env.Get("JW_PASSCODE", "");
            if (string.IsNullOrEmpty(pass)) return "";
            var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("jw-evidence:" + pass));
            return System.Convert.ToHexString(hash).ToLowerInvariant().Substring(0, 32);
        }

        internal void SendHello(int who)
        {
            var p = Packet(Pkt.Hello);
            p.Write(Env.Get("JW_API_BASE", ""));
            p.Write(EvidenceKey());
            p.Write(IsAdmin(who));
            p.Write(En(who));
            p.Write(_layout == null ? "" : (En(who) ? _layout.Name.En : _layout.Name.Zh));
            var places = _layout?.Places ?? new System.Collections.Generic.List<Shared.Town.PlaceLayout>();
            p.Write((ushort)places.Count);
            foreach (var pl in places) { p.Write(pl.Id); p.Write(pl.Name.Zh); p.Write(pl.Name.En); }
            p.Send(who);
        }

        private void BroadcastHud()
        {
            var c = _latestClock;
            if (c == null) return;
            var people = People.ToList();
            var p = Packet(Pkt.Hud);
            p.Write(c.Clock ?? "");
            p.Write(c.Date ?? "");
            p.Write(c.Paused);
            p.Write((float)c.Speed);
            p.Write((ushort)Math.Min(65535, people.Count(x => x.Session != null)));
            p.Write((ushort)Math.Min(65535, people.Count));
            p.Send();
        }

        private System.Collections.Generic.List<RosterEntry> Roster()
        {
            var list = new System.Collections.Generic.List<RosterEntry>();
            if (_director == null) return list;
            foreach (var f in _director.All.OrderBy(f => f.Slot))
            {
                var pl = f.Persona;
                list.Add(new RosterEntry
                {
                    Slot = (byte)f.Slot, Id = pl.Id, Name = pl.Name, Occupation = pl.Occupation, Age = pl.Age, Mode = pl.Mode,
                    App = pl.Session?.App ?? "", Activity = FakePlayerDirector.Shorten(pl.Activity, 40),
                });
            }
            return list;
        }

        private void WriteRoster(ModPacket p, System.Collections.Generic.List<RosterEntry> list)
        {
            p.Write((ushort)list.Count);
            foreach (var e in list) e.Write(p);
        }

        /// <summary>名册变化时广播；每 10 秒无条件补发一次</summary>
        private void BroadcastRoster(bool force)
        {
            var list = Roster();
            var key = string.Join("\n", list.Select(e => e.Key()));
            if (!force && key == _rosterKey && _frame - _rosterSentFrame < 600) return;
            _rosterKey = key; _rosterSentFrame = _frame;
            var p = Packet(Pkt.Roster);
            WriteRoster(p, list);
            p.Send();
        }

        private void SendRoster(int who)
        {
            var p = Packet(Pkt.Roster);
            WriteRoster(p, Roster());
            p.Send(who);
        }

        internal void SendFollowState(int who, string personaId)
        {
            if (who < 0 || who >= 255 || !_joined[who]) return;
            var p = Packet(Pkt.FollowState);
            p.Write(personaId);
            p.Send(who);
        }

        private void SendDetail(int who, string personaId, bool ok, string json)
        {
            if (!_joined[who]) return;
            var p = Packet(Pkt.Detail);
            p.Write(personaId);
            p.Write(ok);
            p.Write(json);
            p.Send(who);
        }

        internal void SendAskAnswer(int who, string personaId, bool ok, string text)
        {
            if (who < 0 || !_joined[who]) return;
            var p = Packet(Pkt.AskAnswer);
            p.Write(personaId);
            p.Write(ok);
            p.Write(ClipUtf8(text, Limits.Text * 3));
            p.Send(who);
        }

        /// <summary>按 UTF-8 字节数截断（ModPacket 单包 ≤ 65535 字节）</summary>
        internal static string ClipUtf8(string s, int maxBytes)
        {
            if (Encoding.UTF8.GetByteCount(s) <= maxBytes) return s;
            int lo = 0, hi = s.Length;
            while (lo < hi) { int mid = (lo + hi + 1) / 2; if (Encoding.UTF8.GetByteCount(s.Substring(0, mid)) <= maxBytes) lo = mid; else hi = mid - 1; }
            return s.Substring(0, lo);
        }

        /// <summary>jw.detail 应答过大时逐步去掉次要字段</summary>
        private static string FitDetail(string json)
        {
            if (Encoding.UTF8.GetByteCount(json) <= Limits.DetailJson) return json;
            try
            {
                var node = JsonNode.Parse(json) as JsonObject;
                if (node == null) return "{}";
                foreach (var key in new[] { "memories", "sessions", "agenda" })
                {
                    node.Remove(key);
                    var s = node.ToJsonString();
                    if (Encoding.UTF8.GetByteCount(s) <= Limits.DetailJson) return s;
                }
                return "{}";
            }
            catch { return "{}"; }
        }

        // ---------------- 客户端请求 ----------------

        internal void OnPacket(Pkt type, BinaryReader r, int who)
        {
            switch (type)
            {
                case Pkt.DetailReq:
                {
                    var id = r.ReadString();
                    Request(Subjects.Detail, Json.Stringify(new { persona_id = id }), TimeSpan.FromSeconds(8), (ok, data) =>
                    {
                        if (ok && data != null) SendDetail(who, id, true, FitDetail(data));
                        else SendDetail(who, id, false, data ?? "");
                    });
                    break;
                }
                case Pkt.AskReq:
                {
                    var id = r.ReadString();
                    var question = Limits.Clip(r.ReadString(), 500).Trim();
                    if (question.Length == 0) return;
                    Ask(who, id, question);
                    break;
                }
                case Pkt.FollowReq:
                {
                    var id = r.ReadString();
                    if (string.IsNullOrEmpty(id)) { StopFollow(who); return; }
                    if (StartFollow(who, id, out var msg)) Reply(who, msg, new Color(160, 230, 160));
                    else Reply(who, msg, new Color(255, 120, 120));
                    break;
                }
                case Pkt.GotoReq:
                {
                    var id = r.ReadString();
                    GotoPersona(who, id, out var msg);
                    Reply(who, msg, new Color(160, 230, 160));
                    break;
                }
                default:
                    Log($"未知数据包 {type} 来自 #{who}");
                    break;
            }
        }

        /// <summary>追问访谈（jw.ask 可能需要几十秒）；结果同时发到聊天栏与面板</summary>
        internal void Ask(int who, string personaQuery, string question)
        {
            var t = Text(who);
            var f = _director?.Find(personaQuery);
            if (f == null) { var m = t.T($"没有找到人物“{personaQuery}”。", $"No person named '{personaQuery}'."); Reply(who, m, new Color(255, 120, 120)); SendAskAnswer(who, personaQuery, false, m); return; }
            var name = f.Persona.Name;
            var id = f.Persona.Id;
            Reply(who, t.T($"正在问 {name}：{question}（可能需要几十秒）", $"Asking {name}: {question} (may take a while)"), new Color(200, 200, 200));
            Request(Subjects.Ask, Json.Stringify(new { persona_id = id, question }), TimeSpan.FromSeconds(120), (ok, data) =>
            {
                string text;
                if (!ok) text = t.T("请求失败：", "Request failed: ") + data;
                else
                {
                    var rep = Safe(() => Json.Parse<AskReply>(data!));
                    text = rep == null ? t.T("回答无法解析。", "Unreadable reply.") : t.AskAnswer(rep);
                }
                Reply(who, $"{name}: {text}", new Color(255, 230, 160));
                SendAskAnswer(who, id, ok, text);
            });
        }
    }
}
