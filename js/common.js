/* 全ページ共通の動き
   - ページ上部へ戻るボタン: 少しスクロールしたら表示し、クリックで先頭へ戻る
*/
(function () {
  var btn = document.getElementById("to-top");
  if (!btn) return;
  var SHOW_AFTER = 300; // これ以上スクロールしたら表示（px）
  var ticking = false;

  function update() {
    ticking = false;
    var show = (window.pageYOffset || document.documentElement.scrollTop) > SHOW_AFTER;
    btn.classList.toggle("is-visible", show);
  }
  window.addEventListener("scroll", function () {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(update);
    }
  }, { passive: true });

  btn.addEventListener("click", function () {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });

  update();
})();
