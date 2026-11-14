// JobsWorld 客户端：接收服务端转发的数据（名册、HUD、详情、追问回答），识别鼠标悬停 / 点击的人物，
// 绘制右上角 HUD 与人物面板。只在客户端运行（Main.dedServ 时全部跳过）。
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using JobsWorld.Common;
using JobsWorld.Shared.Protocol;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Terraria;
using Terraria.GameContent;
using Terraria.ID;
using Terraria.ModLoader;
using Terraria.UI;

namespace JobsWorld.Client
{
    public sealed class JwClientSystem : ModSystem
    {
        // ---- 服务端推送的状态 ----
        public bool IsAdmin { get; private set; }
        public bool En { get; private set; }
        public string ApiBaseOverride { get; private set; } = "";
        /// <summary>截图访问令牌（服务器设置了 JW_PASSCODE 时非空）</summary>
        public string EvidenceKey { get; private set; } = "";
        public string TownName { get; private set; } = "";
        public readonly Dictionary<int, RosterEntry> Roster = new Dictionary<int, RosterEntry>();
        public readonly Dictionary<string, (string zh, string en)> Places = new Dictionary<string, (string zh, string en)>();
        public string HudClock = "", HudDate = "";
        public bool HudPaused, HudReceived;
        public float HudSpeed = 1;
        public int HudUsing, HudTotal;
        public string FollowingId = "";
        /// <summary>Terraria 时间流速（与世界时钟倍速一致）；null = 未收到 HUD，用默认</summary>
        public double? TimeRate { get; private set; }

        // ---- UI ----
        private UserInterface? _ui;
        internal PersonaPanel? Panel;
        private int _hovered = -1;
        private GameTime? _lastTime;

        public string T(string zh, string en) => En ? en : zh;

        public string PlaceName(string id)
        {
            if (string.IsNullOrEmpty(id)) return "";
            if (id == "street") return T("街上", "street");
            return Places.TryGetValue(id, out var n) ? (En ? n.en : n.zh) : id;
        }

        /// <summary>网页 / API 基址：服务端配置的 JW_API_BASE 优先；否则用连接的主机与端口（网关同一端口也提供 HTTP）</summary>
        public string ApiBase
        {
            get
            {
                if (!string.IsNullOrWhiteSpace(ApiBaseOverride)) return ApiBaseOverride.TrimEnd('/');
                var host = string.IsNullOrWhiteSpace(Main.getIP) ? "127.0.0.1" : Main.getIP.Trim();
                if (host.Contains(':') && !host.StartsWith("[")) host = "[" + host + "]";
                return $"http://{host}:{Netplay.ListenPort}";
            }
        }

        public override void Load()
        {
            if (Main.dedServ) return;
            Panel = new PersonaPanel();
            Panel.Activate();
            _ui = new UserInterface();
        }

        public override void Unload()
        {
            Panel?.DisposeTexture();
            Panel = null;
            _ui = null;
        }

        public override void OnWorldUnload()
        {
            if (Main.dedServ) return;
            Roster.Clear();
            Places.Clear();
            IsAdmin = false;
            HudReceived = false;
            TimeRate = null;
            FollowingId = "";
            ClosePanel();
        }

        // ---------------- 数据包 ----------------

        internal void OnPacket(Pkt type, BinaryReader r)
        {
            switch (type)
            {
                case Pkt.Hello:
                {
                    ApiBaseOverride = r.ReadString();
                    EvidenceKey = r.ReadString();
                    IsAdmin = r.ReadBoolean();
                    En = r.ReadBoolean();
                    TownName = r.ReadString();
                    int n = r.ReadUInt16();
                    Places.Clear();
                    for (int i = 0; i < n; i++) { var id = r.ReadString(); var zh = r.ReadString(); var en = r.ReadString(); Places[id] = (zh, en); }
                    break;
                }
                case Pkt.Roster:
                {
                    var list = RosterEntry.ReadList(r);
                    Roster.Clear();
                    foreach (var e in list) Roster[e.Slot] = e;
                    break;
                }
                case Pkt.Hud:
                {
                    HudClock = r.ReadString(); HudDate = r.ReadString(); HudPaused = r.ReadBoolean(); HudSpeed = r.ReadSingle();
                    HudUsing = r.ReadUInt16(); HudTotal = r.ReadUInt16();
                    HudReceived = true;
                    TimeRate = HudPaused ? 0 : HudSpeed / 60.0;
                    break;
                }
                case Pkt.Detail:
                {
                    var id = r.ReadString(); var ok = r.ReadBoolean(); var json = r.ReadString();
                    Panel?.OnDetail(id, ok, json);
                    break;
                }
                case Pkt.AskAnswer:
                {
                    var id = r.ReadString(); var ok = r.ReadBoolean(); var text = r.ReadString();
                    Panel?.OnAnswer(id, ok, text);
                    break;
                }
                case Pkt.FollowState:
                    FollowingId = r.ReadString();
                    break;
            }
        }

        internal void Send(Pkt type, params string[] fields)
        {
            if (Main.netMode != NetmodeID.MultiplayerClient) return;
            var p = Mod.GetPacket();
            p.Write((byte)type);
            foreach (var f in fields) p.Write(f ?? "");
            p.Send();
        }

