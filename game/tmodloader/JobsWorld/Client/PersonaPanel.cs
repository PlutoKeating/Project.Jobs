// 人物面板（UIState）：名字、年龄·职业、地点、状态；正在使用的软件（步骤、在想、动作、实时截图）；
// 上一段 / 现在 / 下一段日程与意图；按钮：跟随、传送、追问（输入框）、打开主页。
// 数据：打开时与之后每 2 秒向服务端请求 jw.detail（ModPacket），截图直接从 API 下载（HTTP，后台线程），在主线程创建纹理。
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using JobsWorld.Common;
using JobsWorld.Shared.Protocol;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using ReLogic.Graphics;
using Terraria;
using Terraria.GameContent;
using Terraria.GameContent.UI.Elements;
using Terraria.ModLoader;
using Terraria.UI;

namespace JobsWorld.Client
{
    public sealed class PersonaPanel : UIState
    {
        private const int W = 470, Pad = 12;
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
        private static readonly Color Accent = new Color(255, 210, 127);

        private UIPanel _root = null!;
        private PanelBody _body = null!;
        private UITextPanel<string> _follow = null!, _goto = null!, _profile = null!, _askBtn = null!, _close = null!;
        private JwTextBox _ask = null!;

        internal RosterEntry? Entry;
        internal DetailMsg? Detail;
        internal string Status = "";
        internal string? Answer;
        internal bool AnswerPending;
        private double _lastReq = -100, _lastReply = -100;

        // 截图
        internal Texture2D? Shot;
        internal string ShotEv = "";
        internal string ShotStatus = "";
        private int _shotGen;

        private static JwClientSystem Sys => ModContent.GetInstance<JwClientSystem>();
        private static double Now => Main.timeForVisualEffects / 60.0;

        public bool ContainsMouse => _root != null && _root.ContainsPoint(Main.MouseScreen);

        public override void OnInitialize()
        {
            _root = new UIPanel();
            _root.Left.Set(24, 0); _root.Top.Set(150, 0);
            _root.Width.Set(W, 0); _root.Height.Set(660, 0);
            _root.BackgroundColor = new Color(30, 34, 58, 235);
            _root.SetPadding(0);
            Append(_root);

            _body = new PanelBody(this);
            _body.Left.Set(Pad, 0); _body.Top.Set(Pad, 0);
            _body.Width.Set(W - Pad * 2, 0); _body.Height.Set(-Pad - 104, 1);
            _root.Append(_body);

            _close = Button("×", W - 40, 6, 30, (_, _) => Sys.ClosePanel());
            _root.Append(_close);

            _follow = Button("", Pad, -96, 140, (_, _) => ToggleFollow(), fromBottom: true);
            _goto = Button("", Pad + 148, -96, 120, (_, _) => { if (Entry != null) Sys.Send(Pkt.GotoReq, Entry.Id); }, fromBottom: true);
            _profile = Button("", Pad + 276, -96, W - Pad * 2 - 276, (_, _) => OpenProfile(), fromBottom: true);
            _root.Append(_follow); _root.Append(_goto); _root.Append(_profile);

            _ask = new JwTextBox(SubmitAsk);
            _ask.Left.Set(Pad, 0); _ask.Top.Set(-52, 1);
            _ask.Width.Set(W - Pad * 2 - 88, 0); _ask.Height.Set(40, 0);
            _root.Append(_ask);
            _askBtn = Button("", W - Pad - 80, -52, 80, (_, _) => SubmitAsk(_ask.Text), fromBottom: true);
            _root.Append(_askBtn);
        }

        private static UITextPanel<string> Button(string text, int left, int top, int width, UIElement.MouseEvent onClick, bool fromBottom = false)
        {
            var b = new UITextPanel<string>(text, 0.9f);
            b.Left.Set(left, 0);
            b.Top.Set(top, fromBottom ? 1 : 0);
            b.Width.Set(width, 0);
            b.Height.Set(36, 0);
            b.BackgroundColor = new Color(63, 82, 151, 220);
            b.OnLeftClick += onClick;
            b.OnMouseOver += (_, el) => ((UIPanel)el).BackgroundColor = new Color(90, 110, 190, 235);
            b.OnMouseOut += (_, el) => ((UIPanel)el).BackgroundColor = new Color(63, 82, 151, 220);
            return b;
        }

        // ---------------- 打开 / 关闭 ----------------

        internal void Open(RosterEntry e)
        {
            bool same = Entry?.Id == e.Id;
            Entry = e;
            if (!same)
            {
                Detail = null; Answer = null; AnswerPending = false; Status = Sys.T("加载中……", "Loading…");
                ShotEv = ""; ShotStatus = ""; _shotGen++;
                DisposeTexture();
                _ask.Text = "";
            }
            RequestDetail();
        }

