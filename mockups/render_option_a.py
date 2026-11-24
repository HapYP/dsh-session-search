"""Render Option A placement comparison for the session-content-search plugin.

Produces three artifacts:
  option-a-default.png      A1: prominent pill at the conversation header's left
  option-a-sidebar-top.png  A2: prominent pill at the sidebar top, above the
                            official Ctrl+K search box
  placement-compare.png     1:1 crops showing where each entry sits

All windows are drawn at supersampled resolution and downsampled, so edges and
CJK glyphs stay crisp.

Usage:  python mockups/render_option_a.py
"""

import os

from PIL import Image, ImageDraw, ImageFont

S = 2
W = 1440
WIN_H = 900
LEGEND_H = 164
CANVAS_H = WIN_H + LEGEND_H

BG = (23, 24, 28)
SIDEBAR = (27, 28, 33)
LAYER1 = (35, 37, 43)
LAYER2 = (43, 46, 53)
BORDER = (51, 54, 61)
TEXT = (232, 234, 237)
TEXT_DIM = (154, 160, 168)
TEXT_FAINT = (110, 116, 124)
ACCENT = (59, 130, 246)
ACCENT_DIM = (37, 74, 140)
ACCENT_TEXT = (233, 240, 255)
MARK = (239, 108, 108)
PAGE = (16, 17, 20)

FONT_DIR = r"C:\Windows\Fonts"
FONT_REG = os.path.join(FONT_DIR, "msyh.ttc")
FONT_BOLD = os.path.join(FONT_DIR, "msyhbd.ttc")


def font(size, bold=False):
    """Load the CJK UI font at the supersampled size."""
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size * S)


def rect(draw, box, radius=0, fill=None, outline=None, width=1):
    """Draw a (rounded) rectangle in unscaled coordinates."""
    scaled = tuple(v * S for v in box)
    if radius:
        draw.rounded_rectangle(scaled, radius=radius * S, fill=fill, outline=outline, width=width * S)
    else:
        draw.rectangle(scaled, fill=fill, outline=outline, width=width * S)


def text(draw, xy, value, size=13, color=TEXT, bold=False, anchor="la"):
    """Draw one text run in unscaled coordinates."""
    draw.text((xy[0] * S, xy[1] * S), value, font=font(size, bold), fill=color, anchor=anchor)


def circle(draw, center, r, fill=None, outline=None, width=1):
    """Draw a circle."""
    cx, cy = center
    draw.ellipse(((cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S),
                 fill=fill, outline=outline, width=width * S)


def magnifier(draw, center, size, color):
    """Draw a magnifier glyph."""
    cx, cy = center
    r = size * 0.38
    circle(draw, (cx - size * 0.08, cy - size * 0.08), r, outline=color, width=max(1, int(size * 0.14)))
    draw.line(((cx + r * 0.62) * S, (cy + r * 0.62) * S, (cx + size * 0.46) * S, (cy + size * 0.46) * S),
              fill=color, width=max(1, int(size * 0.15)) * S)


def folder(draw, xy, size, color):
    """Draw a small folder glyph."""
    x, y = xy
    rect(draw, (x, y + size * 0.22, x + size, y + size * 0.85), radius=2, fill=color)
    rect(draw, (x, y + size * 0.05, x + size * 0.45, y + size * 0.3), radius=1, fill=color)


def gear(draw, center, size, color):
    """Draw a simplified settings glyph."""
    circle(draw, center, size * 0.34, outline=color, width=2)
    circle(draw, center, size * 0.1, fill=color)


def chip(draw, box, label, text_color=TEXT_DIM, fill=LAYER1, border=BORDER, size=10):
    """Draw a key-hint chip."""
    rect(draw, box, radius=4, fill=fill, outline=border, width=1)
    text(draw, ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2), label, size=size,
         color=text_color, anchor="mm")


def marker(draw, number, center):
    """Draw one numbered marker."""
    circle(draw, center, 10, fill=MARK)
    text(draw, center, str(number), size=11, color=(26, 20, 20), bold=True, anchor="mm")


