// JobsWorld 服务端：NATS 连接、城镇构建、假玩家调度、昼夜同步、旁观者保护，以及给客户端面板 / HUD 转发数据。
// 只在专用服务器（Main.dedServ）上运行；所有 NATS 回调先入队，再在游戏主线程（Main.OnTickForThirdPartySoftwareOnly）处理。
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using JobsWorld.Common;
using JobsWorld.Shared.Nats;
using JobsWorld.Shared.Personas;
using JobsWorld.Shared.Protocol;
using JobsWorld.Shared.Schematics;
using JobsWorld.Shared.Town;
using Microsoft.Xna.Framework;
using Terraria;
using Terraria.Chat;
using Terraria.ID;
using Terraria.IO;
using Terraria.Localization;
using Terraria.ModLoader;

namespace JobsWorld.Server
{
    public sealed partial class JwServerSystem : ModSystem
    {
        private NatsClient? _nats;
        private readonly ConcurrentQueue<Action> _main = new ConcurrentQueue<Action>();
        private Snapshot? _latestSnapshot;
        private Snapshot? _lastSnapshot;
        private ClockMsg? _latestClock;
        private readonly ConcurrentQueue<SayMsg> _says = new ConcurrentQueue<SayMsg>();
        private TownLayout? _layout;
        private TownMarker? _marker;
        private FakePlayerDirector? _director;
        private TmlFakePlayers? _host;
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private long _frame;
        private readonly bool[] _joined = new bool[256];
        private readonly HashSet<int> _admins = new HashSet<int>();
        private readonly HashSet<int> _english = new HashSet<int>();
        private readonly Dictionary<int, string> _follow = new Dictionary<int, string>();
        private readonly List<(long frame, Action act)> _delayed = new List<(long, Action)>();
        private volatile bool _townRequested;
        private bool _worldReady;
        private string _rosterKey = "";
        private long _rosterSentFrame;

        private double Now => _clock.Elapsed.TotalSeconds;
        public bool NatsConnected => _nats?.Connected == true;
        public FakePlayerDirector? Director => _director;
        public TownLayout? Layout => _layout;
        public TownMarker? Marker => _marker;
        public ClockMsg? LatestClock => _latestClock;
        public IEnumerable<PersonaLive> People => _lastSnapshot?.Personas.Where(p => p.Visible) ?? Enumerable.Empty<PersonaLive>();

        internal static void Log(string s)
        {
            Console.WriteLine("[JobsWorld] " + s);
            ModContent.GetInstance<JobsWorldMod>()?.Logger.Info(s);
        }

        private static T? Safe<T>(Func<T?> f) where T : class
        {
            try { return f(); } catch (Exception e) { Log("消息解析失败: " + e.Message); return null; }
        }

        internal void RunOnMain(Action a) => _main.Enqueue(a);

        // ---------------- 生命周期 ----------------

        public override void OnModLoad()
        {
            if (!Main.dedServ) return;
            TmlFakePlayers.TopSlot = Math.Clamp(Env.Int("JW_FAKE_TOP_SLOT", 254), 1, 254);
            TmlFakePlayers.MinSlot = Math.Clamp(Env.Int("JW_FAKE_MIN_SLOT", 180), 1, TmlFakePlayers.TopSlot);
            _host = new TmlFakePlayers(Log);
            _director = new FakePlayerDirector(_host, TmlFakePlayers.TopSlot, TmlFakePlayers.MinSlot);

            var url = Env.Get("NATS_URL", "nats://127.0.0.1:4222");
            _nats = new NatsClient(url, "jobsworld-tmodloader", Log);
            _nats.Subscribe(Subjects.Snapshot, m => { var s = Safe(() => Json.Parse<Snapshot>(m.Data)); if (s != null) _latestSnapshot = s; });
            _nats.Subscribe(Subjects.Clock, m => { var c = Safe(() => Json.Parse<ClockMsg>(m.Data)); if (c != null) _latestClock = c; });
            _nats.Subscribe(Subjects.SayAll, m => { var s = Safe(() => Json.Parse<SayMsg>(m.Data)); if (s != null) _says.Enqueue(s); });
            _nats.OnConnected += () => { Log("NATS 已连接"); if (_worldReady && _layout == null) RequestTown(); };
            _nats.Start();
            Main.OnTickForThirdPartySoftwareOnly += ServerTick;
            Log($"mod 已加载，NATS={url}，假玩家槽位 {TmlFakePlayers.MinSlot}..{TmlFakePlayers.TopSlot}");
        }