        internal void Close()
        {
            Entry = null;
            _ask.Focused = false;
        }

        internal void DisposeTexture()
        {
            var t = Shot; Shot = null;
            if (t != null) Main.QueueMainThreadAction(() => t.Dispose());
        }

        private void RequestDetail()
        {
            if (Entry == null) return;
            _lastReq = Now;
            Sys.Send(Pkt.DetailReq, Entry.Id);
        }

        public override void Update(GameTime gameTime)
        {
            base.Update(gameTime);
            if (Entry == null) return;
            if (ContainsMouse) Main.LocalPlayer.mouseInterface = true;
            // 每 2 秒刷新一次（上一次应答回来后，或等了 6 秒还没回来）
            if (Now - _lastReq > 2 && (_lastReply >= _lastReq || Now - _lastReq > 6)) RequestDetail();
            // 名册里有最新的名字 / 软件
            foreach (var r in Sys.Roster.Values) if (r.Id == Entry.Id) { Entry = r; break; }
            bool following = Sys.FollowingId == Entry.Id;
            _follow.SetText(following ? Sys.T("取消跟随", "Unfollow") : Sys.T("跟随", "Follow"));
            _goto.SetText(Sys.T("传送过去", "Go to"));
            _profile.SetText(Sys.T("打开主页", "Open profile"));
            _askBtn.SetText(AnswerPending ? "…" : Sys.T("问他", "Ask"));
            _ask.Placeholder = Sys.T("向他提问（Session 结束后可追问）", "Ask a question (after a session ends)");
            float h = Math.Min(680, Main.screenHeight / Main.UIScale - 200);
            if (Math.Abs(_root.Height.Pixels - h) > 1) { _root.Height.Set(h, 0); Recalculate(); }
        }

        // ---------------- 数据 ----------------

        internal void OnDetail(string id, bool ok, string json)
        {
            if (Entry == null || id != Entry.Id) return;
            _lastReply = Now;
            if (!ok) { Status = Sys.T("详情获取失败：", "Detail failed: ") + json; return; }
            try
            {
                var d = JsonSerializer.Deserialize<DetailMsg>(json, Json.Options);
                if (d == null) return;
                if (!string.IsNullOrEmpty(d.Error)) { Status = d.Error!; return; }
                Detail = d;
                Status = "";
                var ev = d.Live?.Session?.ScreenshotEv ?? "";
                if (ev != ShotEv) LoadShot(ev);
            }
            catch (Exception e) { Status = Sys.T("详情解析失败：", "Bad detail: ") + e.Message; }
        }

        internal void OnAnswer(string id, bool ok, string text)
        {
            if (Entry == null || id != Entry.Id) return;
            AnswerPending = false;
            Answer = text;
        }

        private void LoadShot(string ev)
        {
            ShotEv = ev;
            int gen = ++_shotGen;
            if (string.IsNullOrEmpty(ev)) { ShotStatus = ""; DisposeTexture(); return; }
            ShotStatus = Sys.T("截图加载中……", "Loading screenshot…");
            var url = $"{Sys.ApiBase}/api/v1/evidence/{Uri.EscapeDataString(ev)}" + (string.IsNullOrEmpty(Sys.EvidenceKey) ? "" : $"?k={Sys.EvidenceKey}");
            Task.Run(async () =>
            {
                try
                {
                    using var res = await Http.GetAsync(url);
                    if ((int)res.StatusCode == 401 || (int)res.StatusCode == 403) { ShotStatus = Sys.T("截图需要网页口令（服务器设置了 JW_PASSCODE）", "Screenshot needs the web passcode (JW_PASSCODE)"); return; }
                    if (!res.IsSuccessStatusCode) { ShotStatus = Sys.T("截图不可用：HTTP ", "Screenshot unavailable: HTTP ") + (int)res.StatusCode; return; }
                    var bytes = await res.Content.ReadAsByteArrayAsync();
                    Main.QueueMainThreadAction(() =>
                    {
                        try
                        {
                            if (gen != _shotGen) return;
                            using var ms = new MemoryStream(bytes);
                            var tex = Texture2D.FromStream(Main.instance.GraphicsDevice, ms);
                            var old = Shot;
                            Shot = tex;
                            old?.Dispose();
                            ShotStatus = "";
                        }
                        catch (Exception e) { ShotStatus = Sys.T("截图解码失败：", "Screenshot decode failed: ") + e.Message; }
                    });
                }
                catch (Exception e) { if (gen == _shotGen) ShotStatus = Sys.T("截图下载失败：", "Screenshot download failed: ") + e.Message; }
            });
        }

