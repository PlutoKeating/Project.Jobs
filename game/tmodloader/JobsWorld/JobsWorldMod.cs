// JobsWorld tModLoader mod 入口：只负责把 ModPacket 分派给服务端 / 客户端逻辑。
// 服务端逻辑见 Server/（NATS、城镇、假玩家、命令），客户端逻辑见 Client/（人物面板、HUD）。
// game/shared 的 C# 源码在构建时被复制到 Shared/ 目录（见 infra/game/tmodloader/Dockerfile），不在仓库里重复保存。
using System.IO;
using JobsWorld.Client;
using JobsWorld.Common;
using JobsWorld.Server;
using Terraria;
using Terraria.ModLoader;

namespace JobsWorld
{
    public sealed class JobsWorldMod : Mod
    {
        public override void HandlePacket(BinaryReader reader, int whoAmI)
        {
            var type = (Pkt)reader.ReadByte();
            if (Main.netMode == Terraria.ID.NetmodeID.Server) ModContent.GetInstance<JwServerSystem>().OnPacket(type, reader, whoAmI);
            else ModContent.GetInstance<JwClientSystem>().OnPacket(type, reader);
        }
    }
}
