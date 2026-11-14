// 城镇程序化构建：TownLayout 图元 → ITileWriter 调用。纯逻辑，TShock / tModLoader 共用。
// 坐标约定（与 town.ts 一致）：城镇坐标 (tx, ty)，地面图格行 ty=0，向上为负；
//   世界坐标 = (originX + tx, originY + ty)，originY 即城镇地表所在的世界图格行。
//   人物 / 家具 / 门的 y 指“脚下那一行实心地面”：家具底部在 y-1 行；门、告示牌 y 指物件最底一行。
using System;
using System.Collections.Generic;
using System.Linq;
using JobsWorld.Shared.Schematics;

namespace JobsWorld.Shared.Town
{
    public sealed class TownBuilder
    {
        private readonly ITileWriter _w;
        private readonly int _ox, _oy;
        private readonly Action<string> _log;
        private readonly Func<string, TEditSchematic?>? _loadSchematic;
        private readonly List<Prim> _buildings = new List<Prim>();
        public readonly Dictionary<string, int> Stats = new Dictionary<string, int>();

        /// <summary>构建算法版本：修改构建逻辑后递增，已有世界会在下次启动时按原位置重建</summary>
        public const int BuilderVersion = 3;

        /// <summary>城镇两侧额外清理的平整带宽度</summary>
        public const int Margin = 24;

        public TownBuilder(ITileWriter w, int originX, int originY, Action<string>? log = null, Func<string, TEditSchematic?>? loadSchematic = null)
        {
            _w = w; _ox = originX; _oy = originY; _log = log ?? (_ => { }); _loadSchematic = loadSchematic;
        }

        private int X(int tx) => _ox + tx;
        private int Y(int ty) => _oy + ty;
        private void Count(string key, int n = 1) { Stats.TryGetValue(key, out var v); Stats[key] = v + n; }
        private bool In(int x, int y) => x > 1 && y > 1 && x < _w.MaxTilesX - 2 && y < _w.MaxTilesY - 2;

        /// <summary>
        /// 选城镇位置：以出生点为中心横向放置，地表高度取该范围地表的中位数（可复现：只依赖世界本身）
        /// </summary>
        public static (int ox, int oy) ChoosePlacement(ITileWriter w, int spawnX, int width, int minY)
        {
            int ox = spawnX - width / 2;
            ox = Math.Max(Margin + 50, Math.Min(ox, w.MaxTilesX - width - Margin - 50));
            var heights = new List<int>();
            for (int x = ox; x < ox + width; x += 8)
            {
                for (int y = 60; y < w.MaxTilesY - 200; y++)
                    if (w.IsSolid(x, y)) { heights.Add(y); break; }
            }
            heights.Sort();
            int oy = heights.Count > 0 ? heights[heights.Count / 2] : w.MaxTilesY / 4;
            oy = Math.Max(oy, -minY + 40);
            return (ox, oy);
        }

        public Dictionary<string, int> Build(TownLayout L)
        {
            _buildings.AddRange(L.Prims.Where(p => p.T == "building"));
            int minY = L.MinY();
            Flatten(L, minY);
            // 1) 地表与地下结构
            foreach (var p in L.Prims.Where(p => p.T == "ground")) Ground(p, L.GroundDepth);
            foreach (var p in L.Prims.Where(p => p.T == "tunnel")) Room(p.X, p.Y, p.W, p.H, WallIds.GrayBrick, TileIds.GrayBrick, TileIds.StoneSlab, "tunnel");
            foreach (var p in L.Prims.Where(p => p.T == "hall")) Room(p.X, p.Y, p.W, p.H, WallIds.StoneSlab, TileIds.StoneSlab, TileIds.StoneSlab, "hall");
            foreach (var p in L.Prims.Where(p => p.T == "stairs")) Stairs(p);
            foreach (var p in L.Prims.Where(p => p.T == "platform")) Platform(p);
            foreach (var p in L.Prims.Where(p => p.T == "pond")) Pond(p);
            // 2) 建筑外壳、楼板、窗户
            foreach (var p in _buildings) Building(p);
            foreach (var p in L.Prims.Where(p => p.T == "window")) Window(p);
            foreach (var p in L.Prims.Where(p => p.T == "train")) Train(p);
            foreach (var p in L.Prims.Where(p => p.T == "bus_shelter")) BusShelter(p);
            _w.FrameRange(X(-Margin), Y(minY), X(L.Width + Margin), Y(L.GroundDepth + 2));
            // 3) 物件（需要依附已成形的地面 / 墙）
            foreach (var p in L.Prims.Where(p => p.T == "door")) Obj(X(p.X), Y(p.Y), TileIds.ClosedDoor, 0, "door");
            foreach (var p in L.Prims.Where(p => p.T == "furniture")) Furniture(p);
            foreach (var p in L.Prims.Where(p => p.T == "bench")) Obj(X(p.X), Y(-1), TileIds.Benches, 0, "bench");
            foreach (var p in L.Prims.Where(p => p.T == "tree")) Tree(p);
            foreach (var p in L.Prims.Where(p => p.T == "lamp_post")) LampPost(p); // 最后放，避让长椅与树
            foreach (var p in _buildings) Torches(p);
            foreach (var p in L.Prims.Where(p => p.T == "sign")) Sign(p);
            foreach (var p in L.Prims.Where(p => p.T == "schematic")) Schematic(p);
            _w.FrameRange(X(-Margin), Y(minY), X(L.Width + Margin), Y(L.GroundDepth + 2));
            return Stats;
        }

