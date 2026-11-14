// 服务端 ↔ 客户端 ModPacket 协议（同一个 mod 的两端，字段顺序即协议）。
// 人物数据的权威来源是 NATS（只有服务端连接 NATS）；客户端需要的一切都经由这些包转发。
using System;
using System.Collections.Generic;
using System.IO;

namespace JobsWorld.Common
{
    public enum Pkt : byte
    {
        // ---- 服务端 → 客户端 ----
        /// <summary>string apiBase（可为空：客户端用连接的主机与端口）, bool admin, bool en, string townName, ushort n × (id, zh, en) 地点名</summary>
        Hello = 1,
        /// <summary>ushort n × RosterEntry：假玩家槽位 ↔ 人物（悬停 / 点击识别用）</summary>
        Roster = 2,
        /// <summary>string clock, string date, bool paused, float speed, ushort usingApps, ushort total</summary>
        Hud = 3,
        /// <summary>string personaId, bool ok, string json（jw.detail 原始应答或错误信息）</summary>
        Detail = 4,
        /// <summary>string personaId, bool ok, string text</summary>
        AskAnswer = 5,
        /// <summary>string personaId（空 = 未跟随）</summary>
        FollowState = 6,

        // ---- 客户端 → 服务端 ----
        /// <summary>string personaId</summary>
        DetailReq = 20,
        /// <summary>string personaId, string question</summary>
        AskReq = 21,
        /// <summary>string personaId（空 = 取消跟随）</summary>
        FollowReq = 22,
        /// <summary>string personaId</summary>
        GotoReq = 23,
    }

    /// <summary>假玩家槽位上的人物（客户端只需要这些就能识别和显示悬停提示）</summary>
    public sealed class RosterEntry
    {
        public byte Slot;
        public string Id = "";
        public string Name = "";
        public string Occupation = "";
        public int Age;
        public string Mode = "";
        public string App = "";
        public string Activity = "";

        public void Write(BinaryWriter w)
        {
            w.Write(Slot); w.Write(Id); w.Write(Name); w.Write(Occupation); w.Write((ushort)Math.Clamp(Age, 0, 65535));
            w.Write(Mode); w.Write(App); w.Write(Activity);
        }

        public static RosterEntry Read(BinaryReader r) => new RosterEntry
        {
            Slot = r.ReadByte(), Id = r.ReadString(), Name = r.ReadString(), Occupation = r.ReadString(), Age = r.ReadUInt16(),
            Mode = r.ReadString(), App = r.ReadString(), Activity = r.ReadString(),
        };

        public string Key() => string.Join("|", Slot, Id, Name, Occupation, Age, Mode, App, Activity);

        public static List<RosterEntry> ReadList(BinaryReader r)
        {
            int n = r.ReadUInt16();
            var list = new List<RosterEntry>(n);
            for (int i = 0; i < n; i++) list.Add(Read(r));
            return list;
        }
    }

    public static class Env
    {
        public static string Get(string key, string fallback)
        {
            var v = Environment.GetEnvironmentVariable(key);
            return string.IsNullOrWhiteSpace(v) ? fallback : v;
        }

        public static int Int(string key, int fallback) => int.TryParse(Environment.GetEnvironmentVariable(key), out var v) ? v : fallback;
    }

    /// <summary>ModPacket 里的字符串上限（单包 ≤ 65535 字节）</summary>
    public static class Limits
    {
        public const int DetailJson = 60000;
        public const int Text = 4000;

        public static string Clip(string? s, int max)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s!.Length <= max ? s : s.Substring(0, max);
        }
    }
}
