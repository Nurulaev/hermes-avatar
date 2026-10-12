from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1280, 640
bg = Image.new("RGB", (W, H), (10, 12, 18))
draw = ImageDraw.Draw(bg)

# subtle vertical gradient
for y in range(H):
    t = y / H
    c = (int(10 + 14 * t), int(12 + 10 * t), int(18 + 26 * t))
    draw.line([(0, y), (W, y)], fill=c)

src_path = "proofs/acceptance/final-live-desktop.png"
av = Image.open(src_path).convert("RGBA")
# crop to the avatar area: strip debug overlay (top) and taskbar (bottom),
# keep a tight vertical slice centered on the character
aw, ah = av.size
top = int(ah * 0.03)
bottom = int(ah * 0.93)
body = av.crop((0, top, aw, bottom))
bw, bh = body.size
crop_w = int(bh * 0.55)
cx = bw // 2
left = max(0, cx - crop_w // 2)
right = min(bw, left + crop_w)
av_crop = body.crop((left, 0, right, bh))

target_h = int(H * 0.92)
scale = target_h / av_crop.height
target_w = int(av_crop.width * scale)
av_resized = av_crop.resize((target_w, target_h), Image.LANCZOS)

# place avatar on the right side
ax = W - target_w - 60
ay = H - target_h
bg.paste(av_resized, (ax, ay), av_resized)

def find_font(size, bold=False):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()

title_font = find_font(84, bold=True)
sub_font = find_font(30)
tag_font = find_font(24)

draw.text((60, 170), "Hermes", font=title_font, fill=(235, 238, 245))
draw.text((60, 262), "Avatar", font=title_font, fill=(120, 200, 255))
draw.text((62, 370), "Live VRM desktop avatar for the Hermes AI agent", font=sub_font, fill=(190, 196, 210))
draw.text((62, 410), "Electron · three.js · emotions · lip-sync · streaming TTS/STT", font=tag_font, fill=(130, 140, 160))

draw.text((60, 60), "MIT · Linux · Python/Node", font=tag_font, fill=(100, 108, 128))

out_dir = "proofs/publish"
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "social-preview.png")
bg.convert("RGB").save(out_path, "PNG")
print("saved", out_path, bg.size)