        /// <summary>清空城镇上空，填平地面到 ground_depth</summary>
        private void Flatten(TownLayout L, int minY)
        {
            for (int tx = -Margin; tx < L.Width + Margin; tx++)
            {
                int x = X(tx);
                for (int ty = minY; ty < 0; ty++) if (In(x, Y(ty))) _w.ClearAll(x, Y(ty));
                for (int ty = 0; ty <= L.GroundDepth; ty++)
                {
                    int y = Y(ty);
                    if (!In(x, y)) continue;
                    _w.ClearAll(x, y);
                    _w.SetBlock(x, y, ty > 12 ? TileIds.Stone : TileIds.Dirt);
                }
                if (tx < 0 || tx >= L.Width) _w.SetBlock(x, Y(0), TileIds.Grass);
            }
            Count("flatten_columns", L.Width + 2 * Margin);
        }

        private void Ground(Prim p, int depth)
        {
            ushort top = p.Surface switch { "grass" => TileIds.Grass, "asphalt" => TileIds.Asphalt, _ => TileIds.StoneSlab };
            for (int tx = p.X; tx < p.X + p.W; tx++)
            {
                _w.SetBlock(X(tx), Y(0), top);
                if (top != TileIds.Grass) _w.SetBlock(X(tx), Y(1), TileIds.Stone);
            }
            Count("ground_tiles", p.W);
        }

        /// <summary>地下空间：内部清空 + 背景墙，顶板与地板为实心</summary>
        private void Room(int tx, int ty, int w, int h, ushort wall, ushort ceil, ushort floor, string stat)
        {
            for (int x = tx - 1; x <= tx + w; x++)
            {
                for (int y = ty; y < ty + h; y++) { _w.ClearAll(X(x), Y(y)); _w.SetWall(X(x), Y(y), wall); }
                if (ty - 1 > 0) _w.SetBlock(X(x), Y(ty - 1), ceil);
                _w.SetBlock(X(x), Y(ty + h), floor);
            }
            // 两端封墙
            for (int y = ty; y < ty + h; y++) { _w.SetBlock(X(tx - 1), Y(y), ceil); _w.SetBlock(X(tx + w), Y(y), ceil); }
            // 灯：每 12 格一个火把（贴背景墙）
            for (int x = tx + 3; x < tx + w - 1; x += 12) if (_w.PlaceSmall(X(x), Y(ty + 1), TileIds.Torches, 0)) Count("torches");
            Count(stat);
        }

        /// <summary>斜向台阶：每列下降一格，上方净空 5 格</summary>
        private void Stairs(Prim p)
        {
            int dir = p.Dir >= 0 ? 1 : -1;
            int n = p.Y2 - p.Y1;
            for (int i = 0; i <= n; i++)
            {
                int tx = p.X + dir * i;
                int step = p.Y1 + i;
                for (int y = step - 5; y < step; y++)
                {
                    _w.ClearTile(X(tx), Y(y));
                    if (y > 0) _w.SetWall(X(tx), Y(y), WallIds.GrayBrick);
                }
                _w.SetBlock(X(tx), Y(step), TileIds.StoneSlab);
            }
            Count("stairs");
        }

        private void Platform(Prim p)
        {
            for (int tx = p.X; tx < p.X + p.W; tx++) _w.SetBlock(X(tx), Y(p.Y), TileIds.StoneSlab);
            Count("platform");
        }

        private void Pond(Prim p)
        {
            for (int tx = p.X; tx < p.X + p.W; tx++)
            {
                // 岸边缓坡：两端浅
                int edge = Math.Min(tx - p.X, p.X + p.W - 1 - tx);
                int d = Math.Min(p.D, 1 + edge);
                for (int ty = 0; ty < d; ty++) { _w.ClearAll(X(tx), Y(ty)); _w.SetLiquid(X(tx), Y(ty), 255, 0); }
                _w.SetBlock(X(tx), Y(d), TileIds.Sand);
            }
            Count("pond");
        }

