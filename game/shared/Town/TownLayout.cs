// 城镇布局 DTO：与 packages/jobsworld/src/town.ts 的 TownLayout / Prim 对应。
// 图元是带 t 字段的联合类型，这里用一个“全字段”类承载，按 T 分派。
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace JobsWorld.Shared.Town
{
    public sealed class L10n
    {
        [JsonPropertyName("zh")] public string Zh { get; set; } = "";
        [JsonPropertyName("en")] public string En { get; set; } = "";
    }

    public sealed class SubwayLine
    {
        [JsonPropertyName("y")] public int Y { get; set; }
        [JsonPropertyName("h")] public int H { get; set; }
    }

    public sealed class PlaceLayout
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("kind")] public string Kind { get; set; } = "";
        [JsonPropertyName("name")] public L10n Name { get; set; } = new L10n();
        [JsonPropertyName("x")] public int X { get; set; }
        [JsonPropertyName("w")] public int W { get; set; }
        [JsonPropertyName("top")] public int Top { get; set; }
        [JsonPropertyName("bottom")] public int Bottom { get; set; }
        [JsonPropertyName("floors")] public int Floors { get; set; } = 1;
        [JsonPropertyName("floor_h")] public int FloorH { get; set; } = 9;
    }

    /// <summary>渲染图元（坐标为图格；x 从城镇左端起，地面 y=0，向上为负）</summary>
    public sealed class Prim
    {
        [JsonPropertyName("t")] public string T { get; set; } = "";
        [JsonPropertyName("x")] public int X { get; set; }
        [JsonPropertyName("y")] public int Y { get; set; }
        [JsonPropertyName("w")] public int W { get; set; }
        [JsonPropertyName("h")] public int H { get; set; }
        [JsonPropertyName("d")] public int D { get; set; }
        [JsonPropertyName("surface")] public string? Surface { get; set; }
        [JsonPropertyName("id")] public string? Id { get; set; }
        [JsonPropertyName("kind")] public string? Kind { get; set; }
        [JsonPropertyName("style")] public string? Style { get; set; }
        [JsonPropertyName("floor_h")] public int FloorH { get; set; }
        [JsonPropertyName("floors")] public int Floors { get; set; }
        [JsonPropertyName("roof")] public string? Roof { get; set; }
        [JsonPropertyName("y1")] public int Y1 { get; set; }
        [JsonPropertyName("y2")] public int Y2 { get; set; }
        [JsonPropertyName("dir")] public int Dir { get; set; } = 1;
        [JsonPropertyName("cars")] public int Cars { get; set; }
        [JsonPropertyName("car_w")] public int CarW { get; set; }
        [JsonPropertyName("text")] public string? Text { get; set; }
        [JsonPropertyName("text_en")] public string? TextEn { get; set; }
        /// <summary>schematic 图元：game/schematics 下的 .TEditSch 文件名</summary>
        [JsonPropertyName("file")] public string? File { get; set; }
    }

    public sealed class Spot
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("place_id")] public string PlaceId { get; set; } = "";
        [JsonPropertyName("x")] public int X { get; set; }
        [JsonPropertyName("y")] public int Y { get; set; }
        [JsonPropertyName("floor")] public int Floor { get; set; }
    }

    public sealed class TownLayout
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("name")] public L10n Name { get; set; } = new L10n();
        [JsonPropertyName("width")] public int Width { get; set; }
        [JsonPropertyName("ground_depth")] public int GroundDepth { get; set; } = 40;
        [JsonPropertyName("subway_line")] public SubwayLine SubwayLine { get; set; } = new SubwayLine();
        [JsonPropertyName("places")] public List<PlaceLayout> Places { get; set; } = new List<PlaceLayout>();
        [JsonPropertyName("prims")] public List<Prim> Prims { get; set; } = new List<Prim>();
        [JsonPropertyName("spots")] public List<Spot> Spots { get; set; } = new List<Spot>();
        [JsonPropertyName("version")] public string Version { get; set; } = "";

        /// <summary>城镇最高点（负数，含屋顶与招牌），用于确定清理范围</summary>
        public int MinY()
        {
            int min = -10;
            foreach (var p in Places) if (p.Top < min) min = p.Top;
            foreach (var p in Prims) if (p.T == "building" && p.Y - 12 < min) min = p.Y - 12;
            return min - 6;
        }
    }

    /// <summary>城镇放置位置（世界图格坐标）。持久化在世界目录的标记文件里</summary>
    public sealed class TownMarker
    {
        [JsonPropertyName("version")] public string Version { get; set; } = "";
        [JsonPropertyName("builder")] public int Builder { get; set; }
        [JsonPropertyName("origin_x")] public int OriginX { get; set; }
        [JsonPropertyName("origin_y")] public int OriginY { get; set; }
        [JsonPropertyName("width")] public int Width { get; set; }
        [JsonPropertyName("built_at")] public string BuiltAt { get; set; } = "";
        [JsonPropertyName("stats")] public Dictionary<string, int> Stats { get; set; } = new Dictionary<string, int>();
    }
}