def search_pill(draw, box, label="搜索会话内容", keys="Ctrl Shift F", radius=9):
    """Draw the promotional search pill inside the given box."""
    rect(draw, box, radius=radius, fill=ACCENT_DIM, outline=ACCENT, width=1)
    mid_y = (box[1] + box[3]) / 2
    magnifier(draw, (box[0] + 21, mid_y), 15, ACCENT_TEXT)
    text(draw, (box[0] + 38, mid_y), label, size=12, color=ACCENT_TEXT, bold=True, anchor="lm")
    chip(draw, (box[2] - 82, box[1] + 6, box[2] - 8, box[3] - 6), keys,
         text_color=(214, 228, 255), fill=(27, 56, 108), border=ACCENT, size=9)


def bottom_pill(draw, box, accent=False):
    """Draw the enlarged sidebar-bottom search entry.

    accent=False renders it like a search input (dark fill, accent glyph);
    accent=True tints it like the A2 pill for maximum prominence.
    """
    radius = 9
    rect(draw, box, radius=radius, fill=ACCENT_DIM if accent else LAYER1,
         outline=ACCENT if accent else BORDER, width=1)
    mid_y = (box[1] + box[3]) / 2
    magnifier(draw, (box[0] + 19, mid_y), 14, ACCENT_TEXT if accent else ACCENT)
    text(draw, (box[0] + 34, mid_y), "搜索全部会话", size=11,
         color=ACCENT_TEXT if accent else TEXT, anchor="lm")
    chip(draw, (box[2] - 68, box[1] + 6, box[2] - 8, box[3] - 7), "Ctrl Shift F",
         text_color=(214, 228, 255) if accent else TEXT_DIM,
         fill=(27, 56, 108) if accent else LAYER2,
         border=ACCENT if accent else BORDER, size=8)


def rail_sidebar(draw):
    """Paint the collapsed (rail) sidebar column, 60px wide."""
    rect(draw, (0, 0, 60, WIN_H), fill=SIDEBAR)
    draw.line((60 * S, 0, 60 * S, WIN_H * S), fill=BORDER, width=S)
    rect(draw, (14, 16, 46, 48), radius=9, fill=ACCENT)
    text(draw, (30, 32), "DS", size=9, color=(255, 255, 255), bold=True, anchor="mm")
    # A few rail rows for context.
    for index in range(3):
        rect(draw, (18, 80 + index * 34, 42, 104 + index * 34), radius=6, fill=LAYER1)
    draw.line((10 * S, 800 * S, 50 * S, 800 * S), fill=BORDER, width=S)
    # Icon-only entry, then settings.
    rect(draw, (14, 812, 46, 844), radius=8, fill=ACCENT_DIM, outline=ACCENT, width=1)
    magnifier(draw, (30, 828), 14, ACCENT_TEXT)
    gear(draw, (30, 866), 14, TEXT_DIM)


