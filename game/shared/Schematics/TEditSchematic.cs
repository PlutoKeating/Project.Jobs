// .TEditSch 蓝图读取（V4 / V5）与粘贴。
//
// 本文件的解析逻辑移植自 TEdit（https://github.com/TEdit/Terraria-Map-Editor）：
//   src/TEdit.Editor/Clipboard/ClipboardBuffer.File.cs（Load / LoadV5 / LoadV4）
//   src/TEdit.Terraria/World.FileV2.cs（LoadTileData / DeserializeTileData / LoadChestData / LoadSignData / ReadBitArray）
// Copyright (c) TEdit contributors.
// This source is subject to the Microsoft Public License (MS-PL).
// A copy can be found at https://opensource.org/licenses/MS-PL and in TEdit-LICENSE.txt next to this file.
//
// 改动：去掉 TEdit 的 UI / 世界对象依赖，输出共享 RawTile 数组；只读取图格、箱子（为了跳过）与告示牌，
// 不解析其后的 TileEntity 与 tModLoader 模组载荷（V5 尾部校验因此不做）。
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using JobsWorld.Shared.Town;

namespace JobsWorld.Shared.Schematics
{
    public sealed class SchematicSign
    {
        public int X, Y;          // 相对蓝图左上角
        public string Text = "";
    }

    public sealed class TEditSchematic
    {
        public string Name = "";
        public int Version;       // Terraria 世界版本号（文件中的值减去 20000 / 10000）
        public int FormatVersion; // 5 / 4
        public int Width, Height;
        public RawTile[,] Tiles = new RawTile[0, 0];
        public List<SchematicSign> Signs = new List<SchematicSign>();

        public static TEditSchematic Load(string path)
        {
            using var fs = File.OpenRead(path);
            return Load(fs);
        }

        public static TEditSchematic Load(Stream stream)
        {
            using var r = new BinaryReader(stream, Encoding.UTF8, leaveOpen: true);
            string name = r.ReadString();
            int version = r.ReadInt32();
            int format;
            if (version > 20000) { version -= 20000; format = 5; }
            else if (version > 10000) { version -= 10000; format = 4; }
            else throw new InvalidDataException($"不支持的 .TEditSch 版本 {version}（只支持 V4/V5，请用新版 TEdit 重新保存）");

            var frameImportant = ReadBitArray(r);
            int w = r.ReadInt32();
            int h = r.ReadInt32();
            if (w <= 0 || h <= 0 || w > 4000 || h > 2000) throw new InvalidDataException($"蓝图尺寸异常 {w}x{h}");
            var s = new TEditSchematic { Name = name, Version = version, FormatVersion = format, Width = w, Height = h };
            s.Tiles = LoadTileData(r, w, h, version, frameImportant);
            SkipChests(r, (uint)version);
            int signCount = r.ReadInt16();
            for (int i = 0; i < signCount; i++)
            {
                string text = r.ReadString();
                int x = r.ReadInt32();
                int y = r.ReadInt32();
                s.Signs.Add(new SchematicSign { X = x, Y = y, Text = text });
            }
            return s;
        }

        private static RawTile[,] LoadTileData(BinaryReader r, int maxX, int maxY, int version, bool[] frameImportant)
        {
            var tiles = new RawTile[maxX, maxY];
            for (int x = 0; x < maxX; x++)
            {
                for (int y = 0; y < maxY; y++)
                {
                    var tile = DeserializeTile(r, frameImportant, version, out int rle);
                    tiles[x, y] = tile;
                    while (rle > 0)
                    {
                        y++;
                        if (y >= maxY) break;
                        tiles[x, y] = tile;
                        rle--;
                    }
                }
            }
            return tiles;
        }

