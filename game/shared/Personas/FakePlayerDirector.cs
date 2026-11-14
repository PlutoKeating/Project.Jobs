// 假玩家调度：jw.snapshot 中的人物 → 固定的玩家槽位（从 254 向下分配），平滑插值位置，
// 气泡限流。只决定“做什么”，真正发包由宿主（TShock / tModLoader）实现 IFakePlayerHost。
// 线程：所有方法都应在游戏主线程调用（NATS 回调先入队，再在主线程 Update 中处理）。
using System;
using System.Collections.Generic;
using System.Linq;
using JobsWorld.Shared.Protocol;

namespace JobsWorld.Shared.Personas
{
    public interface IFakePlayerHost
    {
        /// <summary>让所有真实客户端看到该槽位上的玩家（PlayerActive + PlayerInfo + 装备 + 生命 + 位置）</summary>
        void Spawn(int slot, PersonaLive p, float px, float py, int dir);
        /// <summary>外观或名字变化时重发 PlayerInfo</summary>
        void UpdateInfo(int slot, PersonaLive p);
        /// <summary>位置同步（PlayerUpdate）。px/py 为玩家左上角的世界像素坐标</summary>
        void Move(int slot, float px, float py, float vx, float vy, int dir);
        /// <summary>从所有客户端移除该槽位</summary>
        void Despawn(int slot);
        /// <summary>以该玩家身份广播一条聊天（原版客户端显示在头顶）</summary>
        void Say(int slot, string text, byte r, byte g, byte b);
    }

    public sealed class FakePlayer
    {
        public int Slot;
        public PersonaLive Persona = new PersonaLive();
        public string AppearanceKey = "";
        public float FromX, FromY, ToX, ToY, CurX, CurY;
        public double T0;
        public int Dir = 1;
        public double LastMoveSent;
        public double LastSay = -1000;
        public (string text, string tone)? PendingSay;
        public double LastSeen;
    }

    public sealed class FakePlayerDirector
    {
        public const int PlayerWidth = 20, PlayerHeight = 42;
        public const double SayInterval = 6.0;
        private readonly IFakePlayerHost _host;
        private readonly Dictionary<string, FakePlayer> _byId = new Dictionary<string, FakePlayer>();
        private readonly int _topSlot, _maxCount, _minSlot;
        public int OriginX { get; set; }
        public int OriginY { get; set; }
        public bool Ready { get; set; }

        /// <param name="topSlot">最高槽位（含），通常 254</param>
        /// <param name="minSlot">最低可用槽位（含）：必须大于服务器真实玩家槽位上限</param>
        public FakePlayerDirector(IFakePlayerHost host, int topSlot, int minSlot)
        {
            _host = host; _topSlot = topSlot; _minSlot = minSlot; _maxCount = topSlot - minSlot + 1;
        }

        public IEnumerable<FakePlayer> All => _byId.Values;
        public int Count => _byId.Count;

        /// <summary>城镇图格坐标 → 玩家左上角像素坐标（脚踩在 ty 行的上表面）</summary>
        public (float px, float py) ToWorldPixels(double tx, double ty)
        {
            float cx = (float)((OriginX + tx) * 16 + 8);
            float feet = (float)((OriginY + ty) * 16);
            return (cx - PlayerWidth / 2f, feet - PlayerHeight);
        }

        public FakePlayer? Find(string query)
        {
            if (string.IsNullOrWhiteSpace(query)) return null;
            query = query.Trim();
            var exact = _byId.Values.FirstOrDefault(f => string.Equals(f.Persona.Name, query, StringComparison.OrdinalIgnoreCase) || f.Persona.Id == query);
            if (exact != null) return exact;
            return _byId.Values.FirstOrDefault(f => f.Persona.Name.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0);
        }

        public FakePlayer? BySlot(int slot) => _byId.Values.FirstOrDefault(f => f.Slot == slot);