def sidebar(draw, mode):
    """Paint the sidebar column.

    mode: 'current' | 'a1' | 'a2'. 'a2' reserves a row for the new pill above
    the official search box and pushes the rest down.
    """
    rect(draw, (0, 0, 260, WIN_H), fill=SIDEBAR)
    draw.line((260 * S, 0, 260 * S, WIN_H * S), fill=BORDER, width=S)

    rect(draw, (16, 16, 44, 44), radius=9, fill=ACCENT)
    text(draw, (30, 30), "DS", size=11, color=(255, 255, 255), bold=True, anchor="mm")
    text(draw, (54, 30), "DeepSeek Harness", size=13, color=TEXT, bold=True, anchor="lm")

    y_search = 60
    if mode == "a2":
        search_pill(draw, (14, 54, 246, 86))
        marker(draw, 1, (256, 70))
        y_search = 94

    # Official title-search box.
    rect(draw, (14, y_search, 246, y_search + 32), radius=8, fill=LAYER1, outline=BORDER, width=1)
    magnifier(draw, (32, y_search + 16), 13, TEXT_FAINT)
    text(draw, (46, y_search + 16), "搜索会话", size=12, color=TEXT_FAINT, anchor="lm")
    chip(draw, (200, y_search + 7, 240, y_search + 25), "Ctrl K")

    label_y = y_search + 48
    text(draw, (16, label_y), "工作区", size=11, color=TEXT_FAINT)
    groups = [
        ("create_plugin", ["会话内容搜索插件开发", "插件 UI 交互打磨", "全局搜索性能优化"]),
        ("assitant_goudan", ["提示词模板整理"]),
        ("hapyp_trade_system", ["行情接入排查", "编译告警清理"]),
    ]
    y = label_y + 22
    for name, sessions in groups:
        folder(draw, (16, y), 13, TEXT_DIM)
        text(draw, (36, y + 6), name, size=12, color=TEXT_DIM, bold=True, anchor="lm")
        y += 24
        for index, title in enumerate(sessions):
            active = name == "create_plugin" and index == 0
            if active:
                rect(draw, (12, y - 4, 248, y + 20), radius=6, fill=LAYER2)
            text(draw, (36, y + 6), title, size=12, color=TEXT if active else TEXT_DIM, anchor="lm")
            y += 26
        y += 8

    # Footer: settings plus the plugin entry. 'a3' enlarges that entry into a
    # full-width search pill above Settings.
    if mode == "a3" or mode == "a3-accent":
        draw.line((14 * S, 814 * S, 246 * S, 814 * S), fill=BORDER, width=S)
        bottom_pill(draw, (14, 824, 246, 860), accent=mode == "a3-accent")
        gear(draw, (30, 880), 14, TEXT_DIM)
        text(draw, (46, 880), "设置", size=12, color=TEXT_DIM, anchor="lm")
    else:
        draw.line((14 * S, 838 * S, 246 * S, 838 * S), fill=BORDER, width=S)
        gear(draw, (30, 864), 14, TEXT_DIM)
        text(draw, (46, 864), "设置", size=12, color=TEXT_DIM, anchor="lm")
        if mode != "a2":
            rect(draw, (118, 850, 246, 878), radius=7, fill=LAYER1, outline=BORDER, width=1)
            magnifier(draw, (134, 864), 13, TEXT_DIM)
            text(draw, (146, 864), "搜索会话内容", size=11, color=TEXT_DIM, anchor="lm")


def header(draw, prominent):
    """Paint the conversation header, optionally with the promotional pill."""
    rect(draw, (260, 0, W, 60), fill=BG)
    draw.line((260 * S, 60 * S, W * S, 60 * S), fill=BORDER, width=S)

    x = 284
    if prominent:
        search_pill(draw, (x, 15, x + 230, 45))
        marker(draw, 1, (276, 30))
        x += 250

    text(draw, (x, 30), "会话内容搜索插件开发", size=14, color=TEXT, bold=True, anchor="lm")

    for offset in (0, 1, 2):
        cx = W - 40 - offset * 32
        rect(draw, (cx - 13, 16, cx + 13, 44), radius=7, fill=LAYER1, outline=BORDER, width=1)
        circle(draw, (cx, 30), 1.6, fill=TEXT_DIM)


def conversation(draw):
    """Paint a stylised conversation body."""
    bubble_w = 520
    bx = W - 40 - bubble_w
    rect(draw, (bx, 92, W - 40, 158), radius=12, fill=LAYER2)
    text(draw, (bx + 16, 108), "会话内搜索时，最右边的解释是否可以去掉？", size=13, color=TEXT, anchor="lm")
    text(draw, (bx + 16, 136), "另外它是什么意思，意思是更早历史不会被查找？", size=13, color=TEXT, anchor="lm")

    for index, line in enumerate([
        "可以去掉，我来删。先解释含义（你的理解完全正确）：",
        "很久以前的回合只有向上滚动浏览时才会加载，会话内查找只扫描已渲染内容。",
    ]):
        text(draw, (300, 196 + index * 26), line, size=13, color=TEXT, anchor="lm")

    phrase = "完整会话历史"
    prefix = "每次搜索同时查询"
    width = draw.textlength(phrase, font=font(13)) / S
    start = 300 + draw.textlength(prefix, font=font(13)) / S
    rect(draw, (start, 254, start + width, 274), radius=3, fill=(86, 74, 26))
    text(draw, (300, 264), prefix, size=13, color=TEXT, anchor="lm")
    text(draw, (start, 264), phrase, size=13, color=(255, 232, 150), anchor="lm")
    text(draw, (start + width, 264), "，并在计数区显示总数。", size=13, color=TEXT, anchor="lm")

    rect(draw, (300, 300, 980, 336), radius=8, fill=LAYER1, outline=BORDER, width=1)
    rect(draw, (312, 308, 326, 328), radius=4, fill=TEXT_FAINT)
    text(draw, (336, 318), "grep  client.js", size=12, color=TEXT_DIM, anchor="lm")

    rect(draw, (300, 806, W - 40, 884), radius=14, fill=LAYER1, outline=BORDER, width=1)
    text(draw, (320, 845), "输入消息，或按 / 使用命令…", size=13, color=TEXT_FAINT, anchor="lm")
    rect(draw, (W - 176, 830, W - 62, 860), radius=7, fill=LAYER2)
    text(draw, (W - 166, 845), "deepseek-flash", size=11, color=TEXT_DIM, anchor="lm")
    circle(draw, (W - 80, 845), 13, fill=ACCENT)


