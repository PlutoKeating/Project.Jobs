// 图格写入适配接口：共享的城镇构建 / 蓝图粘贴逻辑只通过它改世界。
// TShock 端用 OTAPI 的 Main.tile(ITile) + WorldGen 实现（game/tshock/TShockTileWriter.cs）；
// tModLoader 端需用 Framing / Tile 结构体（HasTile、TileType、WallType…）+ WorldGen 自行实现一份。
// 所有坐标均为世界图格坐标（y 向下增大）。
namespace JobsWorld.Shared.Town
{
    /// <summary>一个完整图格（蓝图粘贴用；字段语义与 TEdit 的 Tile 一致）</summary>
    public struct RawTile
    {
        public bool IsActive;
        public ushort Type;
        public short U, V;          // frameX / frameY（仅 frameImportant 图格有效）
        public byte TileColor;      // 油漆
        public ushort Wall;
        public byte WallColor;
        public byte LiquidAmount;
        public byte LiquidType;     // 0 无 / 1 水 / 2 岩浆 / 3 蜂蜜 / 4 微光（TEdit 编号）
        public bool WireRed, WireBlue, WireGreen, WireYellow;
        public byte BrickStyle;     // 0 完整 / 1 半砖 / 2..5 斜坡（TEdit 编号）
        public bool Actuator, InActive;
        public bool InvisibleBlock, InvisibleWall, FullBrightBlock, FullBrightWall;
    }

    public interface ITileWriter
    {
        int MaxTilesX { get; }
        int MaxTilesY { get; }

        /// <summary>是否为实心物块（判断地表高度用；树木、家具不算）</summary>
        bool IsSolid(int x, int y);

        /// <summary>清空图格、背景墙与液体</summary>
        void ClearAll(int x, int y);

        /// <summary>只移除前景图格（保留背景墙）</summary>
        void ClearTile(int x, int y);

        /// <summary>放置普通物块（非多格物件）。slope: 0 无 / 1..4 斜坡；half: 半砖</summary>
        void SetBlock(int x, int y, ushort type, byte slope = 0, bool half = false);

        void SetWall(int x, int y, ushort wall);

        /// <summary>liquidType: 0 水 / 1 岩浆 / 2 蜂蜜（游戏内编号）</summary>
        void SetLiquid(int x, int y, byte amount, byte liquidType);

        /// <summary>原样写入（蓝图粘贴）</summary>
        void SetRaw(int x, int y, in RawTile t);

        /// <summary>放置多格物件（门、床、桌椅、路灯…），(left, bottom) 为物件左下角图格。成功返回 true</summary>
        bool PlaceObject(int left, int bottom, ushort type, int style, int direction = 1);

        /// <summary>放置单格挂件（火把等），由游戏自行判断依附</summary>
        bool PlaceSmall(int x, int y, ushort type, int style);

        /// <summary>在 (x, groundY) 的草地上长一棵原版树（groundY 为草地图格行）。seed 用于让树高可复现</summary>
        bool PlaceTree(int x, int groundY, int seed);

        /// <summary>给 (left, top) 处已放好的告示牌写文字</summary>
        bool SetSignText(int left, int top, string text);

        /// <summary>对区域内图格重新计算外观帧（构建完成后调用）</summary>
        void FrameRange(int x0, int y0, int x1, int y1);
    }
}