        public void OnSnapshot(Snapshot snap, double now)
        {
            if (!Ready) return;
            var seen = new HashSet<string>();
            foreach (var p in snap.Personas.Where(p => p.Visible).OrderBy(p => p.Id, StringComparer.Ordinal))
            {
                seen.Add(p.Id);
                var (px, py) = ToWorldPixels(p.X, p.Y);
                if (!_byId.TryGetValue(p.Id, out var f))
                {
                    int slot = FreeSlot();
                    if (slot < 0) continue;
                    f = new FakePlayer { Slot = slot, Persona = p, AppearanceKey = p.Appearance.Key() + "|" + p.Name, FromX = px, FromY = py, ToX = px, ToY = py, CurX = px, CurY = py, T0 = now, Dir = p.Facing >= 0 ? 1 : -1, LastSeen = now };
                    _byId[p.Id] = f;
                    _host.Spawn(slot, p, px, py, f.Dir);
                    f.LastMoveSent = now;
                    continue;
                }
                var key = p.Appearance.Key() + "|" + p.Name;
                f.Persona = p;
                f.LastSeen = now;
                if (key != f.AppearanceKey) { f.AppearanceKey = key; _host.UpdateInfo(f.Slot, p); }
                // 跨楼层或距离过远：直接瞬移
                if (Math.Abs(px - f.CurX) > 30 * 16 || Math.Abs(py - f.CurY) > 2)
                {
                    f.FromX = f.ToX = f.CurX = px; f.FromY = f.ToY = f.CurY = py; f.T0 = now;
                    f.Dir = p.Facing >= 0 ? 1 : -1;
                    _host.Move(f.Slot, px, py, 0, 0, f.Dir);
                    f.LastMoveSent = now;
                }
                else
                {
                    f.FromX = f.CurX; f.FromY = f.CurY; f.ToX = px; f.ToY = py; f.T0 = now;
                    if (Math.Abs(px - f.CurX) > 1) f.Dir = px > f.CurX ? 1 : -1; else f.Dir = p.Facing >= 0 ? 1 : -1;
                }
            }
            foreach (var id in _byId.Keys.Where(k => !seen.Contains(k)).ToList())
            {
                _host.Despawn(_byId[id].Slot);
                _byId.Remove(id);
            }
        }

        /// <summary>主线程定时调用（建议 8Hz）：推进插值、发送位置、冲刷积压的气泡</summary>
        public void Tick(double now, double snapshotInterval = 1.0)
        {
            foreach (var f in _byId.Values)
            {
                double a = Math.Min(1.0, (now - f.T0) / snapshotInterval);
                float nx = (float)(f.FromX + (f.ToX - f.FromX) * a);
                float ny = (float)(f.FromY + (f.ToY - f.FromY) * a);
                bool moving = a < 1.0 && (Math.Abs(f.ToX - f.FromX) > 0.5f);
                float vx = moving ? (float)((f.ToX - f.FromX) / snapshotInterval / 60.0) : 0f; // 像素/帧
                bool changed = Math.Abs(nx - f.CurX) > 0.25f || Math.Abs(ny - f.CurY) > 0.25f;
                f.CurX = nx; f.CurY = ny;
                if (changed || now - f.LastMoveSent > 2.0)
                {
                    _host.Move(f.Slot, nx, ny, vx, 0, f.Dir);
                    f.LastMoveSent = now;
                }
                if (f.PendingSay.HasValue && now - f.LastSay >= SayInterval)
                {
                    var (text, tone) = f.PendingSay.Value;
                    f.PendingSay = null;
                    f.LastSay = now;
                    var (r, g, b) = ToneColor(tone);
                    _host.Say(f.Slot, text, r, g, b);
                }
            }
        }

        /// <summary>收到 jw.persona.*.say：在限流允许时立即说，否则只保留最新一条</summary>
        public void OnSay(SayMsg m, double now)
        {
            if (!_byId.TryGetValue(m.PersonaId, out var f)) return;
            var text = Shorten(m.Text, 90);
            if (text.Length == 0) return;
            if (now - f.LastSay >= SayInterval)
            {
                f.LastSay = now;
                var (r, g, b) = ToneColor(m.Tone);
                _host.Say(f.Slot, text, r, g, b);
            }
            else f.PendingSay = (text, m.Tone);
        }

        /// <summary>给新加入的客户端补发全部假玩家（宿主在 Spawn 的单播版本里实现）</summary>
        public void ForEach(Action<FakePlayer> fn) { foreach (var f in _byId.Values) fn(f); }

        /// <summary>全部移除（插件卸载 / 城镇重建时）</summary>
        public void Clear()
        {
            foreach (var f in _byId.Values) _host.Despawn(f.Slot);
            _byId.Clear();
        }

        public static (byte r, byte g, byte b) ToneColor(string? tone) => tone switch
        {
            "angry" => ((byte)255, (byte)90, (byte)80),
            "confused" => ((byte)255, (byte)220, (byte)90),
            "happy" => ((byte)120, (byte)230, (byte)120),
            _ => ((byte)255, (byte)255, (byte)255),
        };

        public static string Shorten(string? s, int max)
        {
            if (string.IsNullOrWhiteSpace(s)) return "";
            var t = s!.Replace('\n', ' ').Replace('\r', ' ').Trim();
            return t.Length <= max ? t : t.Substring(0, max - 1) + "…";
        }

        private int FreeSlot()
        {
            var used = new HashSet<int>(_byId.Values.Select(f => f.Slot));
            for (int s = _topSlot; s >= _minSlot && _topSlot - s < _maxCount; s--) if (!used.Contains(s)) return s;
            return -1;
        }
    }
}