        public override void Unload()
        {
            Main.OnTickForThirdPartySoftwareOnly -= ServerTick;
            _nats?.Dispose();
            _nats = null;
        }

        public override void OnWorldLoad()
        {
            if (!Main.dedServ) return;
            _worldReady = true;
            Main.bloodMoon = false;
            Main.eclipse = false;
            RequestTown();
        }

        public override void OnWorldUnload()
        {
            if (!Main.dedServ) return;
            _worldReady = false;
            _director?.Clear();
            if (_director != null) _director.Ready = false;
        }

        // ---------------- 城镇 ----------------

        private string MarkerPath => Path.Combine(Path.GetDirectoryName(Main.worldPathName) ?? ".", Path.GetFileNameWithoutExtension(Main.worldPathName) + ".jobsworld.json");
        private static string SchematicsDir => Env.Get("JW_SCHEMATICS_DIR", Path.Combine(AppContext.BaseDirectory, "schematics"));

        private void RequestTown()
        {
            if (_townRequested || _nats == null) return;
            _townRequested = true;
            var nats = _nats;
            Task.Run(async () =>
            {
                for (int attempt = 1; ; attempt++)
                {
                    try
                    {
                        if (!nats.Connected) { await Task.Delay(1000); continue; }
                        var msg = await nats.RequestAsync(Subjects.Town, Array.Empty<byte>(), TimeSpan.FromSeconds(10));
                        var layout = Json.Parse<TownLayout>(msg.Data);
                        if (layout == null || layout.Prims.Count == 0) throw new InvalidDataException("城镇布局为空");
                        Log($"收到城镇布局 {layout.Id} v{layout.Version}（{msg.Data.Length} 字节，{layout.Prims.Count} 个图元）");
                        RunOnMain(() => EnsureTown(layout, force: false));
                        return;
                    }
                    catch (Exception e)
                    {
                        if (attempt == 1 || attempt % 10 == 0) Log($"获取城镇布局失败（第 {attempt} 次）：{e.Message}；稍后重试");
                        await Task.Delay(3000);
                    }
                }
            });
        }

        private TownMarker? ReadMarker()
        {
            try { return File.Exists(MarkerPath) ? Json.Parse<TownMarker>(File.ReadAllText(MarkerPath)) : null; }
            catch (Exception e) { Log("读取城镇标记失败: " + e.Message); return null; }
        }

