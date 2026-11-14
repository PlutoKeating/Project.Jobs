// 原版 Terraria 图格 / 背景墙 ID（与 Terraria.ID.TileID / WallID 同名同值，已对照 1.4.5.8 反编译核对）。
// 共享代码不引用游戏程序集，所以这里用常量；tModLoader 1.4.4 中这些原版 ID 数值相同。
namespace JobsWorld.Shared.Town
{
    public static class TileIds
    {
        public const ushort Dirt = 0, Stone = 1, Grass = 2, Torches = 4, ClosedDoor = 10, Tables = 14, Chairs = 15,
            WorkBenches = 18, Platforms = 19, WoodBlock = 30, GrayBrick = 38, RedBrick = 39, ClayBlock = 40, SilverBrick = 46,
            Sand = 53, Glass = 54, Signs = 55, ClayPot = 78, Beds = 79, Pianos = 87, Dressers = 88, Benches = 89,
            Lampposts = 92, Lamps = 93, Bookcases = 101, GrandfatherClocks = 104, Sawmill = 106, SnowBrick = 148,
            RedStucco = 153, YellowStucco = 154, GreenStucco = 155, GrayStucco = 156, Ebonwood = 157, Sinks = 172,
            LivingWood = 191, LeafBlock = 192, Asphalt = 198, Rope = 213, Painting3X3 = 240, StoneSlab = 273,
            RedDynastyShingles = 312, BlueDynastyShingles = 313, TinPlating = 325, MarbleBlock = 357;
    }

    public static class WallIds
    {
        public const ushort None = 0, Stone = 1, Wood = 4, GrayBrick = 5, RedBrick = 6, SilverBrick = 11, Dirt = 16,
            Glass = 21, Planked = 27, SnowBrick = 31, RedStucco = 36, YellowStucco = 37, GreenStucco = 38, Ebonwood = 41,
            BlueStainedGlass = 90, MetalFence = 107, WhiteDynasty = 142, StoneSlab = 147, TinPlating = 167, MarbleBlock = 179;
    }

    /// <summary>建筑风格 → 材质（外墙图格、室内背景墙、楼板、屋顶）</summary>
    public sealed class Material
    {
        public ushort Block, Wall, Floor, Roof, WindowWall = WallIds.Glass;

        public static Material For(string? style)
        {
            switch (style)
            {
                case "brick": return new Material { Block = TileIds.GrayBrick, Wall = WallIds.GrayBrick, Floor = TileIds.WoodBlock, Roof = TileIds.BlueDynastyShingles };
                case "brick_red": return new Material { Block = TileIds.RedBrick, Wall = WallIds.RedBrick, Floor = TileIds.WoodBlock, Roof = TileIds.RedDynastyShingles };
                case "wood": return new Material { Block = TileIds.WoodBlock, Wall = WallIds.Planked, Floor = TileIds.WoodBlock, Roof = TileIds.RedDynastyShingles };
                case "wood_dark": return new Material { Block = TileIds.Ebonwood, Wall = WallIds.Ebonwood, Floor = TileIds.Ebonwood, Roof = TileIds.BlueDynastyShingles };
                case "glass": return new Material { Block = TileIds.TinPlating, Wall = WallIds.Glass, Floor = TileIds.StoneSlab, Roof = TileIds.TinPlating, WindowWall = WallIds.BlueStainedGlass };
                case "metal": return new Material { Block = TileIds.TinPlating, Wall = WallIds.TinPlating, Floor = TileIds.StoneSlab, Roof = TileIds.TinPlating };
                case "white": return new Material { Block = TileIds.SnowBrick, Wall = WallIds.WhiteDynasty, Floor = TileIds.StoneSlab, Roof = TileIds.BlueDynastyShingles };
                case "marble": return new Material { Block = TileIds.MarbleBlock, Wall = WallIds.MarbleBlock, Floor = TileIds.MarbleBlock, Roof = TileIds.MarbleBlock };
                default: return new Material { Block = TileIds.YellowStucco, Wall = WallIds.YellowStucco, Floor = TileIds.WoodBlock, Roof = TileIds.RedDynastyShingles }; // stucco
            }
        }
    }

    /// <summary>家具种类（town.ts 的 Furniture）→ 原版多格物件（图格 ID + 样式）</summary>
    public static class FurnitureMap
    {
        public static (ushort type, int style, int width) For(string? kind)
        {
            switch (kind)
            {
                case "bed": return (TileIds.Beds, 0, 4);
                case "hospital_bed": return (TileIds.Beds, 0, 4);
                case "table": return (TileIds.Tables, 0, 3);
                case "chair": return (TileIds.Chairs, 0, 1);
                case "sofa": return (TileIds.Benches, 0, 3);
                case "bookcase": return (TileIds.Bookcases, 0, 3);
                case "shelf": return (TileIds.Bookcases, 0, 3);
                case "desk": return (TileIds.WorkBenches, 0, 2);
                case "workbench": return (TileIds.WorkBenches, 0, 2);
                case "counter": return (TileIds.Dressers, 0, 3);
                case "lamp": return (TileIds.Lamps, 0, 1);
                case "piano": return (TileIds.Pianos, 0, 3);
                case "sink": return (TileIds.Sinks, 0, 2);
                case "clock": return (TileIds.GrandfatherClocks, 0, 2);
                case "plant": return (TileIds.ClayPot, 0, 1);
                case "blackboard": return (TileIds.Painting3X3, 0, 3);
                case "machine": return (TileIds.Sawmill, 0, 3);
                default: return (TileIds.Tables, 0, 3);
            }
        }
    }
}
