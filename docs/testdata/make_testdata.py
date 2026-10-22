"""Creates sample receipts for manual testing: a photo-like Kassenbon PNG and a text-layer invoice PDF."""
from PIL import Image, ImageDraw, ImageFont
import os, zlib

here = os.path.dirname(os.path.abspath(__file__))

def font(size, bold=False):
    for name in (["consolab.ttf", "arialbd.ttf"] if bold else ["consola.ttf", "arial.ttf"]):
        p = os.path.join(r"C:\Windows\Fonts", name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

# --- Kassenbon PNG ---
W, H = 900, 1500
img = Image.new("RGB", (W, H), (246, 244, 238))
d = ImageDraw.Draw(img)
lines = [
    ("BILLA AG", True), ("Filiale 4711 - 1070 Wien", False), ("Mariahilfer Strasse 10", False), ("UID: ATU 12345678", False), ("", False),
    ("Kassenbon Nr. 4711/2026", False), ("Datum: 12.03.2026  17:42", False), ("", False),
    ("Bio Milch 1L            1,29 A", False), ("Vollkornbrot            3,49 A", False), ("Kaffee Bohnen 500g      7,99 B", False), ("Mineralwasser 6x1,5L    4,74 A", False), ("", False),
    ("SUMME EUR              17,51", True), ("Bankomat               17,51", False), ("", False),
    ("MwSt   Netto   Steuer  Brutto", False), ("A 10%   8,65    0,87    9,52", False), ("B 20%   6,66    1,33    7,99", False), ("", False),
    ("Vielen Dank fuer Ihren Einkauf!", False),
]
y = 60
for text, bold in lines:
    d.text((70, y), text, font=font(36, bold), fill=(30, 30, 30))
    y += 56
img = img.rotate(1.2, expand=False, fillcolor=(246, 244, 238))
img.save(os.path.join(here, "kassenbon_billa.png"))

# --- Minimal text-layer PDF (Helvetica, WinAnsi) ---
def pdf_escape(s):
    return s.replace("\\", "\\\\").replace("(", "\(").replace(")", "\)")

content_lines = [
    (50, 790, 16, "Mustermann IT Services GmbH"), (50, 772, 10, "Technikerstrasse 5, 4020 Linz"), (50, 760, 10, "UID-Nr.: ATU98765432"),
    (50, 720, 10, "Max Kunde"), (50, 708, 10, "Kundengasse 1"), (50, 696, 10, "1010 Wien"),
    (350, 720, 10, "Rechnung Nr. 2026-0042"), (350, 708, 10, "Rechnungsdatum: 03.02.2026"), (350, 696, 10, "Leistungszeitraum: Jaenner 2026"),
    (50, 640, 12, "Rechnung"),
    (50, 610, 10, "Pos  Beschreibung                 Menge   Einzelpreis   Betrag"),
    (50, 596, 10, "1    Softwareentwicklung           10 h    100,00        1.000,00"),
    (350, 560, 10, "Nettobetrag        1.000,00"), (350, 546, 10, "20 % USt             200,00"), (350, 528, 12, "Rechnungsbetrag    1.200,00"),
    (50, 480, 10, "Zahlbar innerhalb von 14 Tagen ohne Abzug."), (50, 466, 10, "IBAN: AT61 1904 3002 3457 3201   BIC: BKAUATWW"),
]
stream = "BT\n"
for x, y, size, text in content_lines:
    stream += f"/F1 {size} Tf 1 0 0 1 {x} {y} Tm ({pdf_escape(text)}) Tj\n"
stream += "ET\n"
stream_bytes = stream.encode("latin-1")
objs = []
objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>")
objs.append(b"<< /Length " + str(len(stream_bytes)).encode() + b" >>\nstream\n" + stream_bytes + b"endstream")
objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
out = b"%PDF-1.4\n"
offsets = []
for i, o in enumerate(objs, 1):
    offsets.append(len(out))
    out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
xref = len(out)
out += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode()
for off in offsets:
    out += f"{off:010d} 00000 n \n".encode()
out += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
open(os.path.join(here, "rechnung_mustermann.pdf"), "wb").write(out)

# --- Bank statement CSV (George style) ---
csv = """Buchungsdatum;Partnername;Partner IBAN;Buchungs-Details;Betrag;Währung;Valutadatum
12.03.2026;BILLA AG;;POS 12.03.2026 17:42 BILLA 4711;-17,51;EUR;13.03.2026
17.02.2026;Max Kunde;AT61 1904 3002 3457 3201;Rechnung 2026-0042;1.200,00;EUR;17.02.2026
31.03.2026;;;Kontoführungsentgelt Q1/2026;-9,90;EUR;31.03.2026
05.03.2026;A1 Telekom Austria AG;;Rechnung 123456789 Mobilfunk;-29,90;EUR;05.03.2026
"""
open(os.path.join(here, "kontoauszug_george.csv"), "w", encoding="utf-8-sig").write(csv)
print("testdata written")