        /// <summary>主线程：版本一致则直接使用；否则在原位置（首次则在出生点附近）重建</summary>
        internal void EnsureTown(TownLayout layout, bool force)
        {
            _layout = layout;
            var marker = ReadMarker();
            var writer = new TmlTileWriter();
            int ox, oy;
            // 布局版本与构建器版本都没变才跳过；否则在原位置重建
            if (marker != null && marker.Version == layout.Version && marker.Builder == TownBuilder.BuilderVersion && !force)
            {
                ox = marker.OriginX; oy = marker.OriginY;
                Log($"城镇已是最新（v{layout.Version}，构建器 v{TownBuilder.BuilderVersion}），原点 ({ox},{oy})，跳过构建");
            }
            else
            {
                if (marker != null) { ox = marker.OriginX; oy = marker.OriginY; }
                else (ox, oy) = TownBuilder.ChoosePlacement(writer, Main.spawnTileX, layout.Width, layout.MinY());
                var sw = Stopwatch.StartNew();
                _director?.Clear();
                var builder = new TownBuilder(writer, ox, oy, Log, LoadSchematic);
                var stats = builder.Build(layout);
                var park = layout.Places.FirstOrDefault(p => p.Kind == "park");
                int spawnTx = park != null ? park.X + 6 : layout.Width / 2;
                Main.spawnTileX = ox + spawnTx;
                Main.spawnTileY = oy;
                marker = new TownMarker { Version = layout.Version, Builder = TownBuilder.BuilderVersion, OriginX = ox, OriginY = oy, Width = layout.Width, BuiltAt = DateTime.UtcNow.ToString("o"), Stats = stats };
                File.WriteAllText(MarkerPath, Json.Stringify(marker));
                Log($"城镇构建完成，用时 {sw.ElapsedMilliseconds}ms，原点 ({ox},{oy})，出生点 ({Main.spawnTileX},{Main.spawnTileY})；" + string.Join(", ", stats.OrderBy(k => k.Key).Select(k => $"{k.Key}={k.Value}")));
                try { WorldFile.SaveWorld(); Log("世界已保存"); } catch (Exception e) { Log("保存世界失败: " + e.Message); }
                // 在线客户端重新接收图格分区与世界信息
                for (int i = 0; i < 255; i++)
                {
                    var c = Netplay.Clients[i];
                    if (c != null && c.IsConnected()) c.ResetSections();
                }
                NetMessage.SendData(MessageID.WorldData);
            }
            _marker = marker;
            if (_director != null) { _director.OriginX = ox; _director.OriginY = oy; _director.Ready = true; }
            // 地点名随 Hello 下发给已在线的客户端（面板显示地点用）
            for (int i = 0; i < 255; i++) if (_joined[i]) SendHello(i);
        }

        private TEditSchematic? LoadSchematic(string file)
        {
            var path = Path.Combine(SchematicsDir, Path.GetFileName(file));
            if (!File.Exists(path)) return null;
            return TEditSchematic.Load(path);
        }

        // ---------------- 主循环 ----------------

        /// <summary>
        /// 专用服务器主循环每帧（60 Hz）调用。没有玩家在线时原版不跑 Main.Update（PostUpdateEverything 也不会被调用），
        /// 但城镇构建、假玩家状态必须照常推进，所以挂在 Main.OnTickForThirdPartySoftwareOnly 上（同样在主线程）。
        /// </summary>
        private void ServerTick()
        {
            if (!Main.dedServ || !_worldReady) return;
            _frame++;
            while (_main.TryDequeue(out var a))
            {
                try { a(); } catch (Exception e) { Log("主线程任务异常: " + e); }
            }
            for (int i = _delayed.Count - 1; i >= 0; i--)
            {
                if (_delayed[i].frame > _frame) continue;
                var act = _delayed[i].act; _delayed.RemoveAt(i);
                try { act(); } catch (Exception e) { Log("延迟任务异常: " + e); }
            }
            if (_frame % 30 == 0) DetectJoins();
            var d = _director;
            if (d == null || !d.Ready) return;
            var snap = Interlocked.Exchange(ref _latestSnapshot, null);
            if (snap != null) { _lastSnapshot = snap; d.OnSnapshot(snap, Now); }
            while (_says.TryDequeue(out var s)) d.OnSay(s, Now);
            if (_frame % 8 == 0) d.Tick(Now);            // 7.5 Hz
            if (_frame % 60 == 0) { SyncTime(); Follow(); BroadcastHud(); BroadcastRoster(false); }
            if (_frame % 600 == 0) ClearHostiles();
        }

        /// <summary>按世界时钟的倍速推进 Terraria 时间（1 世界分钟 = 3600 帧 × 倍速⁻¹）；客户端用 HUD 包里的倍速做同样的事</summary>
        public override void ModifyTimeRate(ref double timeRate, ref double tileUpdateRate, ref double eventUpdateRate)
        {
            var c = Main.dedServ ? _latestClock : null;
            if (Main.dedServ && c != null) timeRate = c.Paused ? 0 : c.Speed / 60.0;
            else if (!Main.dedServ && Main.netMode == NetmodeID.MultiplayerClient)
            {
                var r = ModContent.GetInstance<Client.JwClientSystem>().TimeRate;
                if (r.HasValue) timeRate = r.Value;
            }
        }

