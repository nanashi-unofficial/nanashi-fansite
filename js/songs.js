/* 歌唱リスト
   - data/songs.js の window.SONGS を表示
   - 曲名・アーティストの部分一致検索、種類 × 形式の絞り込み
   - 並び順: 新しい順（既定）／五十音順
   - 1 ページ 50 件でページ分け（検索・絞り込み・並び替えをすると 1 ページ目に戻る）
   - アーティスト名ボタン: そのアーティストの行だけに絞る（コラボ表記「A & B」「A with B」なども含む）。検索欄を打ち直すと解除
   - スマホで検索キー（Enter）を押すとキーボードを閉じる
*/
(function () {
  var table = document.getElementById("song-table");
  if (!table) return;

  var PAGE_SIZE = 50; // 1 ページに表示する件数

  var tbody = table.querySelector("tbody");
  var input = document.getElementById("song-search");
  var countEl = document.getElementById("song-count");
  var sortSel = document.getElementById("song-sort");
  var emptyEl = document.getElementById("song-empty");
  var toolbar = document.querySelector(".toolbar");
  var groups = document.querySelectorAll("[data-filter]");
  var pagers = document.querySelectorAll("[data-pager]");

  var state = { q: "", artist: "", kind: "", format: "", sort: "new", page: 1 };  // artist はアーティスト名ボタンで選んだ名前（完全一致）
  var current = []; // 絞り込み・並び替え後の全行

  // 検索用に文字をそろえる: 全角→半角、大文字→小文字、カタカナ→ひらがな、空白と記号を除去
  function norm(s) {
    return String(s || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
      .replace(/[\s\p{P}\p{S}]+/gu, "");
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // コラボ表記（「米津玄師 & 宇多田ヒカル」「CHiCO with HoneyWorks」「DAOKO × 米津玄師」など）を個々の名前にも分けておく
  function splitArtists(a) {
    return [a].concat(a.split(/\s*[&×／]\s*|\s+(?:with|feat\.?|for)\s+/i)).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  var collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
  var songs = (Array.isArray(window.SONGS) ? window.SONGS : []).map(function (s, i) {
    return {
      title: s.title || "", artist: s.artist || "", kind: s.kind || "", format: s.format || "",
      date: s.date || "", url: s.url || "", yomi: s.yomi || "", order: i,
      artists: splitArtists(s.artist || ""),
      key: norm(s.yomi || s.title),
      search: norm([s.title, s.artist, s.yomi].join(" "))
    };
  });

  function byKana(a, b) {
    return collator.compare(a.key, b.key) || a.date.localeCompare(b.date) || a.order - b.order;
  }
  function byNew(a, b) {
    return b.date.localeCompare(a.date) || a.order - b.order;  // 同じ日は Excel の行順（歌った順）
  }

  function pageCount() {
    return Math.max(1, Math.ceil(current.length / PAGE_SIZE));
  }

  function renderRows(rows) {
    tbody.textContent = "";
    rows.forEach(function (s) {
      var tr = el("tr");
      tr.appendChild(el("td", "title", s.title));
      var ar = el("td", "artist");
      if (s.artist) {
        var ab = el("button", "artist-btn", s.artist);
        ab.type = "button";
        ab.title = "このアーティストで絞り込む";
        ab.addEventListener("click", function () {
          input.value = s.artist;                   // 何で絞っているか検索欄にも見せる
          state.q = ""; state.artist = s.artist;    // 部分一致ではなく、このアーティストの行だけにする
          apply();
          var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          (toolbar || table).scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
          countEl.focus({ preventScroll: true });   // 押したボタンは表の作り直しで消えるので、件数表示へフォーカスを移す
        });
        ar.appendChild(ab);
      }
      tr.appendChild(ar);
      var k = el("td", "kind"); if (s.kind) k.appendChild(el("span", "tag", s.kind)); tr.appendChild(k);
      var f = el("td", "format"); if (s.format) f.appendChild(el("span", "tag is-format", s.format)); tr.appendChild(f);
      tr.appendChild(el("td", "date", s.date.replace(/-/g, ".")));
      var l = el("td", "link");
      if (s.url) {
        var a = el("a", "link-watch");
        a.href = s.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.setAttribute("aria-label", s.title + " のアーカイブを新しいタブで開く");
        a.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';
        a.appendChild(document.createTextNode("視聴する"));
        l.appendChild(a);
      }
      tr.appendChild(l);
      tbody.appendChild(tr);
    });
  }

  // 表示するページ番号の並び（多い時は … で省略）: 先頭・末尾・現在の前後 1 ページ
  function pageItems(cur, total) {
    var items = [], last = 0;
    for (var p = 1; p <= total; p++) {
      if (p === 1 || p === total || Math.abs(p - cur) <= 1 || total <= (window.innerWidth <= 480 ? 4 : 7)) {
        if (last && p - last > 1) items.push("…");
        items.push(p);
        last = p;
      }
    }
    return items;
  }

  function renderPagers() {
    var total = pageCount();
    pagers.forEach(function (nav) {
      nav.textContent = "";
      nav.hidden = total <= 1;
      if (total <= 1) return;
      function btn(label, page, opts) {
        var b = el("button", "pager-btn" + (opts && opts.cls ? " " + opts.cls : ""), label);
        b.type = "button";
        if (opts && opts.aria) b.setAttribute("aria-label", opts.aria);
        if (opts && opts.current) b.setAttribute("aria-current", "page");
        if (opts && opts.disabled) b.disabled = true;
        b.addEventListener("click", function () { goPage(page); });
        nav.appendChild(b);
      }
      btn("前へ", state.page - 1, { cls: "is-step", aria: "前のページへ", disabled: state.page <= 1 });
      pageItems(state.page, total).forEach(function (it) {
        if (it === "…") nav.appendChild(el("span", "pager-gap", "…"));
        else btn(String(it), it, { aria: it + " ページ目", current: it === state.page });
      });
      btn("次へ", state.page + 1, { cls: "is-step", aria: "次のページへ", disabled: state.page >= total });
    });
  }

  function renderPage() {
    var total = current.length;
    state.page = Math.min(Math.max(1, state.page), pageCount());
    var start = (state.page - 1) * PAGE_SIZE;
    var rows = current.slice(start, start + PAGE_SIZE);
    renderRows(rows);
    emptyEl.hidden = total > 0;
    table.hidden = total === 0;

    var filtered = state.q || state.artist || state.kind || state.format;
    var text;
    if (total === 0) text = "0 件";
    else if (total <= PAGE_SIZE) text = total + " 件";
    else text = (start + 1) + "–" + (start + rows.length) + " 件 / " + (filtered ? "該当 " : "全 ") + total + " 件";
    if (filtered) text += "（全 " + songs.length + " 件中）";
    countEl.textContent = text;
    renderPagers();
  }

  function goPage(n) {
    state.page = n;
    renderPage();
    // スマホでは上側のページ送りが CSS で非表示なので、見えているページ送り（offsetParent が null なら display:none）を基準にする
    var shown = Array.prototype.filter.call(pagers, function (p) { return p.offsetParent !== null; });
    var cur = shown[0] && shown[0].querySelector('[aria-current="page"]');
    if (cur) cur.focus({ preventScroll: true });
    // 一覧の先頭が画面の上に隠れていたら戻る（上側のページ送りが無い画面では表の先頭へ）
    var top = shown[0] && shown[0].classList.contains("pager--top") ? shown[0] : table;
    if (top && top.getBoundingClientRect().top < 0) {
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      top.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
  }

  // 絞り込み・検索・並び替えの結果を作り直し、1 ページ目から表示する
  function apply() {
    current = songs.filter(function (s) {
      if (state.kind && s.kind !== state.kind) return false;
      if (state.format && s.format !== state.format) return false;
      if (state.artist && s.artists.indexOf(state.artist) === -1) return false;
      if (state.q && s.search.indexOf(state.q) === -1) return false;
      return true;
    });
    current.sort(state.sort === "new" ? byNew : byKana);
    state.page = 1;
    renderPage();
  }

  // 絞り込みボタン
  groups.forEach(function (group) {
    var name = group.getAttribute("data-filter");
    var chips = group.querySelectorAll(".chip");
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        // 選択中のボタンをもう一度押したら解除（「すべて」に戻す）
        var already = chip.getAttribute("aria-pressed") === "true" && chip.getAttribute("data-value");
        var target = already ? group.querySelector('.chip[data-value=""]') || chip : chip;
        chips.forEach(function (c) { c.setAttribute("aria-pressed", c === target ? "true" : "false"); });
        state[name] = target.getAttribute("data-value") || "";
        apply();
      });
    });
  });

  input.addEventListener("input", function () {
    state.artist = "";   // 検索欄を打ち直したら、アーティスト名ボタンの絞り込みは解除して部分一致に戻す
    state.q = norm(input.value);
    apply();
  });
  // スマホで検索キー（Enter）を押したらキーボードを閉じて結果を見せる
  // （日本語入力の「変換確定」の Enter では閉じない: isComposing / keyCode 229 が変換中の印）
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) input.blur();
  });
  sortSel.addEventListener("change", function () {
    state.sort = sortSel.value;
    apply();
  });
  function resetAll() {
    input.value = "";
    state.q = ""; state.artist = ""; state.kind = ""; state.format = "";
    groups.forEach(function (group) {
      group.querySelectorAll(".chip").forEach(function (c) {
        c.setAttribute("aria-pressed", c.getAttribute("data-value") ? "false" : "true");
      });
    });
    apply();
    input.focus();
  }
  // 「条件をクリア」はツールバーと、0 件のときの案内文の 2 か所にある
  document.querySelectorAll("#song-reset, [data-reset]").forEach(function (b) { b.addEventListener("click", resetAll); });

  // 再読み込み時にブラウザが残した選択値があれば、それに合わせる
  if (sortSel.value === "kana" || sortSel.value === "new") state.sort = sortSel.value;

  // 最終更新日（data/songs.js の生成時に書き込まれる）
  var updatedEl = document.getElementById("song-updated");
  if (updatedEl && window.SONGS_UPDATED) updatedEl.textContent = "最終更新 " + String(window.SONGS_UPDATED).replace(/-/g, ".");

  // データファイル（data/songs.js）が読めなかった時は、検索 0 件と区別できる文言にする
  if (!songs.length) emptyEl.textContent = "歌唱リストを読み込めませんでした。時間をおいて再読み込みしてください。";

  apply();
})();
