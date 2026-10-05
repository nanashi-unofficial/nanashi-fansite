/* 経歴
   - data/biography.js の window.BIOGRAPHY を表示
   - history を日付の古い順に並べ、年ごとに見出しを付けて表示する
*/
(function () {
  var root = document.getElementById("biography");
  var b = window.BIOGRAPHY;
  if (!root || !b) return;
  var box = root.querySelector(".bio");
  if (!box) return;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function toISO(d) {
    var m = String(d || "").match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!m) return "";
    return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  }
  // 2025-10-10 → 10月10日
  function fmtDate(iso) {
    var p = iso.split("-");
    return Number(p[1]) + "月" + Number(p[2]) + "日";
  }

  // 紹介文（\n で改行）
  if (b.intro) {
    var intro = el("p", "bio-intro");
    String(b.intro).split("\n").forEach(function (line, i) {
      if (i) intro.appendChild(el("br"));
      intro.appendChild(document.createTextNode(line));
    });
    box.appendChild(intro);
  }

  // クレジットなどの小さな一覧（任意）
  if (b.credits && b.credits.length) {
    var dl = el("dl", "bio-credits");
    b.credits.forEach(function (c) {
      if (!c || !c.label) return;
      var d = el("div");
      d.appendChild(el("dt", null, c.label));
      d.appendChild(el("dd", null, c.value || ""));
      dl.appendChild(d);
    });
    if (dl.childNodes.length) box.appendChild(dl);
  }

  // 年表：日付の古い順（同じ日付は書いた順）。日付が読めない行は最後にまとめる
  var items = (Array.isArray(b.history) ? b.history : [])
    .filter(function (h) { return h && h.text; })
    .map(function (h, i) { return { iso: toISO(h.date), raw: h.date, text: h.text, order: i }; })
    .sort(function (x, y) {
      return (x.iso || "9999").localeCompare(y.iso || "9999") || x.order - y.order;
    });

  if (!items.length) {
    box.appendChild(el("p", "bio-empty", "準備中です。"));
    return;
  }

  var lists = {};
  items.forEach(function (it) {
    var year = it.iso ? it.iso.slice(0, 4) : "";
    if (!lists[year]) {
      var sec = el("section", "bio-year");
      if (year) sec.appendChild(el("h2", "bio-year-title", year + "年"));
      lists[year] = el("ul", "bio-list");
      sec.appendChild(lists[year]);
      box.appendChild(sec);
    }
    var li = el("li", "bio-item");
    var time = el("time", "bio-date", it.iso ? fmtDate(it.iso) : String(it.raw || ""));
    if (it.iso) time.dateTime = it.iso;
    li.appendChild(time);
    li.appendChild(el("p", "bio-text", it.text));
    lists[year].appendChild(li);
  });
})();