        private void SyncTime()
        {
            var c = _latestClock;
            if (c == null) return;
            var (day, time) = ClockMath.FromMinute(c.Minute);
            Main.bloodMoon = false;
            Main.eclipse = false;
            Main.pumpkinMoon = false;
            Main.snowMoon = false;
            if (Main.dayTime != day || Math.Abs(Main.time - time) > 90 || _frame % 600 == 0)
            {
                Main.dayTime = day;
                Main.time = time;
                NetMessage.SendData(MessageID.WorldData);
            }
        }

        private void ClearHostiles()
        {
            for (int i = 0; i < Main.maxNPCs; i++)
            {
                var n = Main.npc[i];
                if (n.active && !n.friendly && !n.townNPC && n.damage > 0)
                {
                    n.active = false;
                    NetMessage.SendData(MessageID.SyncNPC, -1, -1, null, i);
                }
            }
        }

        private void Follow()
        {
            if (_director == null) return;
            foreach (var kv in _follow.ToList())
            {
                var p = Main.player[kv.Key];
                var f = _director.Find(kv.Value);
                if (!p.active || f == null) { _follow.Remove(kv.Key); SendFollowState(kv.Key, ""); continue; }
                float tx = f.CurX + 32 * (f.Dir > 0 ? -1 : 1), ty = f.CurY;
                if (Math.Abs(p.position.X - tx) > 6 * 16 || Math.Abs(p.position.Y - ty) > 4 * 16) Teleport(kv.Key, new Vector2(tx, ty));
            }
        }

        /// <summary>服务器发起的传送：先补发目标区域的图格分区，再发 TeleportEntity（客户端对自己的位置有权威）</summary>
        internal static void Teleport(int who, Vector2 pos)
        {
            if (who < 0 || who >= 255 || !Main.player[who].active) return;
            pos.X = Math.Clamp(pos.X, 16 * 2, (Main.maxTilesX - 3) * 16);
            pos.Y = Math.Clamp(pos.Y, 16 * 2, (Main.maxTilesY - 4) * 16);
            RemoteClient.CheckSection(who, pos, 2);
            Main.player[who].Teleport(pos, TeleportationStyleID.RodOfDiscord);
            NetMessage.SendData(MessageID.TeleportEntity, -1, -1, null, 0, who, pos.X, pos.Y, TeleportationStyleID.RodOfDiscord);
        }

        // ---------------- 玩家加入 / 离开 ----------------

        private void DetectJoins()
        {
            for (int i = 0; i < 255; i++)
            {
                if (TmlFakePlayers.IsFakeSlot(i)) continue;
                var c = Netplay.Clients[i];
                bool inWorld = c != null && c.IsConnected() && c.State == 10 && Main.player[i].active;
                if (inWorld && !_joined[i]) { _joined[i] = true; OnJoin(i); }
                else if (!inWorld && _joined[i]) { _joined[i] = false; OnLeave(i); }
            }
        }

        private void OnJoin(int who)
        {
            Log($"玩家加入 #{who} {Main.player[who].name}");
            // 新玩家：补发全部假玩家（立即一次，3 秒后再补一次以防客户端尚未就绪）
            void Push()
            {
                if (!_joined[who] || _host == null || _director == null) return;
                _director.ForEach(f => _host.SpawnTo(who, f.Slot, f.Persona, f.CurX, f.CurY, f.Dir));
                SendHello(who);
                SendRoster(who);
            }
            Push();
            _delayed.Add((_frame + 180, Push));
            Reply(who, T(who, "欢迎来到 JobsWorld！点击人物查看详情；输入 /jw help 查看命令。", "Welcome to JobsWorld! Click a person for details; /jw help for commands."), new Color(255, 210, 127));
        }

        private void OnLeave(int who)
        {
            _admins.Remove(who);
            _english.Remove(who);
            _follow.Remove(who);
        }

