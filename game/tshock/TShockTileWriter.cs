// ITileWriter 的 TShock / OTAPI 实现：Main.tile 为 OTAPI 的 ITile 集合，物件放置走原版 WorldGen。
using JobsWorld.Shared.Town;
using Terraria;
using Terraria.ObjectData;
using Terraria.Utilities;

namespace JobsWorld.TShock
{
    internal sealed class TShockTileWriter : ITileWriter
    {
        public int MaxTilesX => Main.maxTilesX;
        public int MaxTilesY => Main.maxTilesY;

        private static bool Ok(int x, int y) => x >= 0 && y >= 0 && x < Main.maxTilesX && y < Main.maxTilesY;

        public bool IsSolid(int x, int y)
        {
            if (!Ok(x, y)) return false;
            var t = Main.tile[x, y];
            return t != null && t.active() && Main.tileSolid[t.type] && !Main.tileSolidTop[t.type] && t.type != TileIds.LeafBlock;
        }

        public void ClearAll(int x, int y)
        {
            if (!Ok(x, y)) return;
            Main.tile[x, y].ClearEverything();
        }

        public void ClearTile(int x, int y)
        {
            if (!Ok(x, y)) return;
            var t = Main.tile[x, y];
            t.ClearTile();
            t.liquid = 0;
        }

        public void SetBlock(int x, int y, ushort type, byte slope = 0, bool half = false)
        {
            if (!Ok(x, y)) return;
            var t = Main.tile[x, y];
            t.ClearTile();
            t.liquid = 0;
            t.type = type;
            t.active(true);
            t.frameX = -1;
            t.frameY = -1;
            if (half) t.halfBrick(true);
            else if (slope != 0) t.slope(slope);
        }

        public void SetWall(int x, int y, ushort wall)
        {
            if (!Ok(x, y)) return;
            Main.tile[x, y].wall = wall;
        }

        public void SetLiquid(int x, int y, byte amount, byte liquidType)
        {
            if (!Ok(x, y)) return;
            var t = Main.tile[x, y];
            t.liquid = amount;
            t.liquidType(liquidType);
        }

        public void SetRaw(int x, int y, in RawTile r)
        {
            if (!Ok(x, y)) return;
            var t = Main.tile[x, y];
            t.ClearEverything();
            if (r.IsActive)
            {
                t.active(true);
                t.type = r.Type;
                bool important = r.Type < Main.tileFrameImportant.Length && Main.tileFrameImportant[r.Type];
                t.frameX = important ? r.U : (short)-1;
                t.frameY = important ? r.V : (short)-1;
                t.color(r.TileColor);
                if (r.BrickStyle == 1) t.halfBrick(true);
                else if (r.BrickStyle > 1) t.slope((byte)(r.BrickStyle - 1));
                t.actuator(r.Actuator);
                t.inActive(r.InActive);
                t.invisibleBlock(r.InvisibleBlock);
                t.fullbrightBlock(r.FullBrightBlock);
            }
            t.wall = r.Wall;
            t.wallColor(r.WallColor);
            t.invisibleWall(r.InvisibleWall);
            t.fullbrightWall(r.FullBrightWall);
            if (r.LiquidAmount > 0 && r.LiquidType > 0)
            {
                t.liquid = r.LiquidAmount;
                t.liquidType(r.LiquidType - 1);
            }
            t.wire(r.WireRed);
            t.wire2(r.WireBlue);
            t.wire3(r.WireGreen);
            t.wire4(r.WireYellow);
        }

        public bool PlaceObject(int left, int bottom, ushort type, int style, int direction = 1)
        {
            var d = TileObjectData.GetTileData(type, style);
            if (d == null)
            {
                WorldGen.PlaceTile(left, bottom, type, true, true, -1, style);
                return Main.tile[left, bottom].active() && Main.tile[left, bottom].type == type;
            }
            int x = left + d.Origin.X;
            int y = bottom - (d.Height - 1) + d.Origin.Y;
            WorldGen.PlaceObject(x, y, type, true, style, 0, -1, direction);
            var t = Main.tile[left, bottom];
            return t.active() && t.type == type;
        }

        public bool PlaceSmall(int x, int y, ushort type, int style)
        {
            if (!Ok(x, y)) return false;
            WorldGen.PlaceTile(x, y, type, true, false, -1, style);
            var t = Main.tile[x, y];
            return t.active() && t.type == type;
        }

        public bool PlaceTree(int x, int groundY, int seed)
        {
            var old = Main.rand;
            try
            {
                Main.rand = new UnifiedRandom(seed);
                return WorldGen.GrowTree(x, groundY);
            }
            catch { return false; }
            finally { Main.rand = old; }
        }

        public bool SetSignText(int left, int top, string text)
        {
            int id = Sign.ReadSign(left, top, true);
            if (id < 0) return false;
            Sign.TextSign(id, text);
            return true;
        }

        public void FrameRange(int x0, int y0, int x1, int y1)
        {
            x0 = System.Math.Max(1, x0); y0 = System.Math.Max(1, y0);
            x1 = System.Math.Min(Main.maxTilesX - 2, x1); y1 = System.Math.Min(Main.maxTilesY - 2, y1);
            WorldGen.RangeFrame(x0, y0, x1, y1);
        }
    }
}