def render_window(mode, prominent):
    """Render one full window at supersampled resolution."""
    img = Image.new("RGB", (W * S, WIN_H * S), BG)
    draw = ImageDraw.Draw(img)
    sidebar(draw, mode)
    header(draw, prominent)
    conversation(draw)
    if mode == "a1" and prominent:
        marker(draw, 2, (140, 864))
    return img


def with_legend(window, entries, title, path):
    """Compose the window with its legend strip and save it."""
    canvas = Image.new("RGB", (W * S, CANVAS_H * S), PAGE)
    canvas.paste(window, (0, 0))
    draw = ImageDraw.Draw(canvas)
    top = WIN_H + 8
    rect(draw, (16, top, W - 16, CANVAS_H - 12), radius=12, fill=(20, 21, 25), outline=BORDER, width=1)
    text(draw, (38, top + 30), title, size=13, color=TEXT, bold=True, anchor="lm")
    y = top + 54
    for number, caption in entries:
        if number is None:
            circle(draw, (44, y), 3.5, fill=TEXT_FAINT)
        else:
            marker(draw, number, (44, y))
        text(draw, (66, y), caption, size=11, color=TEXT_DIM, anchor="lm")
        y += 26
    canvas.resize((W, CANVAS_H), Image.LANCZOS).save(path)


def crop(window, box):
    """Return one 1:1 crop of a supersampled window."""
    x0, y0, x1, y1 = box
    return window.crop((x0 * S, y0 * S, x1 * S, y1 * S)).resize((x1 - x0, y1 - y0), Image.LANCZOS)


def render_compare(current, a1, a2, path):
    """Compose the 1:1 placement comparison on a plain (non-supersampled) canvas."""
    rows = [
        ("现状 · 只有侧栏底部入口（当前版本）", crop(current, (0, 700, 260, 900))),
        ("A1 · 主区左上角胶囊，位于会话标题左侧", crop(a1, (260, 0, 1080, 78))),
        ("A2 · 侧栏顶部胶囊，位于官方搜索框上方", crop(a2, (0, 44, 260, 214))),
    ]
    margin, gap, title_h, caption_h = 24, 20, 26, 34
    content_w = max(image.width for _, image in rows)
    canvas_w = margin * 2 + content_w
    canvas_h = margin * 2 + caption_h + sum(title_h + image.height + gap for _, image in rows) - gap
    canvas = Image.new("RGB", (canvas_w, canvas_h), PAGE)
    draw = ImageDraw.Draw(canvas)

    title_font = ImageFont.truetype(FONT_BOLD, 13)
    caption_font = ImageFont.truetype(FONT_REG, 11)
    draw.text((margin, margin), "入口位置对照（按 1:1 截取对应区域）", font=title_font, fill=TEXT)

    y = margin + caption_h
    for title, image in rows:
        draw.text((margin, y), title, font=caption_font, fill=TEXT_DIM)
        y += title_h
        canvas.paste(image, (margin, y))
        draw.rectangle((margin - 1, y - 1, margin + image.width, y + image.height), outline=BORDER)
        y += image.height + gap

    canvas.save(path)


