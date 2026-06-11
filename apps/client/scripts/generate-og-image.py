from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "public"
WIDTH = 1200
HEIGHT = 630

WHITE = (248, 250, 252, 255)
MIST = (194, 203, 206, 255)
ORANGE = (249, 115, 22, 255)
AMBER = (251, 191, 36, 255)
CYAN = (54, 221, 241, 255)


def font(size, weight="regular", family="body"):
    display = [
        "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf",
        "/System/Library/Fonts/Avenir Next Condensed.ttc",
        "/System/Library/Fonts/Supplemental/Impact.ttf",
    ]
    body = [
        "/System/Library/Fonts/Avenir Next.ttc",
        "/System/Library/Fonts/SFCompact.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
    ]
    mono = [
        "/System/Library/Fonts/SFNSMono.ttf",
        "/System/Library/Fonts/Menlo.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    ]
    fallback = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if weight == "bold" else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if weight == "bold" else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]

    candidates = {"display": display, "body": body, "mono": mono}.get(family, body) + fallback
    for candidate in candidates:
        path = Path(candidate)
        if not path.exists():
            continue
        try:
            return ImageFont.truetype(str(path), size=size)
        except OSError:
            continue

    return ImageFont.load_default()


def alpha_layer(size=(WIDTH, HEIGHT)):
    return Image.new("RGBA", size, (0, 0, 0, 0))


def mix(start, end, t):
    return tuple(round(start[i] + (end[i] - start[i]) * t) for i in range(4))


def diagonal_gradient(size, stops):
    width, height = size
    gradient = Image.new("RGBA", size)
    pixels = gradient.load()
    span = width + height

    for y in range(height):
        for x in range(width):
            t = (x + y) / span
            for i in range(len(stops) - 1):
                left_t, left_color = stops[i]
                right_t, right_color = stops[i + 1]
                if left_t <= t <= right_t:
                    local = (t - left_t) / max(right_t - left_t, 0.001)
                    pixels[x, y] = mix(left_color, right_color, local)
                    break
            else:
                pixels[x, y] = stops[-1][1]

    return gradient


