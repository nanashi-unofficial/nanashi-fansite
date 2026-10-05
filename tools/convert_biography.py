#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
経歴.xlsx → data/biography.js 変換スクリプト

使い方（このフォルダで実行）:
    python3 tools/convert_biography.py

  ・追加のライブラリは不要です（Mac に最初から入っている Python 3 だけで動きます）。
  ・「経歴」シート: 1 行目を見出し（日付／出来事）として読み、2 行目以降を年表として取り込みます。
      出来事が「（記入例）」で始まる行と、日付も出来事も空の行は除外します。C 列「メモ」はサイトには出しません。
      行は上が古い順（新しい出来事は一番下）。順番が違ってもサイト側で日付順に並べ替えます。
  ・「紹介文」シート（任意）: 項目が「紹介文」の行がページ冒頭の文、それ以外の行はその下に出る小さなクレジット
      （例: Live2D ／ MahirU（イラスト・モデリング））になります。

オプション:
    python3 tools/convert_biography.py 別の場所/経歴.xlsx       # 入力ファイルを指定
    python3 tools/convert_biography.py --out data/biography.js  # 出力先を指定
"""
import argparse
import datetime
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

# Excel の読み込みは歌唱リストの変換スクリプトと共通
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import convert_songs as cs

SHEET_NAME = "経歴"
HEADERS = ["日付", "出来事"]
INTRO_SHEET = "紹介文"
INTRO_LABEL = "紹介文"
SAMPLE_PREFIX = "（記入例）"   # 出来事がこれで始まる行はサイトに出さない
ACTIVITY_START = datetime.date(2025, 10, 10)   # YouTube チャンネル開設日。これより前の日付は打ち間違いの可能性が高い
ROOT = cs.ROOT


def sheet_names(z):
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    return [sh.get("name") for sh in wb.findall("m:sheets/m:sheet", cs.NS)]


def main():
    ap = argparse.ArgumentParser(description="経歴.xlsx を data/biography.js に変換します")
    ap.add_argument("xlsx", nargs="?", default=os.path.join(ROOT, "経歴.xlsx"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "biography.js"))
    args = ap.parse_args()

    with cs.open_xlsx(args.xlsx) as z:
        shared = cs.load_shared_strings(z)
        sheet_path, date1904 = cs.find_sheet_path(z, SHEET_NAME)
        rows = cs.read_rows(z, sheet_path, shared)
        intro_rows = []
        if INTRO_SHEET in sheet_names(z):
            intro_path, _ = cs.find_sheet_path(z, INTRO_SHEET)
            intro_rows = cs.read_rows(z, intro_path, shared)

    if not rows:
        sys.exit("エラー: 「経歴」シートが空です。")

    # 見出し行のチェック
    header_row = rows[0][1]
    headers = [cs.to_text(header_row.get(i)) for i in range(len(HEADERS))]
    if headers != HEADERS:
        sys.exit(
            "エラー: 「経歴」シートの 1行目の見出しが想定と違います。\n"
            f"  想定: {HEADERS}\n  実際: {headers}\n"
            "  見出しの文字・順番を元に戻してから、もう一度実行してください。"
        )

    history, warnings = [], []
    skipped_sample = skipped_empty = 0
    today = datetime.date.today()
    prev = None   # 1 つ前の行の日付（順番の確認用）
    for rownum, cells in rows[1:]:
        if not any(cells.values()):
            continue  # 書式だけ入っている空の行は数えない
        date = cs.to_date(cells.get(0), date1904)
        text = cs.to_text(cells.get(1))
        if text.startswith(SAMPLE_PREFIX):
            skipped_sample += 1
            continue
        if not date and not text:
            skipped_empty += 1
            continue
        # 値の軽いチェック（間違いがあっても取り込みは続けます）
        if not text:
            warnings.append(f"{rownum}行目: 出来事が空です")
        if not date:
            warnings.append(f"{rownum}行目: 日付が空です（一覧の末尾に回ります）")
        elif not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            warnings.append(f"{rownum}行目: 日付「{date}」を日付として読めませんでした")
        else:
            d = datetime.date.fromisoformat(date)
            if d > today:
                warnings.append(f"{rownum}行目: 日付 {date} が今日より先です（年の打ち間違いではありませんか。月日だけ入力すると Excel は今年の年を付けます）")
            elif d < ACTIVITY_START:
                warnings.append(f"{rownum}行目: 日付 {date} が活動開始（{ACTIVITY_START}）より前です（年の打ち間違いではありませんか）")
            if prev and d < prev:
                warnings.append(f"{rownum}行目: 日付 {date} が前の行（{prev}）より古いです（表示は日付順に並ぶので問題ありませんが、年の打ち間違いなら直してください）")
            prev = d
        history.append({"date": date, "text": text})

    # 紹介文とクレジット
    intro, credits = "", []
    for rownum, cells in intro_rows[1:]:
        label = cs.to_text(cells.get(0))
        value = cs.to_text(cells.get(1))
        if not label and not value:
            continue
        if label == INTRO_LABEL:
            intro = value
        elif label and value:
            credits.append({"label": label, "value": value})
        elif label or value:
            warnings.append(f"「{INTRO_SHEET}」シート {rownum}行目: 項目と内容の片方だけが書かれています（両方書くか、行ごと消してください）")

    lines = [
        "// このファイルは tools/convert_biography.py が 経歴.xlsx から自動生成します。",
        "// 直接編集せず、Excel を直してから変換スクリプトを実行してください。",
        f"// 生成日時: {datetime.datetime.now():%Y-%m-%d %H:%M}  件数: {len(history)}",
        "window.BIOGRAPHY = {",
        f"  \"intro\": {json.dumps(intro, ensure_ascii=False)},",
        f"  \"credits\": {json.dumps(credits, ensure_ascii=False)},",
        "  \"history\": [",
    ]
    for rec in history:
        lines.append("    " + json.dumps(rec, ensure_ascii=False) + ",")
    lines.append("  ]")
    lines.append("};")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, args.out)

    print(f"完了: 年表 {len(history)} 件を書き出しました → {os.path.relpath(args.out, ROOT)}")
    print(f"      記入例の行を {skipped_sample} 件、空の行を {skipped_empty} 件スキップしました。")
    if intro_rows:
        print(f"      紹介文{'あり' if intro else 'なし'}、クレジット {len(credits)} 件を読み込みました。")
    else:
        print(f"      「{INTRO_SHEET}」シートが無いので、紹介文とクレジットは空にしました。")
    if warnings:
        print("注意（取り込みは済んでいますが、Excel の確認をおすすめします）:")
        for w in warnings:
            print("  - " + w)


if __name__ == "__main__":
    main()