        private static RawTile DeserializeTile(BinaryReader r, bool[] frameImportant, int version, out int rle)
        {
            var tile = new RawTile();
            byte header4 = 0, header3 = 0, header2 = 0;
            byte header1 = r.ReadByte();
            bool hasHeader2 = false, hasHeader3 = false;
            if ((header1 & 0b0000_0001) != 0) { hasHeader2 = true; header2 = r.ReadByte(); }
            if (hasHeader2 && (header2 & 0b0000_0001) != 0) { hasHeader3 = true; header3 = r.ReadByte(); }
            if (version >= 269 && hasHeader3 && (header3 & 0b0000_0001) != 0) header4 = r.ReadByte();

            if ((header1 & 0b0000_0010) != 0)
            {
                tile.IsActive = true;
                int type;
                if ((header1 & 0b0010_0000) == 0) type = r.ReadByte();
                else { byte lo = r.ReadByte(); type = r.ReadByte() << 8 | lo; }
                tile.Type = (ushort)type;
                bool framed = type < frameImportant.Length ? frameImportant[type] : true;
                if (framed)
                {
                    tile.U = r.ReadInt16();
                    tile.V = r.ReadInt16();
                    if (tile.Type == 144) tile.V = 0; // 计时器复位
                }
                if ((header3 & 0b0000_1000) != 0) tile.TileColor = r.ReadByte();
            }
            if ((header1 & 0b0000_0100) != 0)
            {
                tile.Wall = r.ReadByte();
                if ((header3 & 0b0001_0000) != 0) tile.WallColor = r.ReadByte();
            }
            byte liquidType = (byte)((header1 & 0b0001_1000) >> 3);
            if (liquidType != 0)
            {
                tile.LiquidAmount = r.ReadByte();
                tile.LiquidType = liquidType; // 1 水 2 岩浆 3 蜂蜜
                if (version >= 269 && (header3 & 0b1000_0000) != 0) tile.LiquidType = 4; // 微光
            }
            if (header2 > 1)
            {
                tile.WireRed = (header2 & 0b0000_0010) != 0;
                tile.WireBlue = (header2 & 0b0000_0100) != 0;
                tile.WireGreen = (header2 & 0b0000_1000) != 0;
                tile.BrickStyle = (byte)((header2 & 0b0111_0000) >> 4);
            }
            if (header3 > 1)
            {
                tile.Actuator = (header3 & 0b0000_0010) != 0;
                tile.InActive = (header3 & 0b0000_0100) != 0;
                tile.WireYellow = (header3 & 0b0010_0000) != 0;
                if (version >= 222 && (header3 & 0b0100_0000) != 0) tile.Wall = (ushort)(r.ReadByte() << 8 | tile.Wall);
            }
            if (version >= 269 && header4 > 1)
            {
                tile.InvisibleBlock = (header4 & 0b0000_0010) != 0;
                tile.InvisibleWall = (header4 & 0b0000_0100) != 0;
                tile.FullBrightBlock = (header4 & 0b0000_1000) != 0;
                tile.FullBrightWall = (header4 & 0b0001_0000) != 0;
            }
            byte rleType = (byte)((header1 & 192) >> 6);
            rle = rleType switch { 0 => 0, 1 => r.ReadByte(), _ => r.ReadInt16() };
            return tile;
        }

        private static void SkipChests(BinaryReader r, uint version)
        {
            int total = r.ReadInt16();
            int maxItems = 40;
            if (version < 294) maxItems = r.ReadInt16();
            for (int i = 0; i < total; i++)
            {
                r.ReadInt32(); r.ReadInt32(); r.ReadString();
                int items = maxItems;
                if (version >= 294) items = r.ReadInt32();
                for (int slot = 0; slot < items; slot++)
                {
                    short stack = r.ReadInt16();
                    if (stack > 0) { r.ReadInt32(); r.ReadByte(); }
                }
            }
        }

        private static bool[] ReadBitArray(BinaryReader reader)
        {
            int length = reader.ReadInt16();
            var booleans = new bool[length];
            byte data = 0;
            byte mask = 128;
            for (int i = 0; i < length; i++)
            {
                if (mask != 128) mask = (byte)(mask << 1);
                else { data = reader.ReadByte(); mask = 1; }
                if ((data & mask) == mask) booleans[i] = true;
            }
            return booleans;
        }

        /// <summary>把蓝图粘贴到世界：(left, bottom) 为蓝图左下角的世界图格坐标。空气格默认不覆盖（pasteEmpty=false）</summary>
        public int Paste(ITileWriter w, int left, int bottom, bool pasteEmpty = false)
        {
            int top = bottom - Height + 1;
            int n = 0;
            for (int x = 0; x < Width; x++)
                for (int y = 0; y < Height; y++)
                {
                    var t = Tiles[x, y];
                    if (!pasteEmpty && !t.IsActive && t.Wall == 0 && t.LiquidAmount == 0) continue;
                    int wx = left + x, wy = top + y;
                    if (wx < 1 || wy < 1 || wx >= w.MaxTilesX - 1 || wy >= w.MaxTilesY - 1) continue;
                    w.SetRaw(wx, wy, t);
                    n++;
                }
            foreach (var s in Signs) w.SetSignText(left + s.X, top + s.Y, s.Text);
            return n;
        }
    }
}
