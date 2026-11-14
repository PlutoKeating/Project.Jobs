// 平坦世界：去掉原版全部生成步骤（只保留 Reset），换成一条平地，城镇随后由服务端在地表上构建。
// 只影响新建世界（-autocreate 首次启动或删除世界后）；已有世界不受影响。
using System.Collections.Generic;
using Terraria;
using Terraria.ID;
using Terraria.IO;
using Terraria.ModLoader;
using Terraria.GameContent.Generation;
using Terraria.WorldBuilding;

namespace JobsWorld.World
{
    public sealed class FlatWorldGen : ModSystem
    {
        /// <summary>地表所在行占世界高度的比例（小世界 1200 行 → 第 360 行）</summary>
        private const double SurfaceRatio = 0.3;

        public override void ModifyWorldGenTasks(List<GenPass> tasks, ref double totalWeight)
        {
            int reset = tasks.FindIndex(t => t.Name == "Reset");
            var keep = reset >= 0 ? tasks[reset] : null;
            tasks.Clear();
            if (keep != null) tasks.Add(keep);
            tasks.Add(new PassLegacy("JobsWorld Flat", Flat, 100));
            totalWeight = 0;
            foreach (var t in tasks) totalWeight += t.Weight;
        }

        private static void Flat(GenerationProgress progress, GameConfiguration configuration)
        {
            progress.Message = "JobsWorld: flat ground";
            int ground = (int)(Main.maxTilesY * SurfaceRatio);
            Main.worldSurface = ground + 30;
            Main.rockLayer = ground + 90;
            for (int x = 0; x < Main.maxTilesX; x++)
            {
                for (int y = 0; y < Main.maxTilesY; y++)
                {
                    Tile t = Main.tile[x, y];
                    t.ClearEverything();
                    if (y < ground) continue;
                    t.HasTile = true;
                    t.TileType = y == ground ? TileID.Grass : (y < ground + 12 ? TileID.Dirt : TileID.Stone);
                    if (y > ground && y < Main.worldSurface) t.WallType = WallID.DirtUnsafe;
                }
                if (x % 100 == 0) progress.Set((double)x / Main.maxTilesX);
            }
            Main.spawnTileX = Main.maxTilesX / 2;
            Main.spawnTileY = ground;
            Main.dungeonX = Main.maxTilesX / 10;
            Main.dungeonY = ground;
        }
    }
}
