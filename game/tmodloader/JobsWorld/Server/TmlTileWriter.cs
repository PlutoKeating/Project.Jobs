// ITileWriter 的 tModLoader 1.4.4 实现：Tile 是指向 TileData 数组的句柄结构体，
// 对局部变量的属性赋值会直接写入世界；多格物件、树、告示牌走原版 WorldGen / Sign。
using JobsWorld.Shared.Town;
using Terraria;
using Terraria.ID;
using Terraria.ModLoader;
using Terraria.ObjectData;
using Terraria.Utilities;

namespace JobsWorld.Server
{
    internal sealed class TmlTileWriter : ITileWriter
    {
        public int MaxTilesX => Main.maxTilesX;
        public int MaxTilesY => Main.maxTilesY;

        private static bool Ok(int x, int y) => x >= 0 && y >= 0 && x < Main.maxTilesX && y < Main.maxTilesY;

        public bool IsSolid(int x, int y)
        {
            if (!Ok(x, y)) return false;
            Tile t = Main.tile[x, y];
            return t.HasTile && Main.tileSolid[t.TileType] && !Main.tileSolidTop[t.TileType] && t.TileType != TileIds.LeafBlock;
        }

        public void ClearAll(int x, int y)
        {
            if (!Ok(x, y)) return;
            Main.tile[x, y].ClearEverything();
        }

        public void ClearTile(int x, int y)
        {
            if (!Ok(x, y)) return;
            Tile t = Main.tile[x, y];
            t.ClearTile();
            t.LiquidAmount = 0;
        }

        public void SetBlock(int x, int y, ushort type, byte slope = 0, bool half = false)
        {
            if (!Ok(x, y)) return;
            Tile t = Main.tile[x, y];
            t.ClearTile();
            t.LiquidAmount = 0;
            t.TileType = type;
            t.HasTile = true;
            t.TileFrameX = -1;
            t.TileFrameY = -1;
            if (half) t.IsHalfBlock = true;
            else if (slope != 0) t.Slope = (SlopeType)slope;
        }

        public void SetWall(int x, int y, ushort wall)
        {
            if (!Ok(x, y)) return;
            Tile t = Main.tile[x, y];
            t.WallType = wall;
        }

        public void SetLiquid(int x, int y, byte amount, byte liquidType)
        {
            if (!Ok(x, y)) return;
            Tile t = Main.tile[x, y];
            t.LiquidAmount = amount;
            t.LiquidType = liquidType;
        }

        public void SetRaw(int x, int y, in RawTile r)
        {
            if (!Ok(x, y)) return;
            Tile t = Main.tile[x, y];
            t.ClearEverything();
            if (r.IsActive && r.Type < TileLoader.TileCount)
            {
                t.HasTile = true;
                t.TileType = r.Type;
                bool important = Main.tileFrameImportant[r.Type];
                t.TileFrameX = important ? r.U : (short)-1;
                t.TileFrameY = important ? r.V : (short)-1;
                t.TileColor = r.TileColor;
                if (r.BrickStyle == 1) t.IsHalfBlock = true;
                else if (r.BrickStyle > 1) t.Slope = (SlopeType)(r.BrickStyle - 1);
                t.HasActuator = r.Actuator;
                t.IsActuated = r.InActive;
                t.IsTileInvisible = r.InvisibleBlock;
                t.IsTileFullbright = r.FullBrightBlock;
            }
            if (r.Wall < WallLoader.WallCount) t.WallType = r.Wall;
            t.WallColor = r.WallColor;
            t.IsWallInvisible = r.InvisibleWall;
            t.IsWallFullbright = r.FullBrightWall;
            if (r.LiquidAmount > 0 && r.LiquidType > 0)
            {
                t.LiquidAmount = r.LiquidAmount;
                t.LiquidType = r.LiquidType - 1;
            }
            t.RedWire = r.WireRed;
            t.BlueWire = r.WireBlue;
            t.GreenWire = r.WireGreen;
            t.YellowWire = r.WireYellow;
        }

        public bool PlaceObject(int left, int bottom, ushort type, int style, int direction = 1)
        {
            if (!Ok(left, bottom)) return false;
            var d = TileObjectData.GetTileData(type, style);
            if (d == null)
            {
                WorldGen.PlaceTile(left, bottom, type, true, true, -1, style);
                Tile s = Main.tile[left, bottom];
                return s.HasTile && s.TileType == type;
            }
            int x = left + d.Origin.X;
            int y = bottom - (d.Height - 1) + d.Origin.Y;
            WorldGen.PlaceObject(x, y, type, true, style, 0, -1, direction);
            Tile t = Main.tile[left, bottom];
            return t.HasTile && t.TileType == type;
        }

        public bool PlaceSmall(int x, int y, ushort type, int style)
        {
            if (!Ok(x, y)) return false;
            WorldGen.PlaceTile(x, y, type, true, false, -1, style);
            Tile t = Main.tile[x, y];
            return t.HasTile && t.TileType == type;
        }

        public bool PlaceTree(int x, int groundY, int seed)
        {
            var old = WorldGen.genRand;
            try
            {
                WorldGen._genRand = new UnifiedRandom(seed);
                // 树苗所在格必须为空，草地在其下方
                return WorldGen.GrowTree(x, groundY);
            }
            catch { return false; }
            finally { WorldGen._genRand = old; }
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
