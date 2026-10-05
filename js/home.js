/* トップページ: 最近歌った曲
   - data/songs.js の window.SONGS から新しい順に data-limit 件を表示（同じ日は Excel の行順）
*/
(function () {
  var list = document.querySelector("[data-recent-songs]");
  if (!list) return;
  var limit = parseInt(list.getAttribute("data-limit"), 10) || 5;
  var songs = (Array.isArray(window.SONGS) ? window.SONGS : []).map(function (s, i) {
    return { title: s.title || "", artist: s.artist || "", kind: s.kind || "", format: s.format || "", date: s.date || "", url: s.url || "", order: i };
  });
  songs.sort(function (a, b) { return b.date.localeCompare(a.date) || a.order - b.order; });
  var rows = songs.slice(0, limit);

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  if (!rows.length) {
    list.closest("section").hidden = true;
    return;
  }
  rows.forEach(function (s) {
    var li = el("li", "recent-item");
    var time = el("time", "recent-date", s.date.replace(/-/g, "."));
    if (s.date) time.dateTime = s.date;
    li.appendChild(time);
    var main = el("div", "recent-main");
    var line = el("div");
    line.appendChild(el("span", "recent-title", s.title));
    if (s.artist) line.appendChild(el("span", "recent-artist", s.artist));
    main.appendChild(line);
    var tags = el("div", "recent-tags");
    if (s.kind) tags.appendChild(el("span", "tag", s.kind));
    if (s.format) tags.appendChild(el("span", "tag is-format", s.format));
    if (tags.childNodes.length) main.appendChild(tags);
    li.appendChild(main);
    if (s.url) {
      var a = el("a", "link-watch");
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", s.title + " のアーカイブを新しいタブで開く");
      a.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';
      a.appendChild(document.createTextNode("視聴する"));
      li.appendChild(a);
    }
    list.appendChild(li);
  });
})();