def add_noise(canvas):
    noise = Image.effect_noise((WIDTH, HEIGHT), 32).convert("L")
    texture = Image.new("RGBA", (WIDTH, HEIGHT), (255, 255, 255, 16))
    texture.putalpha(noise.point(lambda value: max(0, min(24, value // 10))))
    canvas.alpha_composite(texture)


def draw_grid(canvas):
    layer = alpha_layer()
    draw = ImageDraw.Draw(layer)
    horizon = 358
    vanishing = (760, 332)

    for x in range(-240, WIDTH + 260, 86):
        draw.line((x, HEIGHT + 26, vanishing[0], vanishing[1]), fill=(255, 255, 255, 18), width=1)

    y = horizon
    gap = 20
    while y < HEIGHT + 34:
        opacity = max(8, min(34, int((y - horizon) / 6)))
        draw.line((-120, y, WIDTH + 120, y + int((y - horizon) * 0.12)), fill=(255, 255, 255, opacity), width=1)
        y += gap
        gap += 6

    canvas.alpha_composite(layer)


def draw_scanlines(canvas):
    layer = alpha_layer()
    draw = ImageDraw.Draw(layer)
    for y in range(0, HEIGHT, 4):
        draw.line((0, y, WIDTH, y), fill=(0, 0, 0, 20), width=1)
    canvas.alpha_composite(layer)


def draw_glow_polygon(canvas, points, fill, blur):
    layer = alpha_layer()
    draw = ImageDraw.Draw(layer)
    draw.polygon(points, fill=fill)
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def draw_block(draw, top, left, right):
    draw.polygon(top, fill=(32, 40, 43, 255), outline=(89, 105, 105, 95))
    draw.polygon(left, fill=(15, 21, 25, 255), outline=(64, 76, 78, 82))
    draw.polygon(right, fill=(22, 28, 31, 255), outline=(64, 76, 78, 82))


def draw_arena(canvas):
    draw_glow_polygon(
        canvas,
        [(650, 332), (1004, 260), (1134, 390), (792, 512)],
        (249, 115, 22, 46),
        36,
    )
    draw_glow_polygon(
        canvas,
        [(618, 370), (820, 300), (910, 404), (704, 486)],
        (54, 221, 241, 42),
        34,
    )

    layer = alpha_layer()
    draw = ImageDraw.Draw(layer)

    platform_top = [(650, 338), (958, 250), (1110, 352), (792, 498)]
    platform_left = [(650, 338), (792, 498), (792, 530), (650, 375)]
    platform_right = [(792, 498), (1110, 352), (1110, 384), (792, 530)]
    draw_block(draw, platform_top, platform_left, platform_right)

    lane = [(720, 363), (944, 300), (1026, 354), (798, 435)]
    draw.polygon(lane, fill=(12, 17, 20, 210), outline=(94, 108, 108, 95))

    for t in [0.22, 0.44, 0.66]:
        a = (round(720 + (944 - 720) * t), round(363 + (300 - 363) * t))
        b = (round(798 + (1026 - 798) * t), round(435 + (354 - 435) * t))
        draw.line((a, b), fill=(255, 255, 255, 26), width=1)

    draw.line((748, 385, 984, 322), fill=(251, 191, 36, 130), width=5)
    draw.line((748, 385, 984, 322), fill=(255, 255, 255, 70), width=1)

    for x, y, color in [(724, 376, CYAN), (1000, 335, ORANGE)]:
        draw.line((x, y, x, y - 72), fill=(238, 244, 242, 210), width=4)
        draw.polygon([(x + 6, y - 70), (x + 52, y - 60), (x + 6, y - 46)], fill=color)
        draw.ellipse((x - 12, y - 7, x + 12, y + 7), fill=color)

    for x, y, color in [(792, 415, CYAN), (872, 372, AMBER), (948, 347, ORANGE)]:
        draw.rectangle((x - 13, y - 30, x + 13, y - 4), fill=(9, 12, 14, 255))
        draw.rectangle((x - 10, y - 27, x + 10, y - 7), fill=color)
        draw.rectangle((x - 11, y - 4, x + 11, y + 8), fill=(8, 10, 12, 255))
        draw.ellipse((x - 20, y + 3, x + 20, y + 14), fill=(0, 0, 0, 80))

    canvas.alpha_composite(layer)


def draw_logo(canvas, x, y, size):
    logo_path = PUBLIC_DIR / "logo-exploration" / "png" / "opus-strike-candidate-03-voxel-bolt-v2.svg.png"
    logo = Image.open(logo_path).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)

    shadow = alpha_layer()
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle((x - 16, y - 12, x + size + 16, y + size + 20), radius=30, fill=(0, 0, 0, 140))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)))
    canvas.alpha_composite(logo, (x, y))


def draw_lightning(canvas):
    layer = alpha_layer()
    draw = ImageDraw.Draw(layer)
    points = [(1038, 86), (928, 260), (1004, 252), (898, 490), (1104, 220), (1018, 230)]
    draw.line(points, fill=(255, 201, 82, 64), width=28, joint="curve")
    draw.line(points, fill=(255, 255, 255, 95), width=5, joint="curve")
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(1)))


def text_size(draw, text, text_font):
    left, top, right, bottom = draw.textbbox((0, 0), text, font=text_font)
    return right - left, bottom - top


def draw_tracking(draw, xy, text, text_font, fill, tracking):
    x, y = xy
    for char in text:
        draw.text((x, y), char, font=text_font, fill=fill)
        width, _ = text_size(draw, char, text_font)
        x += width + tracking