        // ---------------- 网络钩子 ----------------

        private static readonly HashSet<int> PlayerPackets = new HashSet<int> { 4, 5, 12, 13, 14, 16, 30, 35, 40, 41, 42, 43, 45, 50, 51, 55, 58, 62, 66, 80, 84, 96, 99, 117, 118, 135, 138, 142, 147 };

        public override bool HijackSendData(int whoAmI, int msgType, int remoteClient, int ignoreClient, NetworkText text, int number, float number2, float number3, float number4, int number5, int number6, int number7)
        {
            if (!Main.dedServ || TmlFakePlayers.Sending) return false;
            return PlayerPackets.Contains(msgType) && TmlFakePlayers.IsFakeSlot(number) && _director?.BySlot(number) != null;
        }

        /// <summary>改动世界的客户端消息：非管理员一律丢弃，并把该处图格重发给他（撤销客户端本地的预测）</summary>
        private static readonly HashSet<byte> WorldEdits = new HashSet<byte>
        {
            MessageID.TileManipulation, MessageID.TileSquare, MessageID.ReadSign, MessageID.LiquidUpdate, MessageID.PaintTile, MessageID.PaintWall,
            MessageID.PlaceObject, MessageID.TileEntityPlacement, MessageID.MassWireOperation,
        };

        public override bool HijackGetData(ref byte messageType, ref BinaryReader reader, int playerNumber)
        {
            if (!Main.dedServ || !WorldEdits.Contains(messageType) || IsAdmin(playerNumber)) return false;
            try
            {
                var s = reader.BaseStream;
                long pos = s.Position;
                int x = -1, y = -1;
                if (messageType == MessageID.TileManipulation) { reader.ReadByte(); x = reader.ReadInt16(); y = reader.ReadInt16(); }
                else if (messageType == MessageID.TileSquare || messageType == MessageID.PlaceObject || messageType == MessageID.LiquidUpdate
                    || messageType == MessageID.PaintTile || messageType == MessageID.PaintWall || messageType == MessageID.TileEntityPlacement) { x = reader.ReadInt16(); y = reader.ReadInt16(); }
                else if (messageType == MessageID.ReadSign) { reader.ReadInt16(); x = reader.ReadInt16(); y = reader.ReadInt16(); }
                s.Position = pos;
                if (x >= 0 && y >= 0 && x < Main.maxTilesX && y < Main.maxTilesY) NetMessage.SendTileSquare(playerNumber, x, y, 6);
            }
            catch { }
            return true;
        }

        // ---------------- 管理员 / 文本 ----------------

        internal bool IsAdmin(int who) => who >= 0 && _admins.Contains(who);
        internal bool En(int who) => who >= 0 && _english.Contains(who);
        internal string T(int who, string zh, string en) => En(who) ? en : zh;
        internal WorldText Text(int who) => new WorldText(En(who), id => _layout?.Places.FirstOrDefault(x => x.Id == id)?.Name);

        internal bool Login(int who, string pass)
        {
            var expect = Environment.GetEnvironmentVariable("JW_ADMIN_PASSCODE");
            if (string.IsNullOrEmpty(expect) || who < 0 || pass != expect) return false;
            _admins.Add(who);
            SendHello(who);
            return true;
        }

        internal void SetLang(int who, bool en)
        {
            if (who < 0) return;
            if (en) _english.Add(who); else _english.Remove(who);
        }

        /// <summary>给玩家发一条消息（who &lt; 0 时输出到服务器控制台）</summary>
        internal static void Reply(int who, string text, Color color)
        {
            if (who < 0 || who >= 255) { Console.WriteLine(text); return; }
            ChatHelper.SendChatMessageToClient(NetworkText.FromLiteral(text), color, who);
        }

        // ---------------- 跟随 / 传送 ----------------