        // ---------------- 按钮 ----------------

        private void ToggleFollow()
        {
            if (Entry == null) return;
            Sys.Send(Pkt.FollowReq, Sys.FollowingId == Entry.Id ? "" : Entry.Id);
        }

        private void SubmitAsk(string q)
        {
            if (Entry == null || AnswerPending) return;
            q = (q ?? "").Trim();
            if (q.Length == 0) { _ask.Focused = true; return; }
            AnswerPending = true;
            Answer = Sys.T("等待回答……（可能需要几十秒）", "Waiting for an answer… (may take a while)");
            Sys.Send(Pkt.AskReq, Entry.Id, Limits.Clip(q, 500));
            _ask.Text = "";
            _ask.Focused = false;
        }

        private void OpenProfile()
        {
            if (Entry == null) return;
            var url = $"{Sys.ApiBase}/people/{Uri.EscapeDataString(Entry.Id)}";
            try { ReLogic.OS.Platform.Get<ReLogic.OS.IClipboard>().Value = url; } catch { }
            Main.NewText(Sys.T("主页（已复制）：", "Profile (copied): ") + url, Accent);
            try { Utils.OpenToURL(url); } catch { }
        }
    }

    /// <summary>面板正文：自绘文本（中英文按字符折行）与截图</summary>
    internal sealed class PanelBody : UIElement
    {
        private static readonly Color Dim = new Color(170, 170, 185);
        private readonly PersonaPanel _p;
        public PanelBody(PersonaPanel p) { _p = p; }

        private static JwClientSystem Sys => ModContent.GetInstance<JwClientSystem>();

