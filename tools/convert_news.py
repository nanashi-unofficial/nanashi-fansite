#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NEWS.xlsx → data/news.js 変換スクリプト

使い方（このフォルダで実行）:
    python3 tools/convert_news.py

  ・追加のライブラリは不要です（Mac に最初から入っている Python 3 だけで動きます）。
  ・「NEWS」シートの 1 行目を見出しとして読み、2 行目以降を取り込みます。
  ・記入例の行（ID が sample か、見出しが「（記入例）」で始まる行）と、見出しも詳細も空の行は除外します。
  ・ID が空の記事には、サイト側と同じ規則で news-日付 の ID を付けます（同じ日付が複数なら -2, -3 …）。
  ・日付が今日より先の記事もそのまま表示されます（年の打ち間違いに気付けるよう、変換時に注意だけ出します）。
  ・G 列「メモ」はサイトには出しません。
  ・リンクURL とリンクの文言は、セル内で改行すると複数のボタンになります（上から順に対応）。
  ・行は上が古い順（新しい記事は一番下）。順番が違ってもサイト側で日付の新しい順に並べ替えます。

オプション:
    python3 tools/convert_news.py 別の場所/NEWS.xlsx      # 入力ファイルを指定
    python3 tools/convert_news.py --out data/news.js     # 出力先を指定
