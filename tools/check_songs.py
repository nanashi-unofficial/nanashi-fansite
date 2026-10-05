#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
歌唱リスト.xlsx の整合性チェック

使い方（このフォルダで実行）:
    python3 tools/check_songs.py            # Excel の中身だけを確認（ネット不要）
    python3 tools/check_songs.py --online   # さらに YouTube と突き合わせる（動画の存在・タイトル・公開日）

確認する内容
  ・空欄、種類／形式の値、日付の形式と範囲
  ・アーカイブURL の形式、同じ動画（歌枠は同じ時間指定）の重複、形式（Short／動画／歌枠）と URL の食い違い
  ・曲名・アーティスト名の表記ゆれ（空白や大文字小文字だけが違うもの。曲名は同じアーティストの中で比べる）
  ・同じアーティスト・同じよみで曲名の字が違うもの（異体字「籠／篭」や誤字）
  ・Excel のフィルター（▼）の範囲に「よみ」列が入っているか
  ・漢字で始まる曲名に「よみ」が無いもの
  ・--online: 動画が公開されているか、投稿者がご本人のチャンネルか、動画タイトルに曲名が含まれるか、公開日と歌った日のずれ
"""
import argparse, datetime, json, os, re, sys, unicodedata, zipfile
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import convert_songs as cs

CHANNEL = "ななし律歌"
ACTIVITY_START = datetime.date(2025, 10, 10)   # YouTube チャンネル開設日
YT_RE = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})")


def norm(s):
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)
    return re.sub(r"[\s\W_]+", "", s)


# 同じ曲名でアーティストが違うが、別の曲だと確認済みのもの（毎回「要確認」に出ないようにする。元の表記のまま書けばよい）
SAME_TITLE_OK = {norm(x) for x in ("プロポーズ", "声", "ダーリン", "ORION")}


def load_rows(xlsx):
    with cs.open_xlsx(xlsx) as z:
        shared = cs.load_shared_strings(z)
        path, date1904 = cs.find_sheet_path(z, cs.SHEET_NAME)
        rows = cs.read_rows(z, path, shared)
        autofilter = ET.fromstring(z.read(path)).find("m:autoFilter", cs.NS)   # Excel のフィルター（▼）の範囲
    if not rows:
        sys.exit("エラー: シートが空です。")
    header = rows[0][1]
    cs.check_headers([cs.to_text(header.get(i)) for i in range(6)])
    yomi_col = next((i for i, v in header.items() if i >= 6 and cs.to_text(v) in cs.YOMI_HEADERS), None)
    if autofilter is not None and yomi_col is not None:
        last = cs.col_index(autofilter.get("ref").split(":")[-1])
        if last < yomi_col:
            print(f"注意: Excel のフィルター（▼）の範囲が {chr(65 + last)} 列までで、「よみ」列（{chr(65 + yomi_col)} 列）が入っていません。"
                  "▼で並べ替えると「よみ」が別の曲にずれるので、A1 から「よみ」列まで選んでフィルターを付け直してください。")
    out = []
    for rownum, cells in rows[1:]:
        rec = {k: cs.to_text(cells.get(i)) for i, k in enumerate(cs.KEYS)}
        rec["date"] = cs.to_date(cells.get(4), date1904)
        rec["yomi"] = cs.to_text(cells.get(yomi_col)) if yomi_col is not None else ""
        rec["row"] = rownum
        if not any(rec[k] for k in ("title", "artist", "url")):
            continue
        if cs.SAMPLE_MARK in rec["url"]:
            continue
        out.append(rec)
    # 同じ曲名の別の行に「よみ」があれば引き継ぐ（変換スクリプトと同じ扱い）
    known = {}
    for r in out:
        if r["yomi"]:
            known.setdefault(r["title"], r["yomi"])
    for r in out:
        if not r["yomi"] and r["title"] in known:
            r["yomi"] = known[r["title"]]
    return out


def offline_checks(rows, today):
    issues = []
    add = lambda cat, msg: issues.append((cat, msg))
    by_id = {}
    for r in rows:
        tag = f"{r['row']}行目「{r['title']}」"
        for k, name in (("title", "曲名"), ("artist", "アーティスト"), ("kind", "種類"), ("format", "形式"), ("date", "歌った日"), ("url", "アーカイブURL")):
            if not r[k]:
                add("空欄", f"{tag}: {name} が空です")
        if r["kind"] and r["kind"] not in cs.KINDS:
            add("値", f"{tag}: 種類「{r['kind']}」が選択肢にありません")
        if r["format"] and r["format"] not in cs.FORMATS:
            add("値", f"{tag}: 形式「{r['format']}」が選択肢にありません")
        if r["date"]:
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", r["date"]):
                add("日付", f"{tag}: 歌った日「{r['date']}」を日付として読めません")
            else:
                d = datetime.date.fromisoformat(r["date"])
                if d > today:
                    add("日付", f"{tag}: 歌った日 {r['date']} が未来の日付です")
                elif d < ACTIVITY_START:
                    add("日付", f"{tag}: 歌った日 {r['date']} が活動開始（{ACTIVITY_START}）より前です（年の打ち間違い？）")
        if r["url"]:
            m = YT_RE.search(r["url"])
            if not r["url"].startswith("http"):
                add("URL", f"{tag}: URL が http から始まっていません")
            elif not m:
                add("URL", f"{tag}: YouTube の動画 URL として読めません: {r['url']}")
            else:
                vid = m.group(1)
                r["vid"] = vid
                # 歌枠は 1 本のアーカイブに時間指定（t=）で複数曲が入るので、動画 ID と時間の組で重複を見る
                tm = re.search(r"[?&#]t=(\d+)", r["url"])
                by_id.setdefault((vid, tm.group(1) if tm else ""), []).append(r)
                if r["format"] == "歌枠" and not tm:
                    add("URL", f"{tag}: 歌枠ですが URL に時間指定（&t=秒数）がありません")
                is_short = "/shorts/" in r["url"]
                if r["format"] == "Short" and not is_short:
                    add("形式とURL", f"{tag}: 形式が Short ですが URL がショート動画の形ではありません")
                if r["format"] in ("動画", "歌枠") and is_short:
                    add("形式とURL", f"{tag}: 形式が {r['format']} ですが URL がショート動画（/shorts/）です")
        if r["title"] and re.match(r"[一-鿿]", r["title"]) and not r["yomi"]:
            add("よみ", f"{tag}: 漢字で始まる曲名ですが「よみ」が空です")
        if r["yomi"] and not re.fullmatch(r"[ぁ-ゟー]+", r["yomi"]):
            add("よみ", f"{tag}: よみ「{r['yomi']}」にひらがな以外の文字が入っています")
    for key, rs in by_id.items():
        if len(rs) > 1:
            add("重複", "同じ動画（同じ時間指定）が複数行にあります: " + " / ".join(f"{r['row']}行目「{r['title']}」({r['date']})" for r in rs))
    # 表記ゆれ（曲名は同じアーティストの中で比べる。別アーティストの同名曲 ORION／orion などを誤って拾わないため）
    for key, name in (("title", "曲名"), ("artist", "アーティスト")):
        groups = {}
        for r in rows:
            if r[key]:
                g = (norm(r["artist"]), norm(r[key])) if key == "title" else norm(r[key])
                groups.setdefault(g, set()).add(r[key])
        for variants in groups.values():
            if len(variants) > 1:
                add("表記ゆれ", f"{name}の表記が揃っていません: " + " ／ ".join(sorted(variants)))
    # 同じアーティスト・同じよみなのに曲名の字が違う（異体字「籠／篭」や誤字「花／歌」など。NFKC の正規化では揃わない）
    by_yomi = {}
    for r in rows:
        if r["yomi"]:
            by_yomi.setdefault((norm(r["artist"]), r["yomi"]), set()).add(r["title"])
    for (_, y), titles in by_yomi.items():
        if len(titles) > 1:
            add("表記ゆれ", f"同じよみ「{y}」で曲名の字が違います: " + " ／ ".join(sorted(titles)))
    # 同じ曲名で別アーティスト（確認済みの別曲 SAME_TITLE_OK は除く）
    ta = {}
    for r in rows:
        ta.setdefault(norm(r["title"]), set()).add(r["artist"])
    for t, artists in ta.items():
        if len(artists) > 1 and t not in SAME_TITLE_OK:
            add("要確認", f"同じ曲名でアーティストが違います「{t}」: " + " ／ ".join(sorted(artists)))
    return issues


def fetch(url, timeout=20):
    req = Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "ja"})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def check_video(vid):
    info = {"vid": vid}
    try:
        d = json.loads(fetch(f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json"))
        info["title"], info["author"], info["status"] = d.get("title", ""), d.get("author_name", ""), "ok"
    except HTTPError as e:
        info["status"] = {401: "非公開", 403: "埋め込み不可", 404: "存在しない"}.get(e.code, f"HTTP {e.code}")
        return info
    except (URLError, TimeoutError, ValueError) as e:
        info["status"] = f"取得失敗 ({e.__class__.__name__})"
        return info
    try:
        html = fetch(f"https://www.youtube.com/watch?v={vid}")
        m = re.search(r'"uploadDate":"([^"]+)"', html)
        if m:
            dt = datetime.datetime.fromisoformat(m.group(1))
            jst = dt.astimezone(datetime.timezone(datetime.timedelta(hours=9)))
            info["upload"] = jst.date().isoformat()
    except Exception as e:  # 公開日は取れなくても続行
        info["upload_err"] = e.__class__.__name__
    return info


def online_checks(rows):
    issues = []
    vids = sorted({r["vid"] for r in rows if r.get("vid")})
    print(f"YouTube に問い合わせ中… {len(vids)} 本")
    with ThreadPoolExecutor(max_workers=6) as ex:
        results = {i["vid"]: i for i in ex.map(check_video, vids)}
    missing_upload = 0
    for r in rows:
        if not r.get("vid"):
            continue
        info = results[r["vid"]]
        tag = f"{r['row']}行目「{r['title']}」"
        if info["status"] != "ok":
            issues.append(("動画", f"{tag}: 動画が見られません（{info['status']}）"))
            continue
        if CHANNEL not in info["author"]:
            issues.append(("動画", f"{tag}: 投稿者が「{info['author']}」です（ご本人のチャンネルではない可能性）"))
        vt = norm(info["title"])
        if r["format"] != "歌枠" and norm(r["title"]) not in vt:  # 歌枠の配信タイトルには曲名が入らないので省く
            issues.append(("動画タイトル", f"{tag}: 動画タイトル「{info['title']}」に曲名が含まれていません（リンク先違い？）"))
        if "upload" in info and r["date"] and re.match(r"^\d{4}-\d{2}-\d{2}$", r["date"]):
            diff = abs((datetime.date.fromisoformat(info["upload"]) - datetime.date.fromisoformat(r["date"])).days)
            if diff > 1:
                issues.append(("公開日", f"{tag}: 歌った日 {r['date']} と YouTube の公開日 {info['upload']} が {diff} 日ずれています"))
        elif "upload" not in info:
            missing_upload += 1
    if missing_upload:
        print(f"（公開日を取得できなかった動画: {missing_upload} 本）")
    return issues


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx", nargs="?", default=os.path.join(cs.ROOT, "歌唱リスト.xlsx"))
    ap.add_argument("--online", action="store_true", help="YouTube と突き合わせる")
    args = ap.parse_args()
    rows = load_rows(args.xlsx)
    print(f"対象: {len(rows)} 行")
    issues = offline_checks(rows, datetime.date.today())
    if args.online:
        issues += online_checks(rows)
    if not issues:
        print("問題は見つかりませんでした。")
        return
    cats = {}
    for cat, msg in issues:
        cats.setdefault(cat, []).append(msg)
    print(f"見つかった項目: {len(issues)} 件")
    for cat, msgs in cats.items():
        print(f"\n[{cat}] {len(msgs)} 件")
        for m in msgs:
            print("  - " + m)


if __name__ == "__main__":
    main()
