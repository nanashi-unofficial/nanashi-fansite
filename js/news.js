/* NEWS
   - data/news.js の window.NEWS を日付の新しい順に並べて表示
   - 一覧: <ul data-news-list data-limit="5"> なら 5 件まで（トップページ用）
           <ul data-news-list data-page-size="10"> なら 10 件ずつページ分け（NEWS ページ用。URL の ?page=2 で 2 ページ目）
   - 詳細: <article data-news-detail> があるページでは、URL の ?id=記事ID の記事を表示
*/
(function () {
  var lists = document.querySelectorAll("[data-news-list]");
  var detailBox = document.querySelector("[data-news-detail]");
  if (!lists.length && !detailBox) return;

  function toISO(d) {
    var m = String(d || "").match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!m) return "";
    return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  }
  function fmtDate(n) {
    return n.iso ? n.iso.replace(/-/g, ".") : String(n.date || "");
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function isExternal(url) {
    return /^https?:\/\//i.test(String(url || ""));
  }

  var items = (Array.isArray(window.NEWS) ? window.NEWS : [])
    .filter(function (n) { return n && n.title; })
    .map(function (n, i) {
      return { id: n.id, date: n.date, title: n.title, body: n.body, detail: n.detail, url: n.url, urlLabel: n.urlLabel, links: n.links, iso: toISO(n.date), order: i };
    })
    .sort(function (a, b) {
      return b.iso.localeCompare(a.iso) || a.order - b.order;
    });

  // 各記事に固定の ID を付ける。data/news.js に id があればそれを使い、無ければ news-日付（同じ日付が複数ある時は -2, -3 …）
  var used = {};
  items.forEach(function (n) {
    if (n.id) { used[n.id] = 1; return; }
    var base = "news-" + (n.iso || "undated");
    used[base] = (used[base] || 0) + 1;
    n.id = used[base] > 1 ? base + "-" + used[base] : base;
  });

  function detailHref(n) {
    return "news-detail.html?id=" + encodeURIComponent(n.id);
  }

  // ---------- 一覧 ----------
  // 1 件につき日付と見出しだけを出し、行のどこを押しても詳細ページが開く（本文は詳細ページと共有カードの説明文に使う）
  function renderItem(n, headingTag) {
    var li = el("li", "news-item");
    li.id = n.id;
    var link = el("a", "news-item-link");
    link.href = detailHref(n);
    var time = el("time", "news-date", fmtDate(n));
    if (n.iso) time.dateTime = n.iso;
    link.appendChild(time);
    link.appendChild(el(headingTag || "h3", "news-title", n.title));
    var arrow = el("span", "news-arrow", "→");
    arrow.setAttribute("aria-hidden", "true");
    link.appendChild(arrow);
    li.appendChild(link);
    return li;
  }

  // 表示するページ番号の並び（多い時は … で省略）: 先頭・末尾・現在の前後 1 ページ
  function pageItems(cur, total) {
    var out = [], last = 0;
    for (var p = 1; p <= total; p++) {
      if (p === 1 || p === total || Math.abs(p - cur) <= 1 || total <= (window.innerWidth <= 480 ? 4 : 7)) {
        if (last && p - last > 1) out.push("…");
        out.push(p);
        last = p;
      }
    }
    return out;
  }

  function fillList(list, rows) {
    var headingTag = list.getAttribute("data-heading") || "h3";
    list.textContent = "";
    if (!rows.length) {
      list.appendChild(el("li", "news-empty", "お知らせはまだありません。"));
      return;
    }
    rows.forEach(function (n) { list.appendChild(renderItem(n, headingTag)); });
  }

  lists.forEach(function (list) {
    var limit = parseInt(list.getAttribute("data-limit"), 10);
    var pageSize = parseInt(list.getAttribute("data-page-size"), 10);

    // トップページなど: 先頭から limit 件だけ
    if (!(pageSize > 0)) {
      fillList(list, limit > 0 ? items.slice(0, limit) : items);
      return;
    }

    // NEWS ページ: pageSize 件ずつページ分け
    var pagers = document.querySelectorAll("[data-news-pager]");
    var total = Math.max(1, Math.ceil(items.length / pageSize));
    var page = parseInt(new URLSearchParams(location.search).get("page"), 10) || 1;
    page = Math.min(Math.max(1, page), total);

    function renderPagers() {
      pagers.forEach(function (nav) {
        nav.textContent = "";
        nav.hidden = total <= 1;
        if (total <= 1) return;
        function btn(label, to, opts) {
          var b = el("button", "pager-btn" + (opts.cls ? " " + opts.cls : ""), label);
          b.type = "button";
          if (opts.aria) b.setAttribute("aria-label", opts.aria);
          if (opts.current) b.setAttribute("aria-current", "page");
          if (opts.disabled) b.disabled = true;
          b.addEventListener("click", function () { goPage(to); });
          nav.appendChild(b);
        }
        btn("前へ", page - 1, { cls: "is-step", aria: "前のページへ", disabled: page <= 1 });
        pageItems(page, total).forEach(function (it) {
          if (it === "…") nav.appendChild(el("span", "pager-gap", "…"));
          else btn(String(it), it, { aria: it + " ページ目", current: it === page });
        });
        btn("次へ", page + 1, { cls: "is-step", aria: "次のページへ", disabled: page >= total });
      });
    }
    function show() {
      var start = (page - 1) * pageSize;
      fillList(list, items.slice(start, start + pageSize));
      renderPagers();
    }
    function goPage(n) {
      page = Math.min(Math.max(1, n), total);
      show();
      var cur = pagers[0] && pagers[0].querySelector('[aria-current="page"]');
      if (cur) cur.focus({ preventScroll: true });
      // URL に ?page=番号 を残す（戻るボタンや共有で同じページが開く）。開けない環境では何もしない
      try {
        var u = new URL(location.href);
        if (page > 1) u.searchParams.set("page", page); else u.searchParams.delete("page");
        history.replaceState(null, "", u);
      } catch (e) {}
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      list.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
    show();
  });

  // ---------- 詳細 ----------
  // 本文のルール: 空行で段落 / ■ で始まる行は小見出し / ・ で始まる行は箇条書き / ＜ ＞の行は項目名
  function renderDetailText(text, box) {
    String(text || "").split(/\n\s*\n/).forEach(function (block) {
      var lines = block.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      if (!lines.length) return;
      var para = null, list = null;
      lines.forEach(function (line) {
        if (/^■/.test(line)) {
          box.appendChild(el("h2", "detail-heading", line.replace(/^■\s*/, "")));
          para = null; list = null;
        } else if (/^[・•]/.test(line)) {
          if (!list) { list = el("ul", "detail-list"); box.appendChild(list); para = null; }
          list.appendChild(el("li", null, line.replace(/^[・•]\s*/, "")));
        } else if (/^＜.+＞$/.test(line)) {
          box.appendChild(el("p", "detail-label", line.replace(/^＜|＞$/g, "")));
          para = null; list = null;
        } else {
          if (!para) { para = el("p", "detail-text"); box.appendChild(para); list = null; }
          else para.appendChild(document.createElement("br"));
          para.appendChild(document.createTextNode(line));
        }
      });
    });
  }

  if (detailBox) {
    // NEWS の 2 ページ目以降から来た時は「← NEWS 一覧へ」で同じページに戻れるよう ?page= を引き継ぐ
    try {
      var ref = new URL(document.referrer);
      if (ref.origin === location.origin && /news\.html$/.test(ref.pathname) && ref.search) {
        document.querySelectorAll(".detail-back a").forEach(function (a) { a.href = "./news.html" + ref.search; });
      }
    } catch (e) {}
    var id = new URLSearchParams(location.search).get("id");
    var n = null;
    items.forEach(function (x) { if (x.id === id) n = x; });
    var head = detailBox.querySelector(".detail-head");
    var body = detailBox.querySelector(".detail-body");
    if (!n) {
      head.appendChild(el("h1", "detail-title", "記事が見つかりませんでした"));
      body.appendChild(el("p", "detail-text", "リンクが古いか、記事が削除された可能性があります。NEWS 一覧からお探しください。"));
      document.title = "記事が見つかりませんでした | NEWS | ななし律歌 FAN SITE";
      var robots = document.createElement("meta");  // 検索エンジンに「記事なし」のページを登録させない
      robots.name = "robots"; robots.content = "noindex";
      document.head.appendChild(robots);
      return;
    }
    document.title = n.title + " | NEWS | ななし律歌 FAN SITE";
    // 検索結果に出る説明文（meta description）: 本文（旧形式）か、詳細の最初の段落（■ や ＜ ＞の行を除く）
    // （X や LINE のカードは JavaScript を実行しないので、全記事共通の文になる）
    var first = String(n.detail || "").split(/\n\s*\n/).map(function (b) {
      return b.split("\n").filter(function (l) { return l.trim() && !/^[■＜]/.test(l.trim()); }).join(" ");
    }).filter(Boolean)[0] || "";
    var desc = (n.body || first).replace(/\s+/g, " ").trim().slice(0, 120) || n.title;
    [["meta[name=description]", desc], ["meta[property='og:title']", document.title], ["meta[property='og:description']", desc]].forEach(function (pair) {
      var m = document.querySelector(pair[0]);
      if (m) m.setAttribute("content", pair[1]);
    });
    // この記事の正式な URL（?id= 付き）を canonical と og:url に入れる（file:// で開いた時は何もしない）
    if (/^https?:$/.test(location.protocol)) {
      var self = location.origin + location.pathname + "?id=" + encodeURIComponent(n.id);
      var canon = document.querySelector("link[rel=canonical]");
      if (canon) canon.href = self;
      var ogUrl = document.querySelector("meta[property='og:url']");
      if (ogUrl) ogUrl.setAttribute("content", self);
    }
    var time = el("time", "detail-date", fmtDate(n));
    if (n.iso) time.dateTime = n.iso;
    head.appendChild(time);
    head.appendChild(el("h1", "detail-title", n.title));
    renderDetailText(n.detail || n.body, body);
    // リンクボタン: links（複数）か url（1 件）
    var links = Array.isArray(n.links) && n.links.length ? n.links : (n.url ? [{ url: n.url, label: n.urlLabel }] : []);
    if (links.length) {
      var p = el("p", "detail-link");
      links.forEach(function (l) {
        if (!l || !l.url) return;
        var a = el("a", "btn-more", l.label || "関連リンク");
        a.href = l.url;
        if (isExternal(l.url)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
        p.appendChild(a);
      });
      body.appendChild(p);
    }
  }

  // ページ内リンク（#news-2026-09-11 など）で開かれた時、描画後にその位置へ移動する
  if (lists.length && location.hash) {
    var target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
  }
})();