        private Material MatAt(int tx)
        {
            foreach (var b in _buildings) if (tx >= b.X && tx < b.X + b.W) return Material.For(b.Style);
            return Material.For(null);
        }

        private Prim? BuildingAt(int tx) => _buildings.FirstOrDefault(b => tx >= b.X && tx < b.X + b.W);

        private void Building(Prim p)
        {
            var m = Material.For(p.Style);
            int x0 = p.X, x1 = p.X + p.W - 1, top = p.Y; // top = -H（屋顶行）
            int ropeX = x0 + 2;
            for (int tx = x0; tx <= x1; tx++)
                for (int ty = top; ty < 0; ty++) { _w.ClearTile(X(tx), Y(ty)); _w.SetWall(X(tx), Y(ty), m.Wall); }
            // 外墙
            for (int ty = top; ty < 0; ty++) { _w.SetBlock(X(x0), Y(ty), m.Block); _w.SetBlock(X(x1), Y(ty), m.Block); }
            // 屋顶
            for (int tx = x0; tx <= x1; tx++) _w.SetBlock(X(tx), Y(top), m.Block);
            // 楼板（绳子所在列留洞）
            for (int f = 1; f < Math.Max(1, p.Floors); f++)
            {
                int fy = -f * p.FloorH;
                for (int tx = x0 + 1; tx < x1; tx++) if (tx != ropeX) _w.SetBlock(X(tx), Y(fy), m.Floor);
            }
            // 一楼两侧门洞（门在第 3 步放置）
            for (int ty = -3; ty <= -1; ty++) { _w.ClearTile(X(x0), Y(ty)); _w.ClearTile(X(x1), Y(ty)); }
            // 贯穿各层的绳子（原版可攀爬）
            if (p.Floors > 1) for (int ty = top + 1; ty < 0; ty++) _w.SetBlock(X(ropeX), Y(ty), TileIds.Rope);
            // 屋顶造型
            if (p.Roof == "gable")
            {
                int rise = Math.Min(6, p.W / 4);
                for (int i = 0; i < rise; i++)
                {
                    int a = x0 - 1 + 2 * i, b = x1 + 1 - 2 * i;
                    if (b - a < 3) break;
                    for (int tx = a; tx <= b; tx++) _w.SetBlock(X(tx), Y(top - 1 - i), m.Roof);
                }
            }
            else
            {
                for (int tx = x0; tx <= x1; tx += 1) if (tx == x0 || tx == x1 || (tx - x0) % 2 == 0) _w.SetBlock(X(tx), Y(top - 1), m.Block); // 女儿墙
            }
            Count("buildings");
        }

        private void Window(Prim p)
        {
            var m = MatAt(p.X);
            for (int tx = p.X; tx < p.X + p.W; tx++)
                for (int ty = p.Y; ty < p.Y + p.H; ty++) _w.SetWall(X(tx), Y(ty), m.WindowWall);
            Count("windows");
        }

        private void Torches(Prim p)
        {
            for (int f = 0; f < Math.Max(1, p.Floors); f++)
            {
                int fy = -f * p.FloorH;
                for (int tx = p.X + 8; tx < p.X + p.W - 3; tx += 7)
                    if (_w.PlaceSmall(X(tx), Y(fy - p.FloorH + 2), TileIds.Torches, 0)) Count("torches");
            }
        }

        private void Train(Prim p)
        {
            for (int c = 0; c < p.Cars; c++)
            {
                int cx = p.X + c * (p.CarW + 2);
                int floor = p.Y; // 车厢地板 = 站台行
                for (int tx = cx; tx < cx + p.CarW; tx++)
                {
                    for (int ty = floor - 6; ty < floor; ty++) { _w.ClearTile(X(tx), Y(ty)); _w.SetWall(X(tx), Y(ty), WallIds.TinPlating); }
                    _w.SetBlock(X(tx), Y(floor - 7), TileIds.TinPlating);   // 车顶
                    _w.SetBlock(X(tx), Y(floor), TileIds.SilverBrick);      // 车厢地板
                }
                // 车窗
                for (int tx = cx + 2; tx < cx + p.CarW - 3; tx += 4)
                    for (int ty = floor - 5; ty <= floor - 4; ty++) { _w.SetWall(X(tx), Y(ty), WallIds.Glass); _w.SetWall(X(tx + 1), Y(ty), WallIds.Glass); }
                // 侧壁上半段（下半段留作车门）
                for (int ty = floor - 7; ty <= floor - 4; ty++) { _w.SetBlock(X(cx), Y(ty), TileIds.TinPlating); _w.SetBlock(X(cx + p.CarW - 1), Y(ty), TileIds.TinPlating); }
                Count("train_cars");
            }
        }

