/* 注目情報スライド
   - data/slides.js の window.SLIDES を読んで表示
   - 5秒ごとに自動で次へ（最後→先頭へループ）
   - マウスを乗せている間・キーボード操作中は停止、離すと再開
   - スワイプ非対応。左右の矢印とドットは常に表示
   - until（任意）を過ぎたスライドは表示しない
   - OS の「視差効果を減らす」設定では自動送りをしない
   - ドット行の右端の ❙❙ ボタンで自動送りを止められる（もう一度押すと再開）
   - キーボードでスライド内のリンクにフォーカスしたまま ← → で送ると、フォーカスも新しいスライドへ移る
*/
(function () {
  var root = document.getElementById("featured-slider");
  if (!root) return;

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function toISO(s) {
    var m = String(s || "").match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2) : "";
  }
  var today = todayISO();
  var slides = (Array.isArray(window.SLIDES) ? window.SLIDES : []).filter(function (s) {
    if (!s || !s.title) return false;
    var until = toISO(s.until);
    return !until || until >= today;  // 期限切れのスライドは出さない
  });
  if (!slides.length) {
    root.closest(".featured").hidden = true;
    return;
  }

  var INTERVAL = 5000;
  var YT_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function ytId(url) {
    var m = String(url || "").match(YT_RE);
    return m ? m[1] : null;
  }
  function isExternal(url) {
    return /^https?:\/\//i.test(String(url || ""));
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var viewport = root.querySelector(".slider-viewport");
  var track = root.querySelector(".slider-track");
  var dotsBox = root.querySelector(".slider-dots");
  var prevBtn = root.querySelector(".slider-arrow.prev");
  var nextBtn = root.querySelector(".slider-arrow.next");
  var slideEls = [];

  slides.forEach(function (s, i) {
    var slide = el("div", "slide");
    slide.setAttribute("role", "group");
    slide.setAttribute("aria-roledescription", "スライド");
    slide.setAttribute("aria-label", slides.length + "枚中" + (i + 1) + "枚目");

    // リンク先が無いスライドはリンクにしない
    var a = el(s.url ? "a" : "div", "slide-link");
    if (s.url) {
      a.href = s.url;
      if (isExternal(s.url)) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
    }

    var media = el("div", "slide-media");
    var id = ytId(s.url);
    var isShort = /youtube\.com\/shorts\//.test(String(s.url || ""));
    var src = s.image || (id ? "https://i.ytimg.com/vi/" + id + "/maxresdefault.jpg" : "");
    if (src) {
      var img = el("img");
      img.alt = "";
      img.loading = "eager";          // 3枚だけなので最初から読み込む（戻った時に空パネルを見せない）
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      if (i === 0) img.fetchPriority = "high";
      if (!s.image && id) {
        // 高解像度サムネイルが無い動画は標準サイズに切り替える
        var fallback = function () {
          if (img.dataset.fb) return;
          img.dataset.fb = "1";
          // 前面と、ショート用のぼかし背景（複製）の両方を標準サイズに差し替える
          media.querySelectorAll("img").forEach(function (x) {
            x.src = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
          });
        };
        img.addEventListener("error", fallback);
        img.addEventListener("load", function () {
          if (img.naturalWidth && img.naturalWidth <= 120) fallback();
        });
      }
      img.src = src;
      if (isShort && !s.image) {
        // 縦動画のサムネイルは左右に帯が出るので、ぼかした背景の上に重ねる
        media.classList.add("is-vertical");
        var bg = img.cloneNode(false);
        bg.className = "slide-bg";
        bg.alt = "";
        media.appendChild(bg);
      }
      media.appendChild(img);
    } else {
      media.classList.add("is-text");
      media.textContent = s.label || "お知らせ";
      media.setAttribute("aria-hidden", "true");  // 下の slide-label と同じ語なので読み上げから外す
    }

    var body = el("div", "slide-body");
    var meta = el("div", "slide-meta");
    if (s.label) meta.appendChild(el("span", "slide-label", s.label));
    if (s.date) meta.appendChild(el("span", "slide-date", s.date));
    if (meta.childNodes.length) body.appendChild(meta);
    body.appendChild(el("h3", "slide-title", s.title));
    if (s.url) body.appendChild(el("span", "slide-cta", id ? "YouTube で見る" : isExternal(s.url) ? "サイトを開く" : "詳しく見る"));

    a.appendChild(media);
    a.appendChild(body);
    slide.appendChild(a);
    track.appendChild(slide);
    slideEls.push(slide);
  });

  var count = slides.length;
  var index = 0;
  var timer = null;
  var hovered = false;
  var pauseBtn = root.querySelector(".slider-pause");
  var paused = reduceMotion;  // 一時停止ボタンの状態。「視差効果を減らす」設定の人は最初から止めておく

  var dots = slides.map(function (_, i) {
    var b = el("button");
    b.type = "button";
    b.setAttribute("aria-label", (i + 1) + "枚目のスライドへ");
    b.addEventListener("click", function () {
      go(i);
      restart();
    });
    dotsBox.appendChild(b);
    return b;
  });

  function setInert(slide, off) {
    // 表示中以外のスライドは Tab やスクリーンリーダーの対象から外す
    if (off) {
      slide.setAttribute("inert", "");
      slide.setAttribute("aria-hidden", "true");
    } else {
      slide.removeAttribute("inert");
      slide.removeAttribute("aria-hidden");
    }
    slide.querySelectorAll("a, button").forEach(function (x) {
      if (off) x.setAttribute("tabindex", "-1"); else x.removeAttribute("tabindex");
    });
  }

  function go(n) {
    var hadFocus = track.contains(document.activeElement);  // スライド内のリンクにフォーカスがあれば、送った後に引き継ぐ
    index = ((n % count) + count) % count;
    track.style.transform = "translateX(-" + index * 100 + "%)";
    dots.forEach(function (d, i) {
      if (i === index) d.setAttribute("aria-current", "true");
      else d.removeAttribute("aria-current");
    });
    slideEls.forEach(function (s, i) { setInert(s, i !== index); });
    if (hadFocus) {
      // 元のスライドは inert になってフォーカスを保てないので、新しいスライドのリンク（無ければドット）へ移す
      var target = slideEls[index].querySelector("a") || dots[index];
      if (target) target.focus({ preventScroll: true });
    }
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }
  function start() {
    stop();
    if (count > 1 && !document.hidden && !paused) {
      timer = setInterval(function () { go(index + 1); }, INTERVAL);
    }
  }
  function keyboardFocusInside() {
    // キーボードで枠内にフォーカスしている間だけ止める（マウスでボタンを押してフォーカスが残っているだけなら動かす）
    try { return !!root.querySelector(":focus-visible"); } catch (e) { return root.contains(document.activeElement); }
  }
  function restart() {
    if (!hovered && !keyboardFocusInside()) start();
  }
  function setPaused(on) {
    paused = on;
    if (pauseBtn) {
      pauseBtn.classList.toggle("is-paused", on);
      pauseBtn.setAttribute("aria-label", on ? "自動送りを再開する" : "自動送りを止める");
      pauseBtn.title = on ? "自動送りを再開する" : "自動送りを止める";
    }
    if (on) stop(); else restart();
  }
  if (pauseBtn) {
    pauseBtn.addEventListener("click", function () { setPaused(!paused); });
    if (count <= 1) pauseBtn.hidden = true;
  }

  if (count <= 1) {
    prevBtn.hidden = true;
    nextBtn.hidden = true;
    dotsBox.hidden = true;
  }

  prevBtn.addEventListener("click", function () { go(index - 1); restart(); });
  nextBtn.addEventListener("click", function () { go(index + 1); restart(); });

  root.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { go(index - 1); restart(); }
    if (e.key === "ArrowRight") { go(index + 1); restart(); }
  });

  // マウスが使える端末だけ「乗せている間は停止」を有効にする
  if (window.matchMedia && window.matchMedia("(hover: hover)").matches) {
    root.addEventListener("mouseenter", function () { hovered = true; stop(); });
    root.addEventListener("mouseleave", function () { hovered = false; restart(); });
  }
  // キーボード操作中も止める。枠内のフォーカス移動で勝手にスクロールしないようにする
  root.addEventListener("focusin", function () { stop(); if (viewport) viewport.scrollLeft = 0; });
  root.addEventListener("focusout", function (e) {
    if (!root.contains(e.relatedTarget)) start();
  });
  // 別タブを見ている間は止め、戻ってきたら再開
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else restart();
  });

  setPaused(paused);
  go(0);
  start();
})();
