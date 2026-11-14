// 旁观者舒适度：玩家无敌、没有敌怪刷新、非管理员不能改动世界（客户端先拦截，服务端 HijackGetData 兜底）。
using JobsWorld.Client;
using Terraria;
using Terraria.DataStructures;
using Terraria.ID;
using Terraria.ModLoader;

namespace JobsWorld.Common
{
    public sealed class SpectatorPlayer : ModPlayer
    {
        public override bool FreeDodge(Player.HurtInfo info) => true;
        public override bool CanBeHitByNPC(NPC npc, ref int cooldownSlot) => false;
        public override bool CanBeHitByProjectile(Projectile proj) => false;
        public override bool ImmuneTo(PlayerDeathReason damageSource, int cooldownCounter, bool dodgeable) => true;

        public override bool PreKill(double damage, int hitDirection, bool pvp, ref bool playSound, ref bool genDust, ref PlayerDeathReason damageSource)
        {
            Player.statLife = Player.statLifeMax2;
            return false;
        }

        public override void PreUpdate()
        {
            if (Main.netMode == NetmodeID.MultiplayerClient && Player.whoAmI == Main.myPlayer) ModContent.GetInstance<JwClientSystem>().UpdateHover();
        }

        public override void PostUpdate()
        {
            Player.breath = Player.breathMax;
            Player.lavaImmune = true;
            Player.noFallDmg = true;
        }
    }

    public sealed class NoHostileSpawns : GlobalNPC
    {
        public override void EditSpawnRate(Player player, ref int spawnRate, ref int maxSpawns)
        {
            spawnRate = int.MaxValue / 2;
            maxSpawns = 0;
        }
    }

    /// <summary>客户端：悬停在人物上时不使用物品；非管理员拿着能挖掘 / 放置 / 刷漆的物品时禁止使用（避免出现本地“假改动”后被服务器回滚）</summary>
    public sealed class NoBuildItems : GlobalItem
    {
        public override bool CanUseItem(Item item, Player player)
        {
            if (Main.netMode != NetmodeID.MultiplayerClient || player.whoAmI != Main.myPlayer) return true;
            var sys = ModContent.GetInstance<JwClientSystem>();
            if (sys.HoveringPersona) return false;      // 点击人物是打开面板，不是挥动物品
            if (sys.IsAdmin) return true;
            bool edits = item.pick > 0 || item.axe > 0 || item.hammer > 0 || item.createTile >= 0 || item.createWall >= 0
                || item.type == ItemID.Paintbrush || item.type == ItemID.PaintRoller || item.type == ItemID.PaintScraper
                || item.type == ItemID.Wrench || item.type == ItemID.WireCutter || item.type == ItemID.Actuator
                || item.type == ItemID.EmptyBucket || item.type == ItemID.WaterBucket || item.type == ItemID.LavaBucket || item.type == ItemID.HoneyBucket
                || item.type == ItemID.BottomlessBucket || item.type == ItemID.SuperAbsorbantSponge;
            return !edits;
        }
    }
}
