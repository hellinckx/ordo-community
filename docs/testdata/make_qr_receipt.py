"""Kassenbon photo with an RKSV signature QR code (as printed by Austrian cash registers)."""
from PIL import Image, ImageDraw, ImageFont
import qrcode, os
here = os.path.dirname(os.path.abspath(__file__))
def font(size, bold=False):
    for name in (["consolab.ttf", "arialbd.ttf"] if bold else ["consola.ttf", "arial.ttf"]):
        p = os.path.join(r"C:\Windows\Fonts", name)
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()
W, H = 900, 1700
img = Image.new("RGB", (W, H), (248, 246, 240))
d = ImageDraw.Draw(img)
lines = [("SPAR Markt", True), ("Linzer Strasse 118, 1140 Wien", False), ("UID: ATU 59193205", False), ("", False),
         ("Beleg-Nr. 2026/00881234", False), ("20.10.2026 12:31", False), ("", False),
         ("Mineralwasser 1,5L     0,89 A", False), ("Joghurt Natur          1,49 A", False), ("Zahnpasta              3,29 B", False), ("", False),
         ("SUMME EUR               5,67", True), ("Bankomat                5,67", False), ("", False),
         ("A 10%  Netto 2,16  USt 0,22  Brutto 2,38", False), ("B 20%  Netto 2,74  USt 0,55  Brutto 3,29", False), ("", False),
         ("Kassen-ID: SPAR-1140-K3", False)]
y = 50
for text, bold in lines:
    d.text((70, y), text, font=font(34, bold), fill=(25, 25, 25)); y += 52
payload = "_R1-AT1_SPAR-1140-K3_2026/00881234_2026-10-20T12:31:04_3,29_2,38_0,00_0,00_0,00_bXlDb3VudGVy_a1b2c3d4_cHJldlNpZw==_ZmFrZVNpZ25hdHVyZQ=="
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=2)
qr.add_data(payload); qr.make(fit=True)
qimg = qr.make_image(fill_color="black", back_color="white").convert("RGB")
img.paste(qimg, ((W - qimg.width) // 2, y + 20))
img = img.rotate(-1.5, expand=False, fillcolor=(248, 246, 240))
img.save(os.path.join(here, "kassenbon_spar_qr.png"))
print("qr receipt written", qimg.size)