        internal bool StartFollow(int who, string query, out string message)
        {
            var t = Text(who);
            var f = _director?.Find(query);
            if (f == null) { message = t.T($"没有找到人物“{query}”。", $"No person named '{query}'."); return false; }
            _follow[who] = f.Persona.Id;
            Teleport(who, new Vector2(f.CurX - 32, f.CurY));
            SendFollowState(who, f.Persona.Id);
            message = t.T($"开始跟随 {f.Persona.Name}（/jw follow off 取消）。", $"Following {f.Persona.Name} (/jw follow off to stop).");
            return true;
        }

        internal bool StopFollow(int who)
        {
            bool had = _follow.Remove(who);
            SendFollowState(who, "");
            return had;
        }

        internal string? FollowingId(int who) => _follow.TryGetValue(who, out var id) ? id : null;

        internal bool GotoPersona(int who, string query, out string message)
        {
            var t = Text(who);
            var f = _director?.Find(query);
            if (f == null) { message = t.T($"没有找到人物“{query}”。", $"No person named '{query}'."); return false; }
            Teleport(who, new Vector2(f.CurX + 24 * (f.Dir > 0 ? -1 : 1), f.CurY));
            message = t.T($"已传送到 {f.Persona.Name} 身边。", $"Teleported next to {f.Persona.Name}.");
            return true;
        }

        internal PlaceLayout? FindPlace(string q)
        {
            if (_layout == null) return null;
            q = q.Trim();
            return _layout.Places.FirstOrDefault(x => string.Equals(x.Id, q, StringComparison.OrdinalIgnoreCase) || x.Name.Zh == q || string.Equals(x.Name.En, q, StringComparison.OrdinalIgnoreCase))
                ?? _layout.Places.FirstOrDefault(x => x.Name.Zh.Contains(q) || x.Name.En.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0 || x.Kind == q);
        }

        internal bool GotoPlace(int who, PlaceLayout place)
        {
            if (_director == null || !_director.Ready || _layout == null) return false;
            var spot = _layout.Spots.FirstOrDefault(s => s.PlaceId == place.Id);
            double tx = spot?.X ?? place.X + place.W / 2.0, ty = spot?.Y ?? 0;
            var (px, py) = _director.ToWorldPixels(tx, ty);
            Teleport(who, new Vector2(px, py));
            return true;
        }

        // ---------------- NATS 请求 ----------------

        /// <summary>NATS 请求；回调在主线程执行（ok=false 时 data 为错误信息）</summary>
        internal void Request(string subject, string body, TimeSpan timeout, Action<bool, string?> done)
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

        /// <summary>管理员调试：把 schematics 目录里的 .TEditSch 以玩家脚下为左下角粘贴（不写入布局）</summary>
        internal string Paste(int who, string file)
        {
            var t = Text(who);
            var s = LoadSchematic(file.EndsWith(".TEditSch", StringComparison.OrdinalIgnoreCase) ? file : file + ".TEditSch");
            if (s == null) return t.T("蓝图不存在：", "Schematic not found: ") + file;
            var pl = Main.player[who];
            int left = (int)(pl.position.X / 16), bottom = (int)((pl.position.Y + pl.height) / 16) + 1;
            int n = s.Paste(new TmlTileWriter(), left, bottom);
            WorldGen.RangeFrame(left, bottom - s.Height, left + s.Width, bottom + 1);
            for (int cx = left; cx < left + s.Width; cx += 32)
                for (int cy = bottom - s.Height + 1; cy <= bottom; cy += 32)
                    NetMessage.SendTileSquare(-1, cx, cy, Math.Min(32, left + s.Width - cx), Math.Min(32, bottom + 1 - cy));
            Log($"{pl.name} 粘贴蓝图 {file} 于 ({left},{bottom})：{s.Width}x{s.Height}，{n} 格");
            return t.T($"已粘贴 {s.Name}（{s.Width}×{s.Height}，{n} 格，V{s.FormatVersion}）", $"Pasted {s.Name} ({s.Width}x{s.Height}, {n} tiles, V{s.FormatVersion})");
        }

        internal void Rebuild()
        {
            if (_layout != null) EnsureTown(_layout, force: true);
        }
    }
}
