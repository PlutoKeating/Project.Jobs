// JobsWorld TShock 插件：从 NATS 拉取城镇布局并建镇；把 jw.snapshot 里的人物同步成假玩家；
// jw.persona.*.say → 头顶气泡；jw.clock → 昼夜；/jw 命令；旁观者保护（无敌、禁 PvP、禁建造）。
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using JobsWorld.Shared.Nats;
using JobsWorld.Shared.Personas;
using JobsWorld.Shared.Protocol;
using JobsWorld.Shared.Schematics;
using JobsWorld.Shared.Town;
using Terraria;
using Terraria.ID;
using Terraria.IO;
using TerrariaApi.Server;
using TShockAPI;
using TShockAPI.Hooks;

namespace JobsWorld.TShock
{
    [ApiVersion(2, 1)]
    public sealed partial class JobsWorldPlugin : TerrariaPlugin
    {
        public override string Name => "JobsWorld";
        public override string Author => "pux";
        public override string Description => "JobsWorld：城镇生成、假玩家人物、想法气泡与 /jw 命令";
        public override Version Version => new Version(0, 1, 0);

        public const string AdminPermission = "jobsworld.admin";

        private NatsClient? _nats;
        private readonly ConcurrentQueue<Action> _main = new ConcurrentQueue<Action>();
        private Snapshot? _latestSnapshot;
        private ClockMsg? _latestClock;
        private readonly ConcurrentQueue<SayMsg> _says = new ConcurrentQueue<SayMsg>();
        private TownLayout? _layout;
        private TownMarker? _marker;
        private FakePlayerDirector? _director;
        private TShockFakePlayers? _host;
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private long _frame;
        private readonly HashSet<int> _sessionAdmins = new HashSet<int>();
        private readonly HashSet<int> _english = new HashSet<int>();
        private readonly Dictionary<int, string> _follow = new Dictionary<int, string>();
        private readonly List<(long frame, Action act)> _delayed = new List<(long, Action)>();
        private volatile bool _townRequested;
        private bool _worldReady;

        private static string Env(string k, string d) => string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(k)) ? d : Environment.GetEnvironmentVariable(k)!;
        private double Now => _clock.Elapsed.TotalSeconds;

        public JobsWorldPlugin(Main game) : base(game) { Order = 10; }

