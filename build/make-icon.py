"""元画像(白背景のアイコン)から、背景を透明にした icon.png / icon.ico を作る。
使い方: python3 build/make-icon.py 元画像.jpg
必要: pip install pillow numpy scipy"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build')
im = Image.open(src).convert('RGB')
a = np.array(im).astype(int)
mn = a.min(axis=2)
# 画像の縁とつながっている、ほぼ白の部分(+ごく薄い影)を背景とみなす
cand = mn >= 228
lab, _ = ndimage.label(cand)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bg = np.isin(lab, list(border))
fg = ~bg
fg = ndimage.binary_fill_holes(fg)           # 中の白(ページ)は残す
# 背景のすぐ外側にできた明るい影(本体の濃い縁より明るい部分)を、縁とつながっている範囲だけ除く
light = fg & (mn >= 135)
lab2, _ = ndimage.label(light)
touch = set(np.unique(lab2[ndimage.binary_dilation(bg, iterations=2) & light])) - {0}
fg = fg & ~np.isin(lab2, list(touch))
fg = ndimage.binary_fill_holes(fg)
fg = ndimage.binary_opening(fg, iterations=2)
fg = ndimage.binary_erosion(fg, iterations=5)   # 影の薄い縁を削る(アイコンの紺色の縁は十分に厚い)
ys, xs = np.where(fg)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
alpha = Image.fromarray((fg * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.9))
rgba = im.copy(); rgba.putalpha(alpha)
rgba = rgba.crop((x0, y0, x1, y1))
w, h = rgba.size
side = int(max(w, h) * 1.06)
sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
sq.paste(rgba, ((side - w) // 2, (side - h) // 2), rgba)
big = sq.resize((1024, 1024), Image.LANCZOS)
big.resize((512, 512), Image.LANCZOS).save(os.path.join(out, 'icon.png'))
sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
big.save(os.path.join(out, 'icon.ico'), sizes=[(s, s) for s in sizes])
print('icon.png 512x512, icon.ico', sizes, 'crop', (x0, y0, x1, y1))