        // ---------------- 面板 ----------------

        public void OpenPanel(RosterEntry e)
        {
            if (_ui == null || Panel == null) return;
            Panel.Open(e);
            if (_ui.CurrentState != Panel) _ui.SetState(Panel);
        }

        public void ClosePanel()
        {
            Panel?.Close();
            _ui?.SetState(null);
        }

        public bool PanelOpen => _ui?.CurrentState != null;

        /// <summary>鼠标正停在某个人物上（此时禁止挥动手里的物品，见 NoBuildItems）</summary>
        public bool HoveringPersona => _hovered >= 0;

        public override void UpdateUI(GameTime gameTime)
        {
            _lastTime = gameTime;
            if (Main.dedServ || Main.netMode != NetmodeID.MultiplayerClient) return;
            if (_ui?.CurrentState != null) _ui.Update(gameTime);
        }

        /// <summary>
        /// 鼠标下的人物（假玩家槽位且在名册里）；左键 / 右键单击打开面板。
        /// 由本地玩家的 ModPlayer.PreUpdate 调用：此时 Main.MouseWorld 是世界缩放下的坐标（与物品瞄准一致），且早于 ItemCheck。
        /// </summary>
        internal void UpdateHover()
        {
            _hovered = -1;
            if (Main.gameMenu || Main.mapFullscreen || Main.drawingPlayerChat || Main.LocalPlayer.lastMouseInterface) return;
            var mouse = Main.MouseWorld.ToPoint();
            foreach (var kv in Roster)
            {
                var pl = Main.player[kv.Key];
                if (!pl.active) continue;
                var box = pl.Hitbox;
                box.Inflate(6, 6);
                if (box.Contains(mouse)) { _hovered = kv.Key; break; }
            }
            if (_hovered < 0) return;
            bool click = (Main.mouseLeft && Main.mouseLeftRelease) || (Main.mouseRight && Main.mouseRightRelease);
            if (click && Roster.TryGetValue(_hovered, out var e)) OpenPanel(e);
        }

        public override void ModifyInterfaceLayers(List<GameInterfaceLayer> layers)
        {
            int idx = layers.FindIndex(l => l.Name == "Vanilla: Mouse Text");
            if (idx < 0) idx = layers.Count;
            layers.Insert(idx, new LegacyGameInterfaceLayer("JobsWorld: HUD and Panel", () =>
            {
                if (Main.netMode != NetmodeID.MultiplayerClient) return true;
                DrawHud(Main.spriteBatch);
                if (_ui?.CurrentState != null && _lastTime != null) _ui.Draw(Main.spriteBatch, _lastTime);
                DrawHoverTip(Main.spriteBatch);
                return true;
            }, InterfaceScaleType.UI));
        }

        private void DrawHud(SpriteBatch sb)
        {
            if (!HudReceived || Main.gameMenu) return;
            var font = FontAssets.MouseText.Value;
            string line1 = $"JobsWorld  {HudClock}" + (HudPaused ? T("（暂停）", " (paused)") : (Math.Abs(HudSpeed - 1) > 0.01 ? $"  ×{HudSpeed:0.#}" : ""));
            string line2 = T($"{HudUsing} 人正在用软件 · 共 {HudTotal} 人", $"{HudUsing} using apps · {HudTotal} people");
            float w = Math.Max(font.MeasureString(line1).X, font.MeasureString(line2).X * 0.85f) + 24;
            float x = Main.screenWidth / Main.UIScale - w - 12;   // 本层按界面缩放绘制
            float y = Main.mapEnabled && Main.mapStyle == 1 ? 330 : 96;
            var rect = new Rectangle((int)x, (int)y, (int)w, 52);
            Utils.DrawInvBG(sb, rect, new Color(28, 30, 48, 200));
            Utils.DrawBorderString(sb, line1, new Vector2(x + 12, y + 6), new Color(255, 210, 127));
            Utils.DrawBorderString(sb, line2, new Vector2(x + 12, y + 30), HudUsing > 0 ? new Color(160, 230, 160) : Color.LightGray, 0.85f);
        }

        private void DrawHoverTip(SpriteBatch sb)
        {
            if (_hovered < 0 || !Roster.TryGetValue(_hovered, out var e)) return;
            var sub = $"{e.Age}{T("岁", "y")} · {e.Occupation}";
            var doing = !string.IsNullOrEmpty(e.App) ? T("正在用 ", "using ") + e.App : e.Activity;
            var pos = Main.MouseScreen + new Vector2(18, 18);
            Utils.DrawBorderString(sb, e.Name, pos, new Color(255, 210, 127));
            Utils.DrawBorderString(sb, sub, pos + new Vector2(0, 24), Color.White, 0.85f);
            if (!string.IsNullOrEmpty(doing)) Utils.DrawBorderString(sb, doing, pos + new Vector2(0, 44), string.IsNullOrEmpty(e.App) ? Color.LightGray : new Color(160, 230, 160), 0.85f);
            Utils.DrawBorderString(sb, T("点击查看详情", "click for details"), pos + new Vector2(0, 64), new Color(150, 150, 170), 0.75f);
        }
    }
}