"""
import argparse
import datetime
import json
import os
import re
import sys

# Excel の読み込みは歌唱リストの変換スクリプトと共通
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import convert_songs as cs

SHEET_NAME = "NEWS"
HEADERS = ["日付", "見出し", "詳細", "リンクURL", "リンクの文言", "ID"]
KEYS = ["date", "title", "detail", "url", "urlLabel", "id"]
SAMPLE_ID = "sample"   # 記入例の行の ID（この行はサイトに出さない）
SAMPLE_PREFIX = "（記入例）"   # 見出しがこれで始まる行も記入例として除外（経歴の変換と同じ目印）
ACTIVITY_START = datetime.date(2025, 10, 10)   # YouTube チャンネル開設日。これより前の日付は打ち間違いの可能性が高い
ROOT = cs.ROOT


def main():
    ap = argparse.ArgumentParser(description="NEWS.xlsx を data/news.js に変換します")
    ap.add_argument("xlsx", nargs="?", default=os.path.join(ROOT, "NEWS.xlsx"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "news.js"))
    args = ap.parse_args()

    with cs.open_xlsx(args.xlsx) as z:
        shared = cs.load_shared_strings(z)
        sheet_path, date1904 = cs.find_sheet_path(z, SHEET_NAME)
        rows = cs.read_rows(z, sheet_path, shared)

    if not rows:
        sys.exit("エラー: シートが空です。")

    # 見出し行のチェック
    header_row = rows[0][1]
    headers = [cs.to_text(header_row.get(i)) for i in range(len(HEADERS))]
    if headers != HEADERS:
        sys.exit(
            "エラー: 1行目の見出しが想定と違います。\n"
            f"  想定: {HEADERS}\n  実際: {headers}\n"
            "  見出しの文字・順番を元に戻してから、もう一度実行してください。"
        )

    news, warnings, seen, auto = [], [], {}, {}
    skipped_sample = skipped_empty = 0
    today = datetime.date.today()
    prev = None   # 1 つ前の行の日付（順番の確認用）
    for rownum, cells in rows[1:]:
        rec = {k: cs.to_text(cells.get(i)) for i, k in enumerate(KEYS)}
        rec["date"] = cs.to_date(cells.get(KEYS.index("date")), date1904)
        # リンクは 1 行 1 件（セル内改行で複数）。文言も同じ行数で対応させる
        urls = [cs.clean_url(u.strip()) for u in rec["url"].split("\n") if u.strip()]
        labels = [l.strip() for l in rec["urlLabel"].split("\n") if l.strip()]
        rec["url"] = urls[0] if urls else ""
        rec["urlLabel"] = labels[0] if labels else ""
        rec["links"] = [{"url": u, "label": (labels[i] if i < len(labels) else "")} for i, u in enumerate(urls)] if len(urls) > 1 else None
        if not any(rec.values()):
            continue  # 書式だけ入っている空の行は数えない
        if rec["id"].lower() == SAMPLE_ID or rec["title"].startswith(SAMPLE_PREFIX):
            skipped_sample += 1
            continue
        if not rec["title"] and not rec["detail"]:
            skipped_empty += 1
            continue
        # 値の軽いチェック（間違いがあっても取り込みは続けます）
        if not rec["title"]:
            warnings.append(f"{rownum}行目: 見出しが空です")
        if not rec["date"]:
            warnings.append(f"{rownum}行目: 日付が空です（一覧の末尾に回ります）")
        elif not re.match(r"^\d{4}-\d{2}-\d{2}$", rec["date"]):
            warnings.append(f"{rownum}行目: 日付「{rec['date']}」を日付として読めませんでした")
        else:
            d = datetime.date.fromisoformat(rec["date"])
            if d > today:
                warnings.append(f"{rownum}行目: 日付 {rec['date']} は今日より先です（予定の記事ならそのままで構いません。月日だけ入力すると Excel は今年の年を付けるので、前年の出来事は年も入れてください）")
            elif d < ACTIVITY_START:
                warnings.append(f"{rownum}行目: 日付 {rec['date']} が活動開始（{ACTIVITY_START}）より前です（年の打ち間違いではありませんか）")
            if prev and d < prev:
                warnings.append(f"{rownum}行目: 日付 {rec['date']} が前の行（{prev}）より古いです（表示は日付順に並ぶので問題ありませんが、年の打ち間違いなら直してください）")
            prev = d
        if not rec["id"]:
            # ID が空なら、サイト側（js/news.js）と同じ規則で付ける: news-日付。同じ日付が複数なら -2, -3 …
            base = "news-" + (rec["date"] or "undated")
            auto[base] = auto.get(base, 0) + 1
            rec["id"] = base + (f"-{auto[base]}" if auto[base] > 1 else "")
            warnings.append(f"{rownum}行目: ID が空なので {rec['id']} を付けました（スライドや X で共有する記事には、Excel の ID 列に固定の名前を書いてください）")
        if rec["id"]:
            if not re.match(r"^[A-Za-z0-9-]+$", rec["id"]):
                warnings.append(f"{rownum}行目: ID「{rec['id']}」は半角英数字とハイフン以外を含んでいます")
            if rec["id"] in seen:
                warnings.append(f"{rownum}行目: ID「{rec['id']}」が {seen[rec['id']]}行目と重複しています（後の記事のリンクが開けません）")
            seen.setdefault(rec["id"], rownum)
        for u in urls:
            if not re.match(r"^(https?://|\./|/|#)", u):
                warnings.append(f"{rownum}行目: リンクURL「{u}」が http から始まっていません（サイト内のページは ./biography.html のように書きます）")
        if labels and not urls:
            warnings.append(f"{rownum}行目: リンクの文言だけがあり、リンクURL が空です")
        if urls and labels and len(labels) != len(urls):
            warnings.append(f"{rownum}行目: リンクURL が {len(urls)} 件に対して、リンクの文言が {len(labels)} 件です（行数をそろえてください。URL か文言のどちらかの貼り忘れでは？）")
        # 空の項目は書き出さない
        out = {k: rec[k] for k in ["id", "date", "title", "detail"] if rec[k]}
        if rec["links"]:
            out["links"] = rec["links"]
        else:
            out.update({k: rec[k] for k in ["url", "urlLabel"] if rec[k]})
        news.append(out)

    lines = [
        "// このファイルは tools/convert_news.py が NEWS.xlsx から自動生成します。",
        "// 直接編集せず、Excel を直してから変換スクリプトを実行してください。",
        f"// 生成日時: {datetime.datetime.now():%Y-%m-%d %H:%M}  件数: {len(news)}",
        "window.NEWS = [",
    ]
    for rec in news:
        lines.append("  " + json.dumps(rec, ensure_ascii=False) + ",")
    lines.append("];")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, args.out)

    print(f"完了: {len(news)} 件を書き出しました → {os.path.relpath(args.out, ROOT)}")
    print(f"      記入例の行を {skipped_sample} 件、空の行を {skipped_empty} 件スキップしました。")
    if warnings:
        print("注意（取り込みは済んでいますが、Excel の確認をおすすめします）:")
        for w in warnings:
            print("  - " + w)


if __name__ == "__main__":
    main()
