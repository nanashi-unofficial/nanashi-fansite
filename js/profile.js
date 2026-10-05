/* プロフィール
   - data/profile.js の window.PROFILE を表示
*/
(function () {
  var root = document.getElementById("profile");
  var p = window.PROFILE;
  if (!root || !p) return;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function ext(a) { a.target = "_blank"; a.rel = "noopener noreferrer"; return a; }

  // 画像
  var fig = root.querySelector(".profile-visual");
  if (fig) {
    if (p.image) {
      var img = el("img");
      img.src = p.image;
      img.alt = p.name || "";
      img.decoding = "async";
      // 寸法を先に伝えて、読み込み中に本文がずれないようにする
      img.width = p.imageWidth || 900;
      img.height = p.imageHeight || 1200;
      fig.appendChild(img);
    } else {
      fig.hidden = true;
      root.querySelector(".profile").classList.add("is-text-only");
    }
  }

  // 名前・紹介文
  var body = root.querySelector(".profile-body");
  var kana = [p.reading, p.english].filter(Boolean).join(" / ");
  if (kana) body.appendChild(el("p", "profile-kana", kana));
  body.appendChild(el("h2", "profile-name", p.name || ""));
  if (p.intro) body.appendChild(el("p", "profile-intro", p.intro));
  // 紹介文: data/profile.js に bio があればそれ、無ければ経歴ページの紹介文（経歴.xlsx の「紹介文」シート）を流用する
  var bio = p.bio || (window.BIOGRAPHY && window.BIOGRAPHY.intro) || "";
  if (bio) {
    var bioEl = el("p", "profile-bio");
    String(bio).split("\n").forEach(function (line, i) {
      if (i) bioEl.appendChild(el("br"));
      bioEl.appendChild(document.createTextNode(line));
    });
    body.appendChild(bioEl);
  }

  // 基本情報
  if (p.facts && p.facts.length) {
    var dl = el("dl", "profile-facts");
    p.facts.forEach(function (f) {
      var box = el("div");
      box.appendChild(el("dt", null, f.label));
      box.appendChild(el("dd", null, f.value));
      dl.appendChild(box);
    });
    body.appendChild(dl);
  }

  // ハッシュタグ
  if (p.tags && p.tags.length) {
    body.appendChild(el("h3", "profile-sub", "ハッシュタグ"));
    var ul = el("ul", "tag-list");
    p.tags.forEach(function (t) {
      var li = el("li");
      li.appendChild(el("span", "tag-use", t.use));
      if (/^#/.test(t.tag)) {
        var a = ext(el("a", "tag-link", t.tag));
        a.href = "https://x.com/hashtag/" + encodeURIComponent(t.tag.slice(1)) + "?src=hashtag_click";
        a.setAttribute("aria-label", t.tag + " を X で検索（新しいタブ）");
        li.appendChild(a);
      } else {
        li.appendChild(el("span", "tag-plain", t.tag));
      }
      ul.appendChild(li);
    });
    body.appendChild(ul);
    var note = el("p", "profile-note");
    if (p.tagNote) note.appendChild(document.createTextNode(p.tagNote + " "));
    if (p.tagSource) {
      var src = ext(el("a", null, "出典：ご本人のポスト"));
      src.href = p.tagSource;
      note.appendChild(src);
    }
    if (note.childNodes.length) body.appendChild(note);
  }

  // 公式リンク
  if (p.links && p.links.length) {
    body.appendChild(el("h3", "profile-sub", "公式リンク"));
    var links = el("ul", "profile-links");
    p.links.forEach(function (l) {
      var li = el("li");
      var a = ext(el("a"));
      a.href = l.url;
      a.appendChild(el("span", "label", l.label));
      if (l.handle) a.appendChild(el("span", "handle", l.handle));
      li.appendChild(a);
      links.appendChild(li);
    });
    body.appendChild(links);
  }
})();