def render_rail():
    """Render the collapsed rail column on its own."""
    img = Image.new("RGB", (60 * S, WIN_H * S), BG)
    draw = ImageDraw.Draw(img)
    rail_sidebar(draw)
    return img


def render_styles(a3, a3_accent, rail, path):
    """Compose the A3 style/states comparison at 1:1."""
    rows = [
        ("变体 1 · 输入框风格（深色填充 + 强调色图标），推荐", crop(a3, (0, 790, 260, 900))),
        ("变体 2 · 强调蓝填充（与 A2 胶囊一致，最醒目）", crop(a3_accent, (0, 790, 260, 900))),
        ("侧栏折叠（窄栏）：收为图标按钮，位置不变", crop(rail, (0, 780, 60, 900))),
    ]
    margin, gap, title_h, caption_h = 24, 20, 26, 40
    content_w = max(image.width for _, image in rows)
    canvas_w = margin * 2 + content_w
    canvas_h = margin * 2 + caption_h + sum(title_h + image.height + gap for _, image in rows) - gap
    canvas = Image.new("RGB", (canvas_w, canvas_h), PAGE)
    draw = ImageDraw.Draw(canvas)
    draw.text((margin, margin), "方案 A3 · 放大侧栏底部入口（按 1:1 截取）", font=ImageFont.truetype(FONT_BOLD, 13), fill=TEXT)
    y = margin + caption_h
    for title, image in rows:
        draw.text((margin, y), title, font=ImageFont.truetype(FONT_REG, 11), fill=TEXT_DIM)
        y += title_h
        canvas.paste(image, (margin, y))
        draw.rectangle((margin - 1, y - 1, margin + image.width, y + image.height), outline=BORDER)
        y += image.height + gap
    canvas.save(path)


if __name__ == "__main__":
    out = os.path.dirname(os.path.abspath(__file__))
    current = render_window("current", False)
    a1 = render_window("a1", True)
    a2 = render_window("a2", False)

    with_legend(a1, [
        (1, "新增 · 主区左上角常驻搜索胶囊：点击或按 Ctrl+Shift+F 打开面板，无会话时同样显示"),
        (2, "保留 · 侧栏底部入口：习惯不变，窄栏折叠时只显示图标"),
        (None, "官方 Ctrl+K 标题搜索位置与行为完全不变，两者并存"),
    ], "方案 A1 · 只增加显眼入口，不接管、不改动官方搜索", os.path.join(out, "option-a-default.png"))

    with_legend(a2, [
        (1, "新增 · 侧栏顶部胶囊：与官方搜索框上下相邻，形成「标题搜索 / 内容搜索」并列入口"),
        (None, "官方 Ctrl+K 标题搜索位置与行为完全不变（下移一行）"),
        (None, "主区标题栏保持原样；侧栏折叠时胶囊收为图标按钮"),
    ], "方案 A2 · 入口放在侧栏顶部，紧邻官方搜索框", os.path.join(out, "option-a-sidebar-top.png"))

    render_compare(current, a1, a2, os.path.join(out, "placement-compare.png"))

    a3 = render_window("a3", False)
    a3_accent = render_window("a3-accent", False)
    rail = render_rail()
    with_legend(a3, [
        (1, "放大后的入口：整行宽的搜索框样式，位于「设置」正上方（沿用官方追加型槽位，不改动扇区布局）"),
        (None, "文案「搜索全部会话」+ 快捷键提示，直接表明作用域是全部会话，不会与 Ctrl+F 混淆"),
        (None, "侧栏折叠成窄栏时自动收为图标按钮，位置不变"),
    ], "方案 A3 · 入口仍在侧栏底部，但放大成搜索框样式", os.path.join(out, "option-a3-bottom.png"))
    render_styles(a3, a3_accent, rail, os.path.join(out, "option-a3-styles.png"))
    print("rendered option-a-default.png, option-a-sidebar-top.png, placement-compare.png,",
          "option-a3-bottom.png, option-a3-styles.png in", out)
