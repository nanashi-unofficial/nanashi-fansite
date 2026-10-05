#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
歌唱リスト.xlsx → data/songs.js 変換スクリプト

使い方（このフォルダで実行）:
    python3 tools/convert_songs.py

  ・追加のライブラリは不要です（Mac に最初から入っている Python 3 だけで動きます）。
  ・「歌唱リスト」シートの 1 行目を見出しとして読み、2 行目以降を取り込みます。
  ・記入例の行（アーカイブURL に XXXXXXXXXXX が残っている行）は除外します。
  ・G 列以降に「よみ」列があれば、五十音順の並べ替えに使います（任意）。

オプション:
    python3 tools/convert_songs.py 別の場所/歌唱リスト.xlsx      # 入力ファイルを指定
    python3 tools/convert_songs.py --out data/songs.js          # 出力先を指定
"""
import argparse
import datetime
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

# URL から不要な追跡用の引数（YouTube の共有者識別 si= など）を取り除く
DROP_PARAMS = {"si", "pp", "feature", "utm_source", "utm_medium", "utm_campaign"}


def clean_url(url):
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url
    if not parts.scheme:
        return url
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in DROP_PARAMS]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def check_headers(headers):
    """1 行目の見出しが想定どおりか確認する。違えば分かりやすいメッセージで終了する。"""
    if headers != HEADERS:
        sys.exit(
            "エラー: 1行目の見出しが想定と違います。\n"
            f"  想定: {HEADERS}\n  実際: {headers}\n"
            "  見出しの文字・順番を元に戻してから、もう一度実行してください。"
        )


def open_xlsx(path):
    """Excel ファイルを開く。開けない場合は日本語のメッセージで終了する。"""
    if not os.path.exists(path):
        sys.exit(f"エラー: Excel ファイルが見つかりません: {path}")
    try:
        return zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        sys.exit(
            f"エラー: Excel ブック（.xlsx）として読めません: {path}\n"
            "  Numbers や CSV で保存したファイルの可能性があります。Excel で「名前を付けて保存」→"
            "「Excel ブック (.xlsx)」で保存し直してください。"
        )

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}
SHEET_NAME = "歌唱リスト"
HEADERS = ["曲名", "アーティスト", "種類", "形式", "歌った日", "アーカイブURL"]
KEYS = ["title", "artist", "kind", "format", "date", "url"]
YOMI_HEADERS = {"よみ", "読み", "よみがな", "ふりがな", "読み仮名"}
KINDS = ["音源", "弾き語り", "アカペラ"]
FORMATS = ["歌枠", "動画", "Short"]
SAMPLE_MARK = "XXXXXXXXXXX"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def col_index(ref):
    """'F12' → 5 （A=0, B=1, ...）"""
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - ord("A") + 1)
    return n - 1


def load_shared_strings(z):
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    out = []
    for si in root.findall("m:si", NS):
        # 文字列本体 <t> と書式付きの <r><t> だけを拾う。<rPh>（Excel が裏で持つふりがな）は含めない
        parts = [t.text or "" for t in si.findall("m:t", NS)]
        for r in si.findall("m:r", NS):
            parts.extend(t.text or "" for t in r.findall("m:t", NS))
        out.append("".join(parts))
    return out


def find_sheet_path(z, name):
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    date1904 = False
    pr = wb.find("m:workbookPr", NS)
    if pr is not None and pr.get("date1904") in ("1", "true"):
        date1904 = True
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid_to_target = {
        rel.get("Id"): rel.get("Target") for rel in rels.findall("pr:Relationship", NS)
    }
    for sh in wb.findall("m:sheets/m:sheet", NS):
        if sh.get("name") == name:
            target = rid_to_target[sh.get(f"{{{NS['r']}}}id")]
            target = target.lstrip("/")
            if not target.startswith("xl/"):
                target = "xl/" + target
            return target, date1904
    names = [sh.get("name") for sh in wb.findall("m:sheets/m:sheet", NS)]
    sys.exit(f"エラー: シート「{name}」が見つかりません。あるシート: {names}")


def read_rows(z, sheet_path, shared):
    """行ごとに {列番号: 値} の辞書を返す。値は文字列か数値。"""
    root = ET.fromstring(z.read(sheet_path))
    rows = []
    for row in root.findall("m:sheetData/m:row", NS):
        cells = {}
        for c in row.findall("m:c", NS):
            ref = c.get("r")
            t = c.get("t", "n")
            v = c.find("m:v", NS)
            val = None
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr":
                is_ = c.find("m:is", NS)
                if is_ is not None:
                    val = "".join(x.text or "" for x in is_.iter(f"{{{NS['m']}}}t"))
            elif t == "b" and v is not None:
                val = "TRUE" if v.text == "1" else "FALSE"
            elif v is not None:
                txt = v.text
                try:
                    val = float(txt)
                except (TypeError, ValueError):
                    val = txt
            if val is not None:
                cells[col_index(ref)] = val
        rows.append((int(row.get("r")), cells))
    return rows


def to_text(v):
    if v is None:
        return ""
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else str(v)
    return str(v).strip()


def to_date(v, date1904):
    """Excel の日付（連番）や文字列を YYYY-MM-DD に変換。変換できなければ元の文字列。"""
    if v is None:
        return ""
    if isinstance(v, float):
        base = datetime.date(1904, 1, 1) if date1904 else datetime.date(1899, 12, 30)
        return (base + datetime.timedelta(days=int(v))).isoformat()
    s = str(v).strip()
    m = re.match(r"^(\d{4})[/\-.年]\s*(\d{1,2})[/\-.月]\s*(\d{1,2})日?$", s)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return s


def main():
    ap = argparse.ArgumentParser(description="歌唱リスト.xlsx を data/songs.js に変換します")
    ap.add_argument("xlsx", nargs="?", default=os.path.join(ROOT, "歌唱リスト.xlsx"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "songs.js"))
    args = ap.parse_args()

    with open_xlsx(args.xlsx) as z:
        shared = load_shared_strings(z)
        sheet_path, date1904 = find_sheet_path(z, SHEET_NAME)
        rows = read_rows(z, sheet_path, shared)

    if not rows:
        sys.exit("エラー: シートが空です。")

    # 見出し行のチェック
    header_row = rows[0][1]
    check_headers([to_text(header_row.get(i)) for i in range(6)])
    yomi_col = None
    for i, v in header_row.items():
        if i >= 6 and to_text(v) in YOMI_HEADERS:
            yomi_col = i

    songs, warnings, skipped_sample, skipped_empty = [], [], 0, 0
    for rownum, cells in rows[1:]:
        rec = {k: to_text(cells.get(i)) for i, k in enumerate(KEYS)}
        rec["date"] = to_date(cells.get(4), date1904)
        rec["url"] = clean_url(rec["url"])
        if not any(cells.values()):
            continue  # 書式だけ入っている空の行は数えない
        if not any(rec[k] for k in ("title", "artist", "url")):
            skipped_empty += 1
            continue
        if SAMPLE_MARK in rec["url"]:
            skipped_sample += 1
            continue
        if yomi_col is not None:
            rec["yomi"] = to_text(cells.get(yomi_col))
        # 値の軽いチェック（間違いがあっても取り込みは続けます）
        if not rec["title"]:
            warnings.append(f"{rownum}行目: 曲名が空です")
        if not rec["url"]:
            warnings.append(f"{rownum}行目: アーカイブURL が空です")
        elif not rec["url"].startswith("http"):
            warnings.append(f"{rownum}行目: アーカイブURL が http から始まっていません: {rec['url']}")
        if rec["kind"] and rec["kind"] not in KINDS:
            warnings.append(f"{rownum}行目: 種類「{rec['kind']}」は {KINDS} のどれでもありません")
        if rec["format"] and rec["format"] not in FORMATS:
            warnings.append(f"{rownum}行目: 形式「{rec['format']}」は {FORMATS} のどれでもありません")
        if rec["date"] and not re.match(r"^\d{4}-\d{2}-\d{2}$", rec["date"]):
            warnings.append(f"{rownum}行目: 歌った日「{rec['date']}」を日付として読めませんでした")
        songs.append(rec)

    # 同じ曲名の別の行に「よみ」があれば引き継ぐ（歌枠で同じ曲を何度も歌う場合に毎回書かなくて済む）
    if yomi_col is not None:
        known = {}
        for rec in songs:
            if rec.get("yomi"):
                known.setdefault(rec["title"], rec["yomi"])
        for rec in songs:
            if not rec.get("yomi") and rec["title"] in known:
                rec["yomi"] = known[rec["title"]]

    today = datetime.date.today().isoformat()
    lines = [
        "// このファイルは tools/convert_songs.py が 歌唱リスト.xlsx から自動生成します。",
        "// 直接編集せず、Excel を直してから変換スクリプトを実行してください。",
        f"// 生成日時: {datetime.datetime.now():%Y-%m-%d %H:%M}  件数: {len(songs)}",
        f'window.SONGS_UPDATED = "{today}";',
        "window.SONGS = [",
    ]
    for rec in songs:
        lines.append("  " + json.dumps(rec, ensure_ascii=False) + ",")
    lines.append("];")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, args.out)

    print(f"完了: {len(songs)} 件を書き出しました → {os.path.relpath(args.out, ROOT)}")
    print(f"      記入例の行を {skipped_sample} 件、空の行を {skipped_empty} 件スキップしました。")
    if yomi_col is not None:
        print("      「よみ」列を読み込みました（五十音順の並べ替えに使います）。")
    if warnings:
        print("注意（取り込みは済んでいますが、Excel の確認をおすすめします）:")
        for w in warnings:
            print("  - " + w)


if __name__ == "__main__":
    main()
