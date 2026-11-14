// IFakePlayerHost 的 tModLoader 实现（与 TShock 端同一思路）：
// 服务器端 Main.player[slot].active 保持 false（原版 Netplay 每帧都会把没有连接的槽位置为非活动），
// 只借用 Main.player[slot] 承载外观 / 位置，用原版 NetMessage.SendData 序列化后发给真实客户端：
//   PlayerActive(14, active=1) → SyncPlayer(4) → 装备(5) → 生命(16) → PlayerControls(13)。
// 服务器自身为这些槽位发出的其他玩家类数据包由 JwServerSystem.HijackSendData 拦截（Sending=false 时）。
using System;
using JobsWorld.Shared.Personas;
using JobsWorld.Shared.Protocol;
using Microsoft.Xna.Framework;
using Terraria;
using Terraria.Chat;
using Terraria.ID;
using Terraria.Localization;

namespace JobsWorld.Server
{
    internal sealed class TmlFakePlayers : IFakePlayerHost
    {
        /// <summary>为 true 时 HijackSendData 放行假玩家槽位的数据包</summary>
        public static bool Sending;
        public static int MinSlot = 180, TopSlot = 254;
        public static bool IsFakeSlot(int n) => n >= MinSlot && n <= TopSlot;

        private readonly Action<string> _log;
        public TmlFakePlayers(Action<string> log) { _log = log; }

        private static Color C(int[] c) => c != null && c.Length >= 3 ? new Color(c[0], c[1], c[2]) : Color.White;

        private static void Apply(int slot, PersonaLive p)
        {
            var pl = Main.player[slot];
            pl.whoAmI = slot;
            var name = p.Name.Length > Player.nameLen ? p.Name.Substring(0, Player.nameLen) : p.Name;
            pl.name = string.IsNullOrWhiteSpace(name) ? "Persona" + slot : name;
            var a = p.Appearance;
            pl.hair = Math.Clamp(a.Hair, 0, HairID.Count - 1);
            pl.skinVariant = Math.Clamp(a.SkinVariant, 0, PlayerVariantID.Count - 1);
            pl.hairDye = 0;
            pl.hideMisc = 0;
            pl.hairColor = C(a.HairColor);
            pl.skinColor = C(a.SkinColor);
            pl.eyeColor = C(a.EyeColor);
            pl.shirtColor = C(a.ShirtColor);
            pl.underShirtColor = C(a.UnderShirtColor);
            pl.pantsColor = C(a.PantsColor);
            pl.shoeColor = C(a.ShoeColor);
            pl.difficulty = (byte)(Main.GameMode == GameModeID.Creative ? 3 : 0);
            pl.statLife = pl.statLifeMax = 100;
            pl.dead = false;
            pl.ghost = false;
            for (int i = 0; i < 3; i++)
            {
                int item = a.Vanity.Length > i ? a.Vanity[i] : 0;
                pl.armor[10 + i] = new Item();
                if (item > 0 && item < ItemID.Count) pl.armor[10 + i].SetDefaults(item);
            }
            pl.inventory[0] = new Item();
            if (a.Held > 0 && a.Held < ItemID.Count) pl.inventory[0].SetDefaults(a.Held);
            pl.selectedItem = 0;
        }

        private static void Send(int msg, int to, int number, float n2 = 0, float n3 = 0)
        {
            Sending = true;
            try { NetMessage.SendData(msg, to, -1, null, number, n2, n3); }
            finally { Sending = false; }
        }

        /// <summary>to = -1 广播；否则只发给该客户端（新加入的玩家）</summary>
        public void SpawnTo(int to, int slot, PersonaLive p, float px, float py, int dir)
        {
            Apply(slot, p);
            var pl = Main.player[slot];
            pl.position = new Vector2(px, py);
            pl.velocity = Vector2.Zero;
            pl.direction = dir;
            pl.controlLeft = pl.controlRight = false;
            Send(MessageID.PlayerActive, to, slot, 1);
            Send(MessageID.SyncPlayer, to, slot);
            for (int i = 0; i < 3; i++) if (!pl.armor[10 + i].IsAir) Send(MessageID.SyncEquipment, to, slot, PlayerItemSlotID.Armor0 + 10 + i);
            if (!pl.inventory[0].IsAir) Send(MessageID.SyncEquipment, to, slot, PlayerItemSlotID.Inventory0);
            Send(MessageID.PlayerLifeMana, to, slot);
            Send(MessageID.PlayerControls, to, slot);
        }

        public void Spawn(int slot, PersonaLive p, float px, float py, int dir)
        {
            SpawnTo(-1, slot, p, px, py, dir);
            _log($"假玩家上线 #{slot} {p.Name} @({px / 16:0},{py / 16:0})");
        }

        public void UpdateInfo(int slot, PersonaLive p)
        {
            Apply(slot, p);
            Send(MessageID.SyncPlayer, -1, slot);
        }

        public void Move(int slot, float px, float py, float vx, float vy, int dir)
        {
            var pl = Main.player[slot];
            pl.position = new Vector2(px, py);
            pl.velocity = new Vector2(vx, vy);
            pl.direction = dir;
            pl.controlLeft = vx < -0.01f;
            pl.controlRight = vx > 0.01f;
            Send(MessageID.PlayerControls, -1, slot);
        }

        public void Despawn(int slot)
        {
            Send(MessageID.PlayerActive, -1, slot, 0);
            _log($"假玩家下线 #{slot} {Main.player[slot].name}");
        }

        public void Say(int slot, string text, byte r, byte g, byte b)
        {
            // 以该玩家身份广播：客户端把聊天显示在其头顶（chatOverhead），同时进聊天栏
            ChatHelper.BroadcastChatMessageAs((byte)slot, NetworkText.FromLiteral(text), new Color(r, g, b));
            Console.WriteLine($"[JobsWorld] <{Main.player[slot].name}> {text}");
        }
    }
}
