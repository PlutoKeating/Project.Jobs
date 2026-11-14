// 可输入的文本框（支持中文输入法）：点击获得焦点，Enter 提交，Esc 取消。仿照 tModLoader 自带的 UIFocusInputTextField。
using System;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Terraria;
using Terraria.GameContent;
using Terraria.GameContent.UI.Elements;
using Terraria.GameInput;
using Terraria.UI;

namespace JobsWorld.Client
{
    internal sealed class JwTextBox : UIPanel
    {
        public string Text = "";
        public string Placeholder = "";
        public bool Focused;
        public int MaxLength = 300;
        private readonly Action<string> _submit;
        private int _blink;

        public JwTextBox(Action<string> submit)
        {
            _submit = submit;
            BackgroundColor = new Color(20, 22, 40, 230);
            SetPadding(8);
            OnLeftClick += (_, _) => Focused = true;
        }

        public override void Update(GameTime gameTime)
        {
            base.Update(gameTime);
            if (Focused && Main.mouseLeft && !ContainsPoint(Main.MouseScreen)) Focused = false;
            if (ContainsPoint(Main.MouseScreen)) Main.LocalPlayer.mouseInterface = true;
        }

        protected override void DrawSelf(SpriteBatch sb)
        {
            base.DrawSelf(sb);
            var dim = GetInnerDimensions();
            if (Focused)
            {
                PlayerInput.WritingText = true;
                Main.instance.HandleIME();
                var next = Main.GetInputText(Text);
                if (next.Length > MaxLength) next = next.Substring(0, MaxLength);
                Text = next;
                if (Main.inputTextEnter) { Main.inputTextEnter = false; var t = Text; _submit(t); }
                if (Main.inputTextEscape) { Main.inputTextEscape = false; Focused = false; }
            }
            var font = FontAssets.MouseText.Value;
            // 只显示末尾能放下的部分
            string shown = Text;
            while (shown.Length > 0 && font.MeasureString(shown).X * 0.9f > dim.Width - 12) shown = shown.Substring(1);
            if (shown.Length == 0 && !Focused) Utils.DrawBorderString(sb, Placeholder, new Vector2(dim.X, dim.Y + 2), new Color(130, 130, 150), 0.85f);
            else
            {
                _blink = (_blink + 1) % 40;
                Utils.DrawBorderString(sb, shown + (Focused && _blink < 20 ? "|" : ""), new Vector2(dim.X, dim.Y + 2), Color.White, 0.9f);
            }
            if (Focused) Main.instance.DrawWindowsIMEPanel(new Vector2(dim.X, dim.Y + dim.Height + 8));
        }
    }
}