        protected override void DrawSelf(SpriteBatch sb)
        {
            var e = _p.Entry;
            if (e == null) return;
            var dim = GetDimensions();
            var font = FontAssets.MouseText.Value;
            float x = dim.X, y = dim.Y, w = dim.Width, bottom = dim.Y + dim.Height;
            var live = _p.Detail?.Live;

            bool Line(string text, Color c, float scale = 0.9f, int maxLines = 3, float indent = 0)
            {
                if (string.IsNullOrWhiteSpace(text)) return true;
                foreach (var l in Wrap(font, text, (w - indent) / scale, maxLines))
                {
                    if (y + 22 * scale > bottom) return false;
                    Utils.DrawBorderString(sb, l, new Vector2(x + indent, y), c, scale);
                    y += 24 * scale;
                }
                return true;
            }
            void Gap(float g = 6) => y += g;

            // 标题
            Utils.DrawBorderString(sb, live?.Name ?? e.Name, new Vector2(x, y), new Color(255, 210, 127), 1.25f);
            y += 34;
            var age = live?.Age ?? e.Age;
            var occ = live?.Occupation ?? e.Occupation;
            Line($"{age}{Sys.T("岁", " y")}{(string.IsNullOrEmpty(live?.Gender) ? "" : " · " + live!.Gender)} · {occ}", Color.White);
            if (live != null)
            {
                Line(Sys.T("地点：", "Where: ") + Sys.PlaceName(live.PlaceId) + (live.Floor > 0 ? Sys.T($" {live.Floor + 1} 楼", $" floor {live.Floor + 1}") : live.Floor < 0 ? Sys.T(" 地下", " underground") : ""), Color.LightGray);
                Line(Sys.T("状态：", "Mode: ") + ModeLabel(live.Mode, live.Session?.App), Color.LightGray);
            }
            if (!string.IsNullOrEmpty(_p.Status)) Line(_p.Status, new Color(255, 150, 120));
            if (!string.IsNullOrEmpty(_p.Answer)) { Gap(); Line(Sys.T("回答：", "Answer: ") + _p.Answer, new Color(255, 230, 160), 0.85f, 6); }

            // 正在使用的软件
            var s = live?.Session;
            if (s != null)
            {
                Gap(8);
                var step = Sys.T($"第 {s.StepIdx + 1}{(s.StepsTotal.HasValue ? "/" + s.StepsTotal : "")} 步", $"step {s.StepIdx + 1}{(s.StepsTotal.HasValue ? "/" + s.StepsTotal : "")}");
                Line($"{s.App} {s.AppVersion} · {step}{(s.Replay == true ? Sys.T("（回放）", " (replay)") : "")}", new Color(160, 230, 160), 0.95f, 1);
                if (!string.IsNullOrEmpty(s.Monologue)) Line(Sys.T("在想：", "Thinking: ") + s.Monologue, new Color(200, 220, 255), 0.85f, 4);
                if (!string.IsNullOrEmpty(s.Action)) Line(Sys.T("动作：", "Action: ") + s.Action, Color.LightGray, 0.85f, 2);
                if (!string.IsNullOrEmpty(s.Intent)) Line(Sys.T("意图：", "Intent: ") + s.Intent, Color.LightGray, 0.85f, 2);
                // 截图
                var tex = _p.Shot;
                if (tex != null && !tex.IsDisposed)
                {
                    float maxH = Math.Min(260, bottom - y - 90);
                    if (maxH > 60)
                    {
                        float scale = Math.Min(w / tex.Width, maxH / tex.Height);
                        var rect = new Rectangle((int)x, (int)y + 4, (int)(tex.Width * scale), (int)(tex.Height * scale));
                        sb.Draw(TextureAssets.MagicPixel.Value, new Rectangle(rect.X - 1, rect.Y - 1, rect.Width + 2, rect.Height + 2), Color.Black * 0.6f);
                        sb.Draw(tex, rect, Color.White);
                        y = rect.Bottom + 8;
                    }
                }
                else if (!string.IsNullOrEmpty(_p.ShotStatus)) Line(_p.ShotStatus, Dim, 0.8f, 2);
            }

            // 日程：上一段 / 现在 / 下一段
            if (live != null)
            {
                Gap(8);
                var items = _p.Detail?.Agenda?.Items;
                if (live.Prev != null)
                {
                    var intent = items?.FirstOrDefault(i => i.From == live.Prev.From)?.Intent;
                    Line(Sys.T("之前 ", "Before ") + $"{live.Prev.From}-{live.Prev.To} {live.Prev.Activity} @{Sys.PlaceName(live.Prev.PlaceId)}", Dim, 0.82f, 2);
                    if (!string.IsNullOrEmpty(intent)) Line("→ " + intent, Dim, 0.78f, 2, 14);
                }
                Line(Sys.T("现在 ", "Now ") + live.Activity, Color.White, 0.86f, 2);
                if (!string.IsNullOrEmpty(live.Intent)) Line("→ " + live.Intent, Color.LightGray, 0.8f, 2, 14);
                if (live.Next != null)
                {
                    Line(Sys.T("接下来 ", "Next ") + $"{live.Next.From}-{live.Next.To} {live.Next.Activity} @{Sys.PlaceName(live.Next.PlaceId)}", new Color(255, 210, 127), 0.82f, 2);
                    if (!string.IsNullOrEmpty(live.Next.Intent)) Line("→ " + live.Next.Intent, new Color(230, 200, 150), 0.78f, 2, 14);
                }
            }

            // 记忆与历史（有空间时）
            var mems = _p.Detail?.Memories;
            if (mems != null && mems.Count > 0 && bottom - y > 60)
            {
                Gap(8);
                Line(Sys.T("记忆", "Memories"), Dim, 0.8f, 1);
                foreach (var m in mems.Take(3)) if (!Line("· " + m.Content, Dim, 0.76f, 2)) break;
            }
        }

        private static string ModeLabel(string mode, string? app) => mode switch
        {
            "session" => Sys.T("正在用 ", "using ") + (app ?? "?"),
            "replay" => Sys.T("回放 ", "replay ") + (app ?? "?"),
            "travel" => Sys.T("在路上", "on the way"),
            "event" => Sys.T("遇到事件", "event"),
            _ => Sys.T("日常", "idle"),
        };

        /// <summary>按字符宽度折行（中文没有空格，不能按单词折）</summary>
        internal static IEnumerable<string> Wrap(DynamicSpriteFont font, string text, float maxWidth, int maxLines)
        {
            text = text.Replace("\r", "").Replace('\n', ' ');
            int lines = 0, start = 0;
            while (start < text.Length && lines < maxLines)
            {
                int end = start;
                while (end < text.Length && font.MeasureString(text.Substring(start, end - start + 1)).X <= maxWidth) end++;
                if (end == start) end = start + 1;
                // 英文尽量在空格处断
                if (end < text.Length && text[end] != ' ')
                {
                    int sp = text.LastIndexOf(' ', end - 1, end - start);
                    if (sp > start + (end - start) / 2) end = sp + 1;
                }
                string line = text.Substring(start, end - start).TrimEnd();
                lines++;
                if (lines == maxLines && end < text.Length) line = line.Length > 1 ? line.Substring(0, line.Length - 1) + "…" : line;
                yield return line;
                start = end;
                while (start < text.Length && text[start] == ' ') start++;
            }
        }
    }
}