        public override void Initialize()
        {
            TShockFakePlayers.TopSlot = int.Parse(Env("JW_FAKE_TOP_SLOT", "254"));
            TShockFakePlayers.MinSlot = int.Parse(Env("JW_FAKE_MIN_SLOT", "180"));
            _host = new TShockFakePlayers(Log);
            _director = new FakePlayerDirector(_host, TShockFakePlayers.TopSlot, TShockFakePlayers.MinSlot);

            ServerApi.Hooks.GamePostInitialize.Register(this, OnPostInitialize);
            ServerApi.Hooks.GameUpdate.Register(this, OnUpdate);
            Main.OnTickForThirdPartySoftwareOnly += OnIdleTick;
            ServerApi.Hooks.NetGreetPlayer.Register(this, OnGreet);
            ServerApi.Hooks.NetSendData.Register(this, OnSendData);
            ServerApi.Hooks.ServerLeave.Register(this, OnLeave);
            PlayerHooks.PlayerHasBuildPermission += OnBuildPermission;
            PlayerHooks.PlayerPermission += OnPermission;
            Commands.ChatCommands.Add(new Command(JwCommand, "jw", "jobsworld") { HelpText = "JobsWorld：/jw help" });

            var url = Env("NATS_URL", "nats://127.0.0.1:4222");
            _nats = new NatsClient(url, "jobsworld-tshock", Log);
            _nats.Subscribe(Subjects.Snapshot, m => { var s = Safe(() => Json.Parse<Snapshot>(m.Data)); if (s != null) _latestSnapshot = s; });
            _nats.Subscribe(Subjects.Clock, m => { var c = Safe(() => Json.Parse<ClockMsg>(m.Data)); if (c != null) _latestClock = c; });
            _nats.Subscribe(Subjects.SayAll, m => { var s = Safe(() => Json.Parse<SayMsg>(m.Data)); if (s != null) _says.Enqueue(s); });
            _nats.OnConnected += () => { if (_worldReady && _layout == null) RequestTown(); };
            _nats.Start();
            Log($"插件已加载，NATS={url}，假玩家槽位 {TShockFakePlayers.MinSlot}..{TShockFakePlayers.TopSlot}");
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                ServerApi.Hooks.GamePostInitialize.Deregister(this, OnPostInitialize);
                ServerApi.Hooks.GameUpdate.Deregister(this, OnUpdate);
                Main.OnTickForThirdPartySoftwareOnly -= OnIdleTick;
                ServerApi.Hooks.NetGreetPlayer.Deregister(this, OnGreet);
                ServerApi.Hooks.NetSendData.Deregister(this, OnSendData);
                ServerApi.Hooks.ServerLeave.Deregister(this, OnLeave);
                PlayerHooks.PlayerHasBuildPermission -= OnBuildPermission;
                PlayerHooks.PlayerPermission -= OnPermission;
                _nats?.Dispose();
            }
            base.Dispose(disposing);
        }

        internal static void Log(string s) => TShockAPI.TShock.Log.ConsoleInfo("[JobsWorld] " + s);

        private static T? Safe<T>(Func<T?> f) where T : class
        {
            try { return f(); } catch (Exception e) { Log("消息解析失败: " + e.Message); return null; }
        }

        private void RunOnMain(Action a) => _main.Enqueue(a);

        // ---------------- 世界 / 城镇 ----------------

        private void OnPostInitialize(EventArgs args)
        {
            _worldReady = true;
            // 旁观者世界：没有敌怪、不下血月日食
            NPC.defaultMaxSpawns = 0;
            NPC.defaultSpawnRate = int.MaxValue / 2;
            RequestTown();
        }

        private string MarkerPath => Path.Combine(Path.GetDirectoryName(Main.worldPathName) ?? ".", Path.GetFileNameWithoutExtension(Main.worldPathName) + ".jobsworld.json");
        private static string SchematicsDir => Env("JW_SCHEMATICS_DIR", Path.Combine(AppContext.BaseDirectory, "schematics"));

        private void RequestTown()
        {
            if (_townRequested || _nats == null) return;
            _townRequested = true;
            Task.Run(async () =>
            {
                for (int attempt = 1; ; attempt++)
                {
                    try
                    {
                        if (!_nats.Connected) { await Task.Delay(1000); continue; }
                        var msg = await _nats.RequestAsync(Subjects.Town, Array.Empty<byte>(), TimeSpan.FromSeconds(10));
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
        private void EnsureTown(TownLayout layout, bool force)
        {
            _layout = layout;
            var marker = ReadMarker();
            var writer = new TShockTileWriter();
            int ox, oy;
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
                // 出生点：公园（没有则城镇中部街道）
                var park = layout.Places.FirstOrDefault(p => p.Kind == "park");
                int spawnTx = park != null ? park.X + 6 : layout.Width / 2;
                Main.spawnTileX = ox + spawnTx;
                Main.spawnTileY = oy;
                marker = new TownMarker { Version = layout.Version, Builder = TownBuilder.BuilderVersion, OriginX = ox, OriginY = oy, Width = layout.Width, BuiltAt = DateTime.UtcNow.ToString("o"), Stats = stats };
                File.WriteAllText(MarkerPath, Json.Stringify(marker));
                Log($"城镇构建完成，用时 {sw.ElapsedMilliseconds}ms，原点 ({ox},{oy})，出生点 ({Main.spawnTileX},{Main.spawnTileY})；" + string.Join(", ", stats.OrderBy(k => k.Key).Select(k => $"{k.Key}={k.Value}")));
                try { WorldFile.SaveWorld(); Log("世界已保存"); } catch (Exception e) { Log("保存世界失败: " + e.Message); }
                // 让在线客户端重新接收图格分区与世界信息
                for (int i = 0; i < Main.maxNetPlayers; i++)
                {
                    var c = Netplay.Clients[i];
                    if (c?.TileSections != null && c.IsConnected()) Array.Clear(c.TileSections, 0, c.TileSections.Length);
                }
                NetMessage.SendData(MessageID.WorldData);
            }
            _marker = marker;
            if (_director != null) { _director.OriginX = ox; _director.OriginY = oy; _director.Ready = true; }
        }

        private TEditSchematic? LoadSchematic(string file)
        {
            var path = Path.Combine(SchematicsDir, Path.GetFileName(file));
            if (!File.Exists(path)) return null;
            return TEditSchematic.Load(path);
        }

        // ---------------- 主循环 ----------------

        /// <summary>
        /// 原版专用服在没有完整连入的客户端时不调用 Main.Update（GameUpdate 钩子不触发），
        /// 只调用 OnTickForThirdPartySoftwareOnly；两者都走 Pump，保证启动时就能建镇。
        /// </summary>
        private void OnIdleTick() => Pump();

        private void OnUpdate(EventArgs args) => Pump();

        private void Pump()
        {
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
            var d = _director;
            if (d == null || !d.Ready) return;
            var snap = Interlocked.Exchange(ref _latestSnapshot, null);
            if (snap != null) { _lastSnapshot = snap; d.OnSnapshot(snap, Now); }
            while (_says.TryDequeue(out var s)) d.OnSay(s, Now);
            if (_frame % 8 == 0) d.Tick(Now);            // 7.5 Hz
            if (_frame % 60 == 0) { SyncTime(); Follow(); }
            if (_frame % 600 == 0) ClearHostiles();
        }

        private Snapshot? _lastSnapshot;
        private IEnumerable<PersonaLive> People => _lastSnapshot?.Personas.Where(p => p.Visible) ?? Enumerable.Empty<PersonaLive>();

        private void SyncTime()
        {
            var c = _latestClock;
            if (c == null) return;
            var (day, time) = ClockMath.FromMinute(c.Minute);
            Main.dayTime = day;
            Main.time = time;
            Main.bloodMoon = false;
            Main.eclipse = false;
            NetMessage.SendData(MessageID.SetTime);
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
                var tp = TShockAPI.TShock.Players[kv.Key];
                var f = _director.Find(kv.Value);
                if (tp == null || !tp.Active || f == null) { _follow.Remove(kv.Key); continue; }
                float tx = f.CurX + 32 * (f.Dir > 0 ? -1 : 1), ty = f.CurY;
                if (Math.Abs(tp.X - tx) > 6 * 16 || Math.Abs(tp.Y - ty) > 4 * 16) tp.Teleport(tx, ty);
            }
        }

        // ---------------- 网络钩子 ----------------

        private static readonly HashSet<int> PlayerPackets = new HashSet<int> { 4, 5, 12, 13, 14, 16, 30, 35, 40, 41, 42, 43, 45, 50, 51, 55, 58, 62, 66, 80, 84, 96, 99, 117, 118, 135, 138, 142, 147 };

        private void OnSendData(SendDataEventArgs e)
        {
            if (TShockFakePlayers.Sending) return;
            if (PlayerPackets.Contains((int)e.MsgId) && TShockFakePlayers.IsFakeSlot(e.number) && _director?.BySlot(e.number) != null) e.Handled = true;
        }

        private void OnGreet(GreetPlayerEventArgs e)
        {
            int who = e.Who;
            var tp = TShockAPI.TShock.Players[who];
            if (tp == null) return;
            tp.GodMode = true;
            // 新玩家：补发全部假玩家（立即一次，3 秒后再补一次以防客户端尚未就绪）
            void Push() { if (_host == null || _director == null) return; _director.ForEach(f => _host.SpawnTo(who, f.Slot, f.Persona, f.CurX, f.CurY, f.Dir)); }
            Push();
            _delayed.Add((_frame + 180, Push));
            var t = Text(tp);
            tp.SendInfoMessage(t.T("欢迎来到 JobsWorld！输入 /jw help 查看命令；/jw who 看看大家在做什么。", "Welcome to JobsWorld! /jw help for commands, /jw who to see what everyone is doing."));
        }

        private void OnLeave(LeaveEventArgs e)
        {
            _sessionAdmins.Remove(e.Who);
            _english.Remove(e.Who);
            _follow.Remove(e.Who);
        }

        private bool IsAdmin(TSPlayer p) => _sessionAdmins.Contains(p.Index) || p.HasPermission(AdminPermission) || p.Group?.HasPermission("*") == true;

        private void OnBuildPermission(PlayerHasBuildPermissionEventArgs e)
        {
            if (e.Player != null && _sessionAdmins.Contains(e.Player.Index)) e.Result = PermissionHookResult.Granted;
        }

        private void OnPermission(PlayerPermissionEventArgs e)
        {
            if (e.Player != null && _sessionAdmins.Contains(e.Player.Index) && (e.Permission == AdminPermission || e.Permission == Permissions.antibuild))
                e.Result = PermissionHookResult.Granted;
        }
    }
}