        private void BusShelter(Prim p)
        {
            int x0 = p.X, x1 = p.X + p.W - 1;
            for (int tx = x0; tx <= x1; tx++)
            {
                _w.SetBlock(X(tx), Y(-6), TileIds.TinPlating);
                for (int ty = -5; ty <= -1; ty++) { _w.ClearTile(X(tx), Y(ty)); _w.SetWall(X(tx), Y(ty), tx == x0 || tx == x1 ? WallIds.MetalFence : WallIds.Glass); }
            }
            if (p.W >= 7) Obj(X(x1 - 4), Y(-1), TileIds.Benches, 0, "bench"); // 左侧留给站牌
            Count("bus_shelter");
        }

        private void Furniture(Prim p)
        {
            var (type, style, _) = FurnitureMap.For(p.Kind);
            int bottom = p.Kind == "blackboard" ? p.Y - 3 : p.Y - 1;
            Obj(X(p.X), Y(bottom), type, style, "furniture");
        }

        private void Obj(int left, int bottom, ushort type, int style, string stat)
        {
            if (_w.PlaceObject(left, bottom, type, style)) Count(stat);
            else { Count(stat + "_failed"); if (Stats[stat + "_failed"] <= 5) _log($"放置失败 {stat} type={type} style={style} 城镇坐标=({left - _ox},{bottom - _oy})"); }
        }

        /// <summary>路灯落在水池等无法放置处时，左右就近找一块实心地面</summary>
        private void LampPost(Prim p)
        {
            for (int k = 0; k <= 20; k++)
                foreach (var dx in k == 0 ? new[] { 0 } : new[] { k, -k })
                    if (_w.IsSolid(X(p.X + dx), Y(0)) && _w.PlaceObject(X(p.X + dx), Y(-1), TileIds.Lampposts, 0)) { Count("lamp_post"); return; }
            Count("lamp_post_failed");
            _log($"放置失败 lamp_post 城镇坐标=({p.X},-1)");
        }

        private void Tree(Prim p)
        {
            int gx = X(p.X), gy = Y(0);
            _w.SetBlock(gx, gy, TileIds.Grass);
            _w.SetBlock(gx - 1, gy, TileIds.Grass);
            _w.SetBlock(gx + 1, gy, TileIds.Grass);
            if (_w.PlaceTree(gx, gy, p.X * 31 + p.H)) { Count("trees"); return; }
            // 兜底：活木树干 + 树叶块
            for (int ty = -p.H; ty < 0; ty++) _w.SetWall(gx, Y(ty), WallIds.Wood);
            for (int dx = -3; dx <= 3; dx++)
                for (int dy = -3; dy <= 2; dy++)
                    if (dx * dx + dy * dy <= 10) _w.SetBlock(gx + dx, Y(-p.H + dy), TileIds.LeafBlock);
            Count("trees_fallback");
        }

        private void Sign(Prim p)
        {
            int left = X(p.X), bottom = Y(p.Y);
            // 位置被占（例如尖屋顶）时向上挪
            for (int k = 0; k < 16 && (_w.IsSolid(left, bottom) || _w.IsSolid(left + 1, bottom) || _w.IsSolid(left, bottom - 1) || _w.IsSolid(left + 1, bottom - 1)); k++) bottom--;
            // 底下没有支撑时补两块
            var b = BuildingAt(p.X);
            ushort support = b != null ? Material.For(b.Style).Block : TileIds.StoneSlab;
            if (!_w.IsSolid(left, bottom + 1)) _w.SetBlock(left, bottom + 1, support);
            if (!_w.IsSolid(left + 1, bottom + 1)) _w.SetBlock(left + 1, bottom + 1, support);
            if (!_w.PlaceObject(left, bottom, TileIds.Signs, 0)) { Count("sign_failed"); _log($"告示牌放置失败「{p.Text}」城镇坐标=({p.X},{bottom - _oy})"); return; }
            var text = string.IsNullOrEmpty(p.TextEn) ? (p.Text ?? "") : $"{p.Text}\n{p.TextEn}";
            if (_w.SetSignText(left, bottom - 1, text)) Count("signs"); else Count("sign_text_failed");
        }

        private void Schematic(Prim p)
        {
            if (string.IsNullOrEmpty(p.File) || _loadSchematic == null) { Count("schematic_skipped"); return; }
            try
            {
                var s = _loadSchematic(p.File!);
                if (s == null) { Count("schematic_missing"); _log($"蓝图不存在: {p.File}"); return; }
                Count("schematic_tiles", s.Paste(_w, X(p.X), Y(p.Y)));
                Count("schematics");
            }
            catch (Exception e) { Count("schematic_failed"); _log($"蓝图 {p.File} 粘贴失败: {e.Message}"); }
        }
    }
}