def draw_title(canvas):
    draw = ImageDraw.Draw(canvas)
    eyebrow = font(24, "bold", "mono")
    title_font = font(126, "bold", "display")
    subtitle_font = font(38, "bold", "body")
    body_font = font(30, "regular", "body")
    badge_font = font(21, "bold", "mono")

    draw_logo(canvas, 82, 66, 82)
    draw_tracking(draw, (184, 86), "SEASON 1  /  WEB ARENA SHOOTER", eyebrow, (159, 174, 176, 255), 1)

    shadow = alpha_layer()
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.text((75, 169), "SLOP", font=title_font, fill=(0, 0, 0, 170))
    shadow_draw.text((75, 292), "HEROES", font=title_font, fill=(0, 0, 0, 170))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(5)))

    draw.text((75, 164), "SLOP", font=title_font, fill=WHITE)
    draw.text((75, 287), "HEROES", font=title_font, fill=WHITE)

    draw.rectangle((82, 421, 248, 428), fill=ORANGE)
    draw.rectangle((258, 421, 338, 428), fill=CYAN)

    draw.text((78, 452), "Voxel arena hero shooter", font=subtitle_font, fill=WHITE)
    draw.text((80, 500), "Grapple. Blink. Burn. Bend time.", font=body_font, fill=MIST)

    badge = (80, 554, 328, 596)
    badge_layer = alpha_layer()
    badge_draw = ImageDraw.Draw(badge_layer)
    badge_draw.rounded_rectangle(badge, radius=6, fill=(8, 12, 14, 178), outline=(249, 115, 22, 150), width=1)
    canvas.alpha_composite(badge_layer)
    draw.text((103, 565), "CAPTURE THE FLAG", font=badge_font, fill=(228, 236, 236, 255))


def draw_corner_marks(canvas):
    layer = alpha_layer()
    draw = ImageDraw.Draw(layer)
    color = (255, 255, 255, 70)
    inset = 36
    length = 58
    for x, y, sx, sy in [
        (inset, inset, 1, 1),
        (WIDTH - inset, inset, -1, 1),
        (inset, HEIGHT - inset, 1, -1),
        (WIDTH - inset, HEIGHT - inset, -1, -1),
    ]:
        draw.line((x, y, x + length * sx, y), fill=color, width=2)
        draw.line((x, y, x, y + length * sy), fill=color, width=2)
    canvas.alpha_composite(layer)


def draw_background():
    canvas = diagonal_gradient(
        (WIDTH, HEIGHT),
        [
            (0.0, (3, 5, 8, 255)),
            (0.46, (8, 12, 15, 255)),
            (0.72, (17, 20, 18, 255)),
            (1.0, (5, 6, 8, 255)),
        ],
    )

    glow = alpha_layer()
    draw = ImageDraw.Draw(glow)
    draw.polygon([(640, -40), (1220, -40), (1220, 650), (960, 650), (760, 390)], fill=(249, 115, 22, 38))
    draw.polygon([(470, 650), (760, 346), (1070, 650)], fill=(54, 221, 241, 24))
    draw.polygon([(0, 0), (512, 0), (274, 630), (0, 630)], fill=(4, 6, 8, 92))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(28)))

    add_noise(canvas)
    draw_grid(canvas)
    draw_lightning(canvas)
    draw_scanlines(canvas)
    return canvas


def main():
    canvas = draw_background()
    draw_arena(canvas)
    draw_title(canvas)
    draw_corner_marks(canvas)

    vignette = alpha_layer()
    draw = ImageDraw.Draw(vignette)
    draw.rectangle((0, 0, WIDTH, HEIGHT), outline=(255, 255, 255, 24), width=2)
    for i in range(36):
        alpha = int(2 + i * 2.2)
        draw.rectangle((i, i, WIDTH - i, HEIGHT - i), outline=(0, 0, 0, alpha), width=1)
    canvas.alpha_composite(vignette)

    output = PUBLIC_DIR / "og-image.png"
    canvas.convert("RGB").save(output, "PNG", optimize=True)
    print(f"Wrote {output} ({WIDTH}x{HEIGHT})")


if __name__ == "__main__":
    main()
