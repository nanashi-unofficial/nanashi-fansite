/* アクセス解析（Google アナリティクス 4）
   - MEASUREMENT_ID に GA4 の測定 ID（G- で始まる文字列）を入れると有効になる。空のままなら何もしない
   - 公開サイト（SITE_HOST）で開いた時だけ記録する。PC で直接開いた時や手元の確認では数えない
   - window.trackSongClick(曲データ, 置き場所): 歌唱リストの「視聴する」が押されたことを曲ごとに記録する
     （GA4 では「song_link_click」というイベントとして見える。README「アクセス解析」参照）
*/
(function () {
  var MEASUREMENT_ID = "G-ZKPSBF0K83";  // 空 "" にすると記録を止める
  var SITE_HOST = "nanashi-unofficial.github.io";

  window.trackSongClick = function () {};  // 無効の時は何もしない
  if (!MEASUREMENT_ID || location.hostname !== SITE_HOST) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID);

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + MEASUREMENT_ID;
  document.head.appendChild(s);

  window.trackSongClick = function (song, place) {
    gtag("event", "song_link_click", {
      song_title: song.title,
      song_artist: song.artist || "",
      song_date: song.date,
      song_kind: song.kind || "",
      song_format: song.format || "",
      link_place: place  // "歌唱リスト" か "トップ"
    });
  };
})();
