/* 리서치 데스크 — data/*.json을 읽어 각 섹션을 그린다. (모바일 퍼스트) */
(function () {
  "use strict";

  var SOURCES = {
    daily: "data/daily.json",
    archive: "data/archive.json",
    insights: "data/insights.json",
    trends: "data/trends.json"
  };
  var HOT_LIKES = 1000;
  var SVG_NS = "http://www.w3.org/2000/svg";

  function $(id) { return document.getElementById(id); }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function safeURL(url) {
    return /^https?:\/\//i.test(url || "") ? url : "#";
  }

  function formatNumber(n) {
    return typeof n === "number" ? n.toLocaleString("ko-KR") : "—";
  }

  // 오프셋을 보존한 채 표시한다 (브라우저 시간대로 바꾸지 않음).
  function formatStamp(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:?\d{2})?)?/.exec(iso || "");
    if (!m) return iso ? String(iso) : "—";
    var text = m[1] + "년 " + Number(m[2]) + "월 " + Number(m[3]) + "일";
    if (m[4]) text += " " + m[4] + ":" + m[5];
    if (m[6]) text += m[6] === "+09:00" || m[6] === "+0900" ? " KST" : " (UTC" + (m[6] === "Z" ? "" : m[6]) + ")";
    return text;
  }

  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? Number(m[2]) + "월 " + Number(m[3]) + "일" : "";
  }

  // 형광펜: 텍스트당 최대 한 곳. 따옴표로 인용된 첫 구절만.
  function highlightQuote(text) {
    var raw = String(text || "");
    var m = /["“]([^"”]{4,80})["”]/.exec(raw);
    if (!m) return escapeHTML(raw);
    var start = m.index, end = start + m[0].length;
    return escapeHTML(raw.slice(0, start)) + "<mark>" + escapeHTML(m[0]) + "</mark>" + escapeHTML(raw.slice(end));
  }

  // "제목 — 부제" 형태를 헤드라인과 덱으로 나눈다.
  function splitTitle(title) {
    var parts = String(title || "").split(/\s+[—–]\s+/);
    return { head: parts[0], deck: parts.slice(1).join(" — ") };
  }

  function fetchJSON(path) {
    return fetch(path, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error(path + " 응답 " + res.status);
      return res.json();
    });
  }

  function showFailure(el, label) {
    var tag = el.tagName === "OL" || el.tagName === "UL" ? "li" : "p";
    el.innerHTML = "<" + tag + ' class="empty">' + escapeHTML(label) +
      " 데이터를 불러오지 못했습니다. 로컬 서버(<code>python3 -m http.server</code>)로 열어 주세요.</" + tag + ">";
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function pickLead(items) {
    var lead = items[0];
    items.forEach(function (it) {
      if ((it.likes || 0) > (lead.likes || 0)) lead = it;
    });
    return lead;
  }

  /* ───────── 마스트헤드 ───────── */
  function renderUpdated(daily, trends) {
    var iso = (daily && daily.updatedAt) || (trends && trends.updated) || "";
    var time = $("updated-at");
    time.textContent = formatStamp(iso);
    if (iso) time.setAttribute("datetime", iso);
  }

  /* ───────── 오늘의 최대 화제 ───────── */
  function renderFront(lead) {
    var t = splitTitle(lead.title);
    var url = escapeHTML(safeURL(lead.url));
    var share = shareHTML(lead, "front");
    rememberItems([lead]);
    $("front-body").innerHTML =
      '<article class="lead"' + categoryStyle(lead.category) + ">" +
        mediaHTML(lead) +
        '<p class="lead__kicker">오늘의 최대 화제 · ' + escapeHTML(lead.category) + "</p>" +
        '<h3 class="lead__headline"><a href="' + url + '" target="_blank" rel="noopener noreferrer">' +
          escapeHTML(t.head) + "</a></h3>" +
        (t.deck ? '<p class="lead__deck">' + escapeHTML(t.deck) + "</p>" : "") +
        '<p class="report__meta">' + metaHTML(lead) + "</p>" +
        '<p class="lead__summary">' + highlightQuote(lead.summary) + "</p>" +
        insightHTML(lead.insight) +
        '<div class="report__actions">' + likeButtonHTML(lead) + saveButtonHTML(lead) + share.button + '<a class="source-link" href="' + url +
          '" target="_blank" rel="noopener noreferrer">원문 보기 ↗</a></div>' +
        share.panel +
      "</article>";
    setupMedia($("front-body"));
    requestLikeCounts($("front-body"));
  }

  /* ───────── 리포트 카드 ───────── */
  function metaHTML(it, withCategory) {
    var bits = [];
    // 주간 베스트: 순위와 이번 주 좋아요 수
    if (it.rank) bits.push('<span class="rank-badge">' + it.rank + "위</span><span>이번 주 ♥ " + formatNumber(it.weekLikes) + "</span>");
    if (withCategory && it.category) bits.push('<span class="chip">' + escapeHTML(it.category) + "</span>");
    if (it.author && it.author !== "@?") bits.push("<span>" + escapeHTML(it.author) + "</span>");
    if (it.likes) {
      bits.push("<span>♥ " + formatNumber(it.likes) + "</span>" +
        (it.likes >= HOT_LIKES ? '<span class="hot">HOT</span>' : ""));
    }
    if (it.source) bits.push("<span>" + escapeHTML(it.source) + "</span>");
    if (it.archivedAt) bits.push('<time datetime="' + escapeHTML(it.archivedAt) + '">' + escapeHTML(shortDate(it.archivedAt)) + " 보관</time>");
    if (it.savedAt) bits.push('<time datetime="' + escapeHTML(it.savedAt) + '">' + escapeHTML(shortDate(it.savedAt)) + " 저장</time>");
    return bits.join('<span aria-hidden="true">·</span>');
  }

  // 인사이트 코멘트 — 본문과 다른 색의 별도 박스
  function insightHTML(text, marked) {
    if (!text) return "";
    return '<aside class="insight-box" aria-label="인사이트 코멘트">' +
      '<span class="insight-box__label">💡 인사이트</span>' +
      '<p class="insight-box__text">' + (marked || escapeHTML(text)) + "</p></aside>";
  }

  // 북마크 이름 변경: customTitle이 있으면 그걸 보여 준다.
  function displayTitle(it) {
    var c = it && typeof it.customTitle === "string" ? it.customTitle.trim() : "";
    return c || (it && it.title) || "";
  }

  // 검색 하이라이트와 함께 표시용 제목을 그린다.
  function titleHTML(it, mark) {
    var t = displayTitle(it);
    if (!mark) return escapeHTML(t);
    if (t === it.title) return mark(it, "title");
    // 바꾼 이름에는 검색어를 직접 하이라이트한다.
    return markRanges(t, matchRanges(t, queryTerms(String(reportView.query || "").trim()), null));
  }

  // mark(item, field)가 주어지면 검색어 형광펜으로 그린다.
  function renderReports(items, mark) {
    var list = $("report-list");
    $("reports-count").textContent = items.length + "건";
    if (!items.length) {
      list.innerHTML = '<li class="empty">' + emptyListHTML() + "</li>";
      return;
    }
    rememberItems(items);
    list.innerHTML = items.map(function (it, i) {
      var url = escapeHTML(safeURL(it.url));
      var id = "report-" + i;
      var share = shareHTML(it, id);
      var comments = commentsHTML(it, id);
      return '<li class="report' + (mediaOf(it).length ? " report--media" : "") + '" id="' + id + '" data-item="' + itemKey(it) + '"' + categoryStyle(it.category) + "><article>" +
          mediaHTML(it) +
          '<p class="report__meta">' + metaHTML(it, true) + "</p>" +
          '<h3 class="report__title">' + titleHTML(it, mark) + "</h3>" +
          tagsHTML(it) +
          '<p class="report__summary">' + (mark ? mark(it, "summary") : highlightQuote(it.summary)) + "</p>" +
          insightHTML(it.insight, mark && it.insight ? mark(it, "insight") : "") +
          detailToggleHTML(it, id) +
          '<div class="report__actions">' +
            '<button type="button" class="fold-toggle" aria-expanded="false" aria-controls="' + id + '" hidden>' +
              '<span class="fold-toggle__label">더보기</span><span class="visually-hidden"> — ' + escapeHTML(it.title) + "</span></button>" +
            likeButtonHTML(it) +
            saveButtonHTML(it) +
            renameButtonHTML(it) +
            share.button +
            comments.button +
            '<a class="source-link" href="' + url + '" target="_blank" rel="noopener noreferrer">원문 ↗<span class="visually-hidden"> — ' +
              escapeHTML(it.title) + "</span></a>" +
          "</div>" +
          share.panel +
          comments.panel +
        "</article></li>";
    }).join("");
    each(list.querySelectorAll(".fold-toggle"), function (btn) {
      btn.addEventListener("click", function () { toggleFold(btn); });
    });
    each(list.querySelectorAll(".detail-toggle"), function (btn) {
      btn.addEventListener("click", function () { toggleDetail(btn, items[Number(btn.getAttribute("data-index"))]); });
    });
    setupMedia(list);
    measureFolds(list);
    requestLikeCounts(list);
  }

  /* ───────── 미디어 (사진·영상 썸네일) ───────── */
  // 미디어는 archive.json에만 있다. 오늘의 리포트·북마크 항목은 같은 URL의 아카이브 항목에서 찾는다.
  var mediaByURL = new Map();

  function cleanMedia(list) {
    return (Array.isArray(list) ? list : []).filter(function (m) {
      return m && /^https:\/\//i.test(m.url || "") && /^(photo|video|animated_gif)$/.test(m.type);
    });
  }

  function indexMedia(items) {
    items.forEach(function (it) {
      var key = bookmarkKey(it.url);
      var media = cleanMedia(it.media);
      if (key && media.length) mediaByURL.set(key, media);
    });
  }

  function mediaOf(it) {
    var own = cleanMedia(it.media);
    return own.length ? own : (mediaByURL.get(bookmarkKey(it.url)) || []);
  }

  // pbs.twimg.com 사진은 name= 파라미터로 크기를 고를 수 있다.
  function photoURL(url, size) {
    var m = /^(https:\/\/pbs\.twimg\.com\/media\/[^?#.]+)\.(jpg|jpeg|png|webp)$/i.exec(url);
    return m ? m[1] + "?format=" + m[2].toLowerCase() + "&name=" + size : url;
  }

  function mediaRatio(m, single) {
    var r = m.width > 0 && m.height > 0 ? m.width / m.height : 16 / 9;
    // 한 장이면 원래 비율(너무 길거나 납작하지 않게), 여러 장이면 같은 비율로 맞춘다.
    return single ? Math.min(1.91, Math.max(0.8, r)) : 4 / 3;
  }

  function mediaSlideHTML(m, i, total, title) {
    var label = (total > 1 ? (i + 1) + "/" + total + " " : "");
    var ratio = 'style="aspect-ratio:' + mediaRatio(m, total === 1).toFixed(3) + '"';
    if (m.type === "photo") {
      return '<div class="media__slide" ' + ratio + ">" +
        '<a class="media__open" href="' + escapeHTML(photoURL(m.url, "large")) + '" target="_blank" rel="noopener noreferrer" data-photo>' +
          '<img class="media__img" src="' + escapeHTML(photoURL(m.url, "small")) + '"' +
            ' srcset="' + escapeHTML(photoURL(m.url, "small")) + " 680w, " + escapeHTML(photoURL(m.url, "medium")) + ' 1200w"' +
            ' sizes="(min-width: 900px) 840px, 100vw" loading="lazy" decoding="async" alt="">' +
          '<span class="visually-hidden">' + label + "사진 크게 보기 — " + escapeHTML(title) + "</span></a></div>";
    }
    var gif = m.type === "animated_gif";
    return '<div class="media__slide" ' + ratio + ">" +
      '<button type="button" class="media__open media__open--video" data-video="' + escapeHTML(m.url) + '"' + (gif ? " data-gif" : "") + ">" +
        '<video class="media__img" muted playsinline preload="none" data-src="' + escapeHTML(m.url) + '#t=0.1" aria-hidden="true"></video>' +
        '<span class="media__play" aria-hidden="true"></span>' +
        (gif ? '<span class="media__tag" aria-hidden="true">GIF</span>' : "") +
        '<span class="visually-hidden">' + label + (gif ? "GIF" : "영상") + " 재생 — " + escapeHTML(title) + "</span></button></div>";
  }

  function mediaHTML(it) {
    var media = mediaOf(it);
    if (!media.length) return "";
    var multi = media.length > 1;
    return '<div class="media' + (multi ? " media--multi" : "") + '">' +
      '<div class="media__track"' + (multi ? ' tabindex="0" role="group" aria-label="미디어 ' + media.length + '개 — 옆으로 넘겨 보기"' : "") + ">" +
        media.map(function (m, i) { return mediaSlideHTML(m, i, media.length, it.title); }).join("") +
      "</div>" +
      (multi ? '<span class="media__count" aria-hidden="true">1 / ' + media.length + "</span>" : "") +
    "</div>";
  }

  // 영상 첫 프레임은 화면 가까이 왔을 때만 불러온다(이미지 lazy loading과 같은 효과).
  var videoObserver = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      videoObserver.unobserve(e.target);
      loadVideoThumb(e.target);
    });
  }, { rootMargin: "300px 0px" }) : null;

  function loadVideoThumb(video) {
    var src = video.getAttribute("data-src");
    if (!src || video.getAttribute("src")) return;
    video.preload = "metadata";
    video.src = src;
  }

  function setupMedia(root) {
    each(root.querySelectorAll("video[data-src]"), function (v) {
      if (videoObserver) videoObserver.observe(v); else loadVideoThumb(v);
    });
    each(root.querySelectorAll(".media--multi .media__track"), function (track) {
      track.addEventListener("scroll", function () { updateMediaCount(track.parentNode); }, { passive: true });
    });
  }

  function visibleSlides(media) {
    return Array.prototype.filter.call(media.querySelectorAll(".media__slide"), function (s) { return !s.hidden; });
  }

  function updateMediaCount(media) {
    var badge = media.querySelector(".media__count");
    if (!badge) return;
    var slides = visibleSlides(media);
    var track = media.querySelector(".media__track");
    var step = slides.length > 1 ? slides[1].offsetLeft - slides[0].offsetLeft : 1;
    var at = Math.min(slides.length, Math.round(track.scrollLeft / (step || 1)) + 1);
    badge.textContent = at + " / " + slides.length;
    badge.hidden = slides.length < 2;
  }

  // 불러오기 실패: 깨진 아이콘 대신 그 칸을 조용히 숨기고, 전부 실패하면 미디어 영역을 숨긴다.
  function hideBrokenMedia(el) {
    var slide = el.closest && el.closest(".media__slide");
    if (!slide) return;
    slide.hidden = true;
    var media = slide.closest(".media");
    if (!visibleSlides(media).length) media.hidden = true;
    else {
      media.classList.toggle("media--multi", visibleSlides(media).length > 1);
      updateMediaCount(media);
    }
  }

  document.addEventListener("error", function (e) {
    var t = e.target;
    if (t && (t.tagName === "IMG" || t.tagName === "VIDEO")) hideBrokenMedia(t);
  }, true);

  // 클릭: 영상은 그 자리에서 재생, 사진은 라이트박스(지원 안 되면 새 탭 링크로 동작)
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".media__open--video");
    if (btn) { playInline(btn); return; }
    var link = e.target.closest && e.target.closest("a[data-photo]");
    if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && openLightbox(link)) e.preventDefault();
  });

  function playInline(btn) {
    var gif = btn.hasAttribute("data-gif");
    var video = document.createElement("video");
    video.className = "media__img media__player";
    video.src = btn.getAttribute("data-video");
    video.controls = !gif;
    video.autoplay = true;
    video.loop = gif;
    video.muted = gif;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    btn.parentNode.replaceChild(video, btn);
    var p = video.play();
    if (p && p.catch) p.catch(function () { /* 자동 재생이 막히면 컨트롤로 직접 재생 */ });
    video.focus();
  }

  var lightbox = null;
  function openLightbox(link) {
    if (typeof HTMLDialogElement !== "function") return false;
    if (!lightbox) {
      lightbox = document.createElement("dialog");
      lightbox.className = "lightbox";
      lightbox.setAttribute("aria-label", "사진 크게 보기");
      lightbox.innerHTML = '<button type="button" class="lightbox__close" aria-label="닫기">×</button>' +
        '<img class="lightbox__img" alt="">' +
        '<a class="lightbox__orig" target="_blank" rel="noopener noreferrer">원본 새 탭에서 열기 ↗</a>';
      document.body.appendChild(lightbox);
      lightbox.addEventListener("click", function (e) {
        if (e.target === lightbox || e.target.closest(".lightbox__close")) lightbox.close();
      });
      lightbox.addEventListener("close", function () {
        document.body.classList.remove("chat-lock");
        lightbox.querySelector(".lightbox__img").removeAttribute("src");
        if (lightbox._from) lightbox._from.focus();
      });
    }
    lightbox._from = link;
    lightbox.querySelector(".lightbox__img").src = link.href;
    lightbox.querySelector(".lightbox__orig").href = link.href;
    lightbox.showModal();
    document.body.classList.add("chat-lock");
    lightbox.querySelector(".lightbox__close").focus();
    return true;
  }

  /* ───────── 분류 색상 ───────── */
  var CATEGORY_COLORS = {
    "AI 코딩·에이전트": "#2754C5", "AI 코딩": "#2754C5",
    "AI 에이전트·자동화": "#0B8A6F",
    "AI 미디어 생성": "#D02F6B",
    "디자인·크리에이티브": "#D9530B",
    "AI 학습·인사이트": "#2B8A3E",
    "커리어·비즈니스": "#8E33AE",
    "개발·기술 일반": "#4652C7",
    "트레이딩·재테크": "#A87B00",
    "Jev": "#6A3FD9",
    "Grok Bot": "#0B6E80",
    "기타": "#6C727A"
  };
  var CATEGORY_FALLBACK = ["#B5384B", "#2C7A9B", "#7A5C00", "#5B4BC4", "#2F7D4F", "#A6461F"];

  function categoryColor(name) {
    if (!name) return "";
    if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return CATEGORY_FALLBACK[h % CATEGORY_FALLBACK.length];
  }

  function categoryStyle(name) {
    var c = categoryColor(name);
    return c ? ' style="--cat:' + c + '"' : "";
  }

  /* ───────── 상세 분석 (카드 안에서 펼침) ───────── */
  // 상세 분석은 archive.json에만 있다. 오늘의 리포트·북마크 항목은 같은 URL의 아카이브 항목에서 찾는다.
  var detailByURL = new Map();

  function indexDetails(items) {
    items.forEach(function (it) {
      var key = bookmarkKey(it.url);
      if (key && typeof it.detail === "string" && it.detail.trim()) detailByURL.set(key, it.detail);
    });
  }

  function detailOf(it) {
    if (typeof it.detail === "string" && it.detail.trim()) return it.detail;
    return detailByURL.get(bookmarkKey(it.url)) || "";
  }

  /* ───────── 태그 뱃지 · 태그 필터 ───────── */
  // 태그도 archive.json에만 있다. 오늘의 리포트·북마크 항목은 같은 URL의 아카이브 항목에서 찾는다.
  var tagsByURL = new Map();

  function cleanTags(list) {
    return (Array.isArray(list) ? list : []).map(function (t) { return String(t || "").trim(); }).filter(Boolean);
  }

  function indexTags(items) {
    items.forEach(function (it) {
      var key = bookmarkKey(it.url);
      var tags = cleanTags(it.tags);
      if (key && tags.length) tagsByURL.set(key, tags);
    });
  }

  function tagsOf(it) {
    var own = cleanTags(it.tags);
    return own.length ? own : (tagsByURL.get(bookmarkKey(it.url)) || []);
  }

  function tagsHTML(it) {
    var tags = tagsOf(it);
    if (!tags.length) return "";
    return '<ul class="tags" aria-label="태그">' + tags.map(function (t) {
      var on = t === reportView.tag;
      return '<li><button type="button" class="tag' + (on ? " tag--on" : "") + '" data-tag="' + escapeHTML(t) + '"' +
        ' aria-pressed="' + (on ? "true" : "false") + '" title="‘' + escapeHTML(t) + '’ 태그로 보기">#' + escapeHTML(t) + "</button></li>";
    }).join("") + "</ul>";
  }

  function inTag(items, tag) {
    return tag ? items.filter(function (it) { return tagsOf(it).indexOf(tag) >= 0; }) : items;
  }

  function renderTagFilter() {
    var el = $("tag-filter");
    el.hidden = !reportView.tag;
    el.innerHTML = reportView.tag
      ? '<span class="tag-filter__label">태그</span><span class="tag tag--on tag-filter__name">#' + escapeHTML(reportView.tag) + "</span>" +
        '<button type="button" class="tag-filter__clear" aria-label="‘' + escapeHTML(reportView.tag) + '’ 태그 필터 해제">✕</button>'
      : "";
  }

  function setTag(tag) {
    reportView.tag = tag || "";
    renderTagFilter();
    applyReportView();
    writeHash();
  }

  function setupTags() {
    // 같은 태그를 다시 누르면 해제한다.
    $("report-list").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".tag[data-tag]") : null;
      if (!btn) return;
      var tag = btn.getAttribute("data-tag");
      setTag(tag === reportView.tag ? "" : tag);
      var head = $("reports-heading");
      if (head && head.getBoundingClientRect().top < 0) {
        head.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      }
    });
    $("tag-filter").addEventListener("click", function (e) {
      if (!(e.target.closest && e.target.closest(".tag-filter__clear"))) return;
      setTag("");
      var first = $("report-list").querySelector(".tag");
      if (first) first.focus({ preventScroll: true });
    });
  }

  function detailToggleHTML(it, id) {
    if (!detailOf(it)) return "";
    var index = id.replace("report-", "");
    return '<button type="button" class="detail-toggle" aria-expanded="false" aria-controls="' + id + '-detail" data-index="' + index + '">' +
        '<span class="detail-toggle__label">📖 상세 분석 보기</span><span class="visually-hidden"> — ' + escapeHTML(it.title) + "</span></button>" +
      '<section class="detail" id="' + id + '-detail" aria-label="상세 분석" hidden></section>';
  }

  // **굵게**만 지원. 나머지는 그대로 이스케이프한다.
  function inlineMarkdown(text) {
    return escapeHTML(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  // "## 제목" → 소제목, 빈 줄로 나뉜 덩어리 → 문단, "- " 줄 → 목록
  function detailHTML(markdown) {
    var out = [], para = [], list = [];
    function flush() {
      if (para.length) out.push("<p>" + inlineMarkdown(para.join(" ")) + "</p>");
      if (list.length) out.push("<ul>" + list.map(function (li) { return "<li>" + inlineMarkdown(li) + "</li>"; }).join("") + "</ul>");
      para = []; list = [];
    }
    String(markdown).split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        flush();
        var tag = h[1].length <= 2 ? "h4" : "h5";
        out.push("<" + tag + ' class="detail__heading">' + inlineMarkdown(h[2]) + "</" + tag + ">");
      } else if (/^[-*•]\s+/.test(line)) {
        if (para.length) { out.push("<p>" + inlineMarkdown(para.join(" ")) + "</p>"); para = []; }
        list.push(line.replace(/^[-*•]\s+/, ""));
      } else if (!line) {
        flush();
      } else {
        if (list.length) flush();
        para.push(line);
      }
    });
    flush();
    return out.join("");
  }

  function toggleDetail(btn, it) {
    var panel = $(btn.getAttribute("aria-controls"));
    if (!panel || !it) return;
    var open = btn.getAttribute("aria-expanded") !== "true";
    if (open && !panel.innerHTML) panel.innerHTML = detailHTML(detailOf(it));
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.querySelector(".detail-toggle__label").textContent = open ? "📖 상세 분석 접기" : "📖 상세 분석 보기";
    panel.hidden = !open;
    // 접을 때 버튼이 화면 위로 사라졌으면 다시 보이게 한다.
    if (!open && btn.getBoundingClientRect().top < 0) {
      btn.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }

  /* ───────── 카드 고정 주소 (#item=<키>) ─────────
     같은 원문(X 글)이면 오늘의 리포트·아카이브·북마크 어디서든 같은 키 → 같은 공유 링크·같은 댓글 스레드.
     api/rss.js의 itemKey와 같은 규칙이어야 한다. */
  var itemByKey = new Map();

  function itemKey(it) {
    var m = /\/status(?:es)?\/(\d+)/.exec(String(it && it.url || ""));
    if (m) return "x-" + m[1];
    // "th:DeIZu…", "gh:owner/repo"처럼 원문 번호가 없는 출처는 id의 기호를 "-"로 바꿔 키로 쓴다.
    var id = String(it && it.id || "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
    return /^[\w-]{1,100}$/.test(id) ? id : "";
  }

  function rememberItems(items) {
    items.forEach(function (it) { var k = itemKey(it); if (k && !itemByKey.has(k)) itemByKey.set(k, it); });
  }

  function permalink(it) {
    var key = itemKey(it);
    return location.origin + location.pathname + (key ? "#item=" + encodeURIComponent(key) : "");
  }

  // 공유 링크로 들어왔을 때: 그 카드가 있는 보기로 가서 카드를 펼치고 강조한다.
  function focusItem(key, openComments) {
    if (!key) return false;
    var view = ["today", "archive", "bookmarks"].filter(function (v) {
      return reportView.sets[v].some(function (it) { return itemKey(it) === key; });
    })[0];
    if (!view) return false;
    reportView.item = key;
    var find = function () { return $("report-list").querySelector('.report[data-item="' + key + '"]'); };
    selectView(view, false);
    if (!find()) {
      // 분류·태그·검색에 가려져 있으면 필터를 풀고 다시 그린다.
      reportView.category = ALL;
      reportView.tag = "";
      reportView.query = "";
      $("report-search-input").value = "";
      renderTagFilter();
      selectView(view, false);
    }
    var li = find();
    if (!li) return false;
    li.classList.add("report--target");
    var fold = li.querySelector(".fold-toggle");
    if (fold && fold.getAttribute("aria-expanded") !== "true") toggleFold(fold);
    if (openComments) {
      var cbtn = li.querySelector(".comment-toggle");
      if (cbtn) toggleComments(cbtn, true);
    }
    // 먼 거리는 부드러운 스크롤이 위쪽 미디어·웹폰트 로딩으로 어긋나므로 바로 이동하고, 자리 잡은 뒤 한 번 더 맞춘다.
    var jump = function () { li.scrollIntoView({ block: "start", behavior: "instant" }); };
    jump();
    var settle = function () { if (Math.abs(li.getBoundingClientRect().top) > 120) jump(); };
    setTimeout(settle, 400);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(settle, 50); });
    return true;
  }

  /* ───────── 공유하기 ─────────
     Web Share API가 있으면(대부분의 모바일) 기기 공유 시트를 띄우고,
     없으면 카드 안에 X · 카카오톡 · 텔레그램 · 링크 복사 버튼을 펼친다. */
  // 카카오톡으로 바로 보내려면 Kakao Developers → 내 애플리케이션 → 앱 키의 "JavaScript 키"를 넣고,
  // 플랫폼 → Web에 사이트 도메인을 등록한다. 비워 두면 링크를 복사해 붙여 넣도록 안내한다.
  var KAKAO_JS_KEY = "";
  var KAKAO_SDK = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js";

  function shareText(it) { return String(displayTitle(it) || "") + " — 리서치 데스크"; }

  function shareHTML(it, id) {
    var key = itemKey(it);
    if (!key) return { button: "", panel: "" };
    var url = permalink(it);
    var x = "https://x.com/intent/post?text=" + encodeURIComponent(shareText(it)) + "&url=" + encodeURIComponent(url);
    var tg = "https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(shareText(it));
    var label = '<span class="visually-hidden"> — ' + escapeHTML(it.title) + "</span>";
    return {
      button: '<button type="button" class="share-toggle" data-item="' + key + '" aria-expanded="false" aria-controls="' + id + '-share">' +
        '<span aria-hidden="true">↗</span> 공유' + label + "</button>",
      panel: '<div class="share" id="' + id + '-share" role="group" aria-label="공유하기" hidden>' +
        '<a class="share__btn share__btn--x" href="' + escapeHTML(x) + '" target="_blank" rel="noopener noreferrer">' +
          '<span class="share__icon" aria-hidden="true">𝕏</span>X</a>' +
        '<button type="button" class="share__btn share__btn--kakao" data-share="kakao" data-item="' + key + '">' +
          '<span class="share__icon" aria-hidden="true">💬</span>카카오톡</button>' +
        '<a class="share__btn share__btn--tg" href="' + escapeHTML(tg) + '" target="_blank" rel="noopener noreferrer">' +
          '<span class="share__icon" aria-hidden="true">✈</span>텔레그램</a>' +
        '<button type="button" class="share__btn share__btn--copy" data-share="copy" data-item="' + key + '">' +
          '<span class="share__icon" aria-hidden="true">🔗</span>링크 복사</button>' +
      "</div>"
    };
  }

  var toastTimer = null;
  function toast(text) {
    var el = $("toast");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error("copy failed"));
    });
  }

  function copyLink(it, hint) {
    var url = permalink(it);
    copyText(url).then(function () {
      toast(hint || "링크를 복사했습니다.");
    }, function () {
      window.prompt("아래 링크를 길게 눌러 복사하세요.", url);
    });
  }

  var kakaoReady = null;
  function loadKakao() {
    if (!KAKAO_JS_KEY) return Promise.reject(new Error("no key"));
    if (!kakaoReady) {
      kakaoReady = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = KAKAO_SDK;
        s.crossOrigin = "anonymous";
        s.onload = function () {
          try {
            if (!window.Kakao.isInitialized()) window.Kakao.init(KAKAO_JS_KEY);
            resolve(window.Kakao);
          } catch (e) { reject(e); }
        };
        s.onerror = function () { kakaoReady = null; reject(new Error("Kakao SDK load failed")); };
        document.head.appendChild(s);
      });
    }
    return kakaoReady;
  }

  function shareKakao(it) {
    loadKakao().then(function (Kakao) {
      Kakao.Share.sendScrap({ requestUrl: permalink(it) });
    }).catch(function () {
      copyLink(it, "링크를 복사했습니다. 카카오톡 대화창에 붙여 넣어 주세요.");
    });
  }

  function setSharePanel(btn, open) {
    var panel = $(btn.getAttribute("aria-controls"));
    if (!panel) return;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
  }

  function onShareClick(btn) {
    var it = itemByKey.get(btn.getAttribute("data-item"));
    if (!it) return;
    var open = btn.getAttribute("aria-expanded") === "true";
    if (open) { setSharePanel(btn, false); return; }
    if (navigator.share) {
      navigator.share({ title: it.title, text: shareText(it), url: permalink(it) }).catch(function (err) {
        // 사용자가 공유 시트를 닫은 경우(AbortError)는 그대로 둔다. 그 밖의 실패는 버튼 목록으로 대신한다.
        if (!err || err.name !== "AbortError") setSharePanel(btn, true);
      });
      return;
    }
    setSharePanel(btn, true);
  }

  /* ───────── 댓글 (giscus — GitHub Discussions) ─────────
     설정 방법(저장소 관리자가 한 번만):
       1. github.com/deust132/x-trend-home → Settings → General → Features → "Discussions" 체크(활성화).
          저장소는 공개(public)여야 한다.
       2. https://github.com/apps/giscus 에서 giscus 앱을 이 저장소에 설치한다.
       3. https://giscus.app/ko 에서 저장소 deust132/x-trend-home 입력 → 페이지↔Discussion 연결은 아무거나,
          Discussion 카테고리는 "Announcements"(관리자·giscus만 새 글을 만들 수 있는 유형) 선택
          → 아래 생성된 <script>의 data-category-id 값을 GISCUS.categoryId에 넣는다.
          (카테고리를 바꿨다면 data-category 값도 GISCUS.category에 맞춘다.)
     categoryId가 비어 있으면 댓글 창 대신 "준비 중" 안내만 보인다.
     카드마다 itemKey(예: x-2106105377498829007)를 Discussion 제목으로 쓴다(mapping=specific, strict). */
  var GISCUS = {
    repo: "deust132/x-trend-home",
    repoId: "R_kgDOU8F1mA",          // GitHub API로 확인한 저장소 ID (giscus.app에서 보이는 data-repo-id와 같다)
    category: "Announcements",
    categoryId: "",                  // ← giscus.app에서 받은 data-category-id (예: "DIC_kwDO....")
    origin: "https://giscus.app"
  };

  // 페이지 배경 밝기로 판단한다. 사이트에 다크 모드(data-theme="dark" 또는 다크 배경)가 생기면 자동으로 따라간다.
  function giscusTheme() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor || "");
    if (!m) return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    var lum = (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
    return lum < 0.45 ? "dark" : "light";
  }

  function syncGiscusTheme() {
    var theme = giscusTheme();
    each(document.querySelectorAll("iframe.giscus-frame"), function (f) {
      if (f.contentWindow) f.contentWindow.postMessage({ giscus: { setConfig: { theme: theme } } }, GISCUS.origin);
    });
  }

  if (window.matchMedia) {
    var schemeQuery = matchMedia("(prefers-color-scheme: dark)");
    if (schemeQuery.addEventListener) schemeQuery.addEventListener("change", syncGiscusTheme);
    else if (schemeQuery.addListener) schemeQuery.addListener(syncGiscusTheme);
  }
  if ("MutationObserver" in window) {
    new MutationObserver(syncGiscusTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  }

  function commentsHTML(it, id) {
    var key = itemKey(it);
    if (!key) return { button: "", panel: "" };
    return {
      button: '<button type="button" class="comment-toggle" data-item="' + key + '" aria-expanded="false" aria-controls="' + id + '-comments">' +
        '<span aria-hidden="true">💬</span> <span class="comment-toggle__label">댓글</span>' +
        '<span class="visually-hidden"> — ' + escapeHTML(it.title) + "</span></button>",
      panel: '<section class="comments" id="' + id + '-comments" aria-label="댓글" hidden></section>'
    };
  }

  // giscus 스크립트는 페이지의 첫 번째 .giscus 칸에 붙으므로 댓글 창은 한 번에 하나만 연다.
  function closeComments(btn) {
    var panel = $(btn.getAttribute("aria-controls"));
    btn.setAttribute("aria-expanded", "false");
    btn.querySelector(".comment-toggle__label").textContent = "댓글";
    if (panel) { panel.hidden = true; panel.innerHTML = ""; }
  }

  function toggleComments(btn, forceOpen) {
    var panel = $(btn.getAttribute("aria-controls"));
    if (!panel) return;
    var open = forceOpen || btn.getAttribute("aria-expanded") !== "true";
    if (!open) {
      closeComments(btn);
      if (reportView.item === btn.getAttribute("data-item")) { reportView.item = ""; writeHash(); }
      return;
    }
    each(document.querySelectorAll('.comment-toggle[aria-expanded="true"]'), function (b) { if (b !== btn) closeComments(b); });
    btn.setAttribute("aria-expanded", "true");
    btn.querySelector(".comment-toggle__label").textContent = "댓글 닫기";
    panel.hidden = false;
    // GitHub 로그인 후 돌아올 주소(backLink)가 이 카드를 가리키도록 해시에 남긴다.
    reportView.item = btn.getAttribute("data-item");
    writeHash();
    if (!GISCUS.categoryId) {
      panel.innerHTML = '<p class="comments__note">댓글 기능을 준비하고 있습니다. (관리자: app.js의 GISCUS.categoryId 설정 필요)</p>';
      return;
    }
    panel.innerHTML = '<div class="giscus"></div><p class="comments__note">GitHub 계정으로 댓글을 남길 수 있습니다.</p>';
    var s = document.createElement("script");
    s.src = GISCUS.origin + "/client.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    var attrs = {
      "data-repo": GISCUS.repo,
      "data-repo-id": GISCUS.repoId,
      "data-category": GISCUS.category,
      "data-category-id": GISCUS.categoryId,
      "data-mapping": "specific",
      "data-term": btn.getAttribute("data-item"),
      "data-strict": "1",
      "data-reactions-enabled": "1",
      "data-emit-metadata": "0",
      "data-input-position": "top",
      "data-theme": giscusTheme(),
      "data-lang": "ko",
      "data-loading": "lazy"
    };
    Object.keys(attrs).forEach(function (k) { s.setAttribute(k, attrs[k]); });
    panel.appendChild(s);
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    var shareBtn = e.target.closest(".share-toggle");
    if (shareBtn) { onShareClick(shareBtn); return; }
    var commentBtn = e.target.closest(".comment-toggle");
    if (commentBtn) { toggleComments(commentBtn); return; }
    var act = e.target.closest(".share__btn[data-share]");
    if (act) {
      var it = itemByKey.get(act.getAttribute("data-item"));
      if (!it) return;
      if (act.getAttribute("data-share") === "kakao") shareKakao(it);
      else copyLink(it);
    }
  });

  /* ───────── 더보기 / 접기 ───────── */
  function isClipped(el) { return !!el && el.scrollHeight > el.clientHeight + 1; }

  // 접힌 상태에서 요약이나 인사이트가 실제로 잘린 카드에만 버튼을 보인다.
  function measureFolds(root) {
    each(root.querySelectorAll(".fold-toggle"), function (btn) {
      if (btn.getAttribute("aria-expanded") === "true") return;
      var card = $(btn.getAttribute("aria-controls"));
      btn.hidden = !(isClipped(card.querySelector(".report__summary")) || isClipped(card.querySelector(".insight-box__text")));
    });
  }

  function toggleFold(btn) {
    var card = $(btn.getAttribute("aria-controls"));
    var open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.querySelector(".fold-toggle__label").textContent = open ? "접기" : "더보기";
    card.classList.toggle("is-open", open);
    // 접을 때 카드 머리가 화면 위로 사라졌으면 다시 보이게 한다.
    if (!open && card.getBoundingClientRect().top < 0) {
      card.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }

  // 폭이 바뀌거나 웹폰트가 늦게 들어오면 잘림 여부가 달라진다.
  var refoldTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(refoldTimer);
    refoldTimer = setTimeout(function () { measureFolds($("report-list")); }, 120);
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { measureFolds($("report-list")); });
  }

  /* ───────── 아카이브 데이터 ───────── */
  // archive.json의 항목(ID 중복 제거, 최근 보관순).
  function archiveItems(archive) {
    var seen = {};
    var items = (archive && Array.isArray(archive.items) ? archive.items : []).filter(function (it) {
      if (!it || typeof it !== "object") return false;
      if (it.id == null) return true;
      var key = String(it.id);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
    items.sort(function (a, b) {
      return (Date.parse(b.archivedAt) || 0) - (Date.parse(a.archivedAt) || 0);
    });
    return items;
  }

  function renderArchiveLabel() {
    var el = $("archive-label");
    var archived = reportView.view === "archive" && reportView.sets.archive.length;
    el.hidden = !archived;
    if (!archived) return;
    el.innerHTML = '<span class="archive-label__tag">Archive</span>' +
      "<span>누적 <strong>" + formatNumber(reportView.sets.archive.length) + "</strong>건</span>" +
      (reportView.archiveUpdated ? "<span>" + escapeHTML(formatStamp(reportView.archiveUpdated)) + " 정리</span>" : "");
  }

  /* ───────── 상태 · 주소 해시 ───────── */
  var CATEGORY_ORDER = [
    "AI 코딩·에이전트", "AI 미디어 생성", "디자인·크리에이티브", "AI 학습·인사이트",
    "커리어·비즈니스", "개발·기술 일반", "트레이딩·재테크", "기타"
  ];
  var ALL = "";
  var VIEWS = { today: "오늘의 리포트", archive: "아카이브", best: "주간 베스트", bookmarks: "내 북마크" };

  // sets: 보기별 전체 항목, shown: 지금 목록에 보이는 항목(챗봇 컨텍스트용)
  var reportView = {
    view: "today", sets: { today: [], archive: [], best: [], bookmarks: [] }, archiveUpdated: "",
    category: ALL, tag: "", query: "", shown: [], item: ""
  };

  // "#view=archive&cat=<분류>&tag=<태그>&item=<카드 키>" (예전 "#cat=<분류>"도 읽는다)
  function readHash() {
    var out = {};
    String(location.hash || "").replace(/^#/, "").split("&").forEach(function (pair) {
      var m = /^(view|cat|tag|item)=(.*)$/.exec(pair);
      if (!m) return;
      try { out[m[1]] = decodeURIComponent(m[2]); } catch (e) { /* 잘못된 인코딩은 무시 */ }
    });
    return out;
  }

  function writeHash() {
    var parts = [];
    if (reportView.view !== "today") parts.push("view=" + reportView.view);
    if (reportView.category) parts.push("cat=" + encodeURIComponent(reportView.category));
    if (reportView.tag) parts.push("tag=" + encodeURIComponent(reportView.tag));
    if (reportView.item) parts.push("item=" + encodeURIComponent(reportView.item));
    var url = location.pathname + location.search + (parts.length ? "#" + parts.join("&") : "");
    if (url !== location.pathname + location.search + location.hash) history.replaceState(null, "", url);
  }

  function currentItems() { return reportView.sets[reportView.view] || []; }

  /* ───────── 보기 전환 (오늘의 리포트 / 아카이브) ───────── */
  function setupViews() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".viewbar__tab"));
    updateViewCounts();

    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { selectView(tab.getAttribute("data-view"), true); });
      tab.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        var next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        selectView(next.getAttribute("data-view"), false);
      });
    });
  }

  function updateViewCounts() {
    Object.keys(VIEWS).forEach(function (v) {
      var n = reportView.sets[v].length;
      $("count-" + v).textContent = n ? "(" + n + ")" : "";
    });
  }

  function selectView(view, scroll) {
    if (!VIEWS[view]) view = "today";
    var changed = view !== reportView.view;
    reportView.view = view;
    each(document.querySelectorAll(".viewbar__tab"), function (t) {
      var on = t.getAttribute("data-view") === view;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    each(document.querySelectorAll("[data-only]"), function (el) {
      el.hidden = el.getAttribute("data-only") !== view;
    });
    $("reports-title").textContent = VIEWS[view];
    renderArchiveLabel();
    if (view === "best") { loadBest(); loadTrendReport(trendReport.period); }
    if (view === "archive") loadPicks();
    renderExportBar();
    renderCategories();
    applyReportView();
    writeHash();
    if (changed && scroll) window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  }

  /* ───────── 분류 필터: 가로 스크롤 없는 버튼 그리드 ───────── */
  function categoryEntries(items) {
    var counts = {};
    items.forEach(function (it) { counts[it.category] = (counts[it.category] || 0) + 1; });
    var names = CATEGORY_ORDER.concat(Object.keys(counts).filter(function (c) {
      return CATEGORY_ORDER.indexOf(c) < 0;
    })).filter(function (c) { return counts[c]; });
    return [{ name: ALL, label: "전체", count: items.length }].concat(names.map(function (c) {
      return { name: c, label: c, count: counts[c] };
    }));
  }

  function renderCategories() {
    var grid = $("category-tabs");
    var entries = categoryEntries(currentItems());
    // 이 보기에 없는 분류가 선택돼 있었다면 전체로 돌린다.
    if (!entries.some(function (e) { return e.name === reportView.category; })) reportView.category = ALL;
    grid.innerHTML = entries.map(function (e) {
      return '<button type="button" class="cat' + (e.name === ALL ? " cat--all" : "") + '"' +
        ' aria-pressed="' + (e.name === reportView.category ? "true" : "false") + '"' +
        ' data-category="' + escapeHTML(e.name) + '"' + categoryStyle(e.name) + ">" +
        '<span class="cat__name">' + escapeHTML(e.label) + "</span>" +
        '<span class="cat__count">' + e.count + "</span></button>";
    }).join("");
  }

  function setupCategories() {
    $("category-tabs").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".cat") : null;
      if (!btn) return;
      reportView.category = btn.getAttribute("data-category");
      each(this.querySelectorAll(".cat"), function (b) {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      applyReportView();
      writeHash();
    });
  }

  /* ───────── 검색 (분류와 AND) ───────── */
  var SEARCH_DEBOUNCE_MS = 200;
  var FALLBACK_LATEST = 5;
  var SEARCH_KEYS = ["title", "summary", "insight"];

  function inCategory(items, name) {
    return name ? items.filter(function (it) { return it.category === name; }) : items;
  }

  // Fuse.js가 로드됐으면 퍼지 검색, CDN 실패 시 단순 includes() 검색.
  function searchItems(items, query) {
    if (typeof window.Fuse === "function") {
      var fuse = new window.Fuse(items, {
        keys: SEARCH_KEYS, includeMatches: true, ignoreLocation: true, threshold: 0.3
      });
      return fuse.search(query).map(function (r) { return { item: r.item, matches: r.matches || [] }; });
    }
    var terms = queryTerms(query);
    return items.filter(function (it) {
      var hay = SEARCH_KEYS.map(function (k) { return String(it[k] || ""); }).join("\n").toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) >= 0; });
    }).map(function (it) { return { item: it, matches: [] }; });
  }

  function queryTerms(query) {
    return query.toLowerCase().split(/\s+/).filter(Boolean);
  }

  // 형광펜 구간: 검색어가 글자 그대로 나온 곳 우선, 없으면 Fuse가 맞춘 구간(2자 이상).
  function matchRanges(text, terms, fuseIndices) {
    var lower = text.toLowerCase();
    var ranges = [];
    terms.forEach(function (t) {
      for (var at = lower.indexOf(t); at >= 0; at = lower.indexOf(t, at + t.length)) ranges.push([at, at + t.length]);
    });
    if (!ranges.length && fuseIndices) {
      var minLen = Math.min(2, terms.join("").length);
      fuseIndices.forEach(function (r) {
        if (r[1] - r[0] + 1 >= minLen) ranges.push([r[0], r[1] + 1]);
      });
    }
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    return ranges.reduce(function (out, r) {
      var last = out[out.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else out.push(r.slice());
      return out;
    }, []);
  }

  function markRanges(text, ranges) {
    var html = "", pos = 0;
    ranges.forEach(function (r) {
      html += escapeHTML(text.slice(pos, r[0])) + "<mark>" + escapeHTML(text.slice(r[0], r[1])) + "</mark>";
      pos = r[1];
    });
    return html + escapeHTML(text.slice(pos));
  }

  function searchMarker(query, hits) {
    var terms = queryTerms(query);
    var byItem = new Map(hits.map(function (h) { return [h.item, h.matches]; }));
    return function (item, field) {
      var text = String(item[field] || "");
      var m = (byItem.get(item) || []).filter(function (x) { return x.key === field; })[0];
      return markRanges(text, matchRanges(text, terms, m && m.indices));
    };
  }

  function setSearchStatus(html, fallback) {
    var el = $("search-status");
    el.innerHTML = html;
    el.classList.toggle("search-status--fallback", !!fallback);
  }

  function applyReportView() {
    var scoped = inTag(inCategory(currentItems(), reportView.category), reportView.tag);
    var query = reportView.query.trim();
    if (!query) {
      setSearchStatus(reportView.tag ? "#" + escapeHTML(reportView.tag) + " 태그 <strong>" + scoped.length + "</strong>건" : "");
      reportView.shown = scoped;
      renderReports(scoped);
      return;
    }
    var hits = searchItems(scoped, query);
    var scopes = [];
    if (reportView.category) scopes.push("‘" + escapeHTML(reportView.category) + "’");
    if (reportView.tag) scopes.push("#" + escapeHTML(reportView.tag));
    var where = scopes.length ? scopes.join(" · ") + "에서 " : "";
    if (hits.length) {
      setSearchStatus(where + "검색 결과 <strong>" + hits.length + "</strong>건");
      reportView.shown = hits.map(function (h) { return h.item; });
      renderReports(reportView.shown, searchMarker(query, hits));
      return;
    }
    // 빈 화면 대신 이 분류의 최신 글을 보여 준다.
    var latest = scoped.slice(0, FALLBACK_LATEST);
    setSearchStatus(where + "검색 결과 <strong>0</strong>건 · 최신 글 " + latest.length + "개를 대신 보여 드립니다", true);
    reportView.shown = latest;
    renderReports(latest);
  }

  function setupSearch() {
    var form = $("report-search");
    var input = $("report-search-input");
    var timer = null;
    function run() {
      clearTimeout(timer);
      if (input.value === reportView.query) return;
      reportView.query = input.value;
      applyReportView();
    }
    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(run, SEARCH_DEBOUNCE_MS);
    });
    // Enter는 기다리지 않고 바로 반영하고, 모바일 키보드를 내린다.
    form.addEventListener("submit", function (e) { e.preventDefault(); run(); input.blur(); });
    if (input.value) run();
  }

  /* ───────── 데스크 인사이트 (일간/주간/월간) ───────── */
  var insightsData = null;

  function insightLabel(period, block) {
    if (period === "daily") return block.date ? formatStamp(block.date) + " 일간 메모" : "일간 메모";
    if (period === "weekly") return (block.week || "이번 주") + " 주간 메모";
    return (block.month || "이번 달") + " 월간 메모";
  }

  function renderInsight(period) {
    var panel = $("panel-insight");
    var block = insightsData && insightsData[period];
    var points = (block && Array.isArray(block.points)) ? block.points : [];
    if (!points.length) {
      panel.innerHTML = '<p class="empty">이 기간의 인사이트가 아직 없습니다.</p>';
      return;
    }
    panel.innerHTML = '<p class="insight-sheet__label">' + escapeHTML(insightLabel(period, block)) + "</p><ol>" +
      points.map(function (p) { return "<li>" + escapeHTML(p) + "</li>"; }).join("") + "</ol>";
  }

  function setupInsightTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('#insights [role="tab"]'));
    var panel = $("panel-insight");

    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
      });
      panel.setAttribute("aria-labelledby", tab.id);
      if (focus) tab.focus();
      renderInsight(tab.getAttribute("data-period"));
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(tab, false); });
      tab.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
        else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === "Home") next = tabs[0];
        else if (e.key === "End") next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
    select(tabs[0], false);
  }

  /* ───────── 트렌드 ───────── */
  function sparkline(values, label, scaleMax) {
    var W = 260, H = 28, PAD = 3;
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "trend__spark");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    var nums = values.map(Number).filter(function (v) { return isFinite(v); });
    if (nums.length < 2) return svg;
    // 모든 토픽을 같은 0~최댓값 축에 그려 서로 비교되게 한다.
    var max = Math.max(scaleMax || 0, Math.max.apply(null, nums)) || 1;
    var pts = nums.map(function (v, i) {
      var x = PAD + (i * (W - PAD * 2)) / (nums.length - 1);
      var y = H - PAD - (v / max) * (H - PAD * 2);
      return [x.toFixed(1), y.toFixed(1)];
    });
    var line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("points", pts.map(function (p) { return p.join(","); }).join(" "));
    svg.appendChild(line);
    var last = pts[pts.length - 1];
    var dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", last[0]);
    dot.setAttribute("cy", last[1]);
    dot.setAttribute("r", "2.6");
    svg.appendChild(dot);
    return svg;
  }

  function renderTrends(trends) {
    var list = $("trend-list");
    var topics = (trends && Array.isArray(trends.topics)) ? trends.topics : [];
    var days = topics.reduce(function (n, t) { return Math.max(n, Array.isArray(t.spark) ? t.spark.length : 0); }, 0);
    var scaleMax = topics.reduce(function (m, t) {
      return Math.max(m, Math.max.apply(null, (t.spark || [0]).map(Number).filter(isFinite).concat(0)));
    }, 0);
    $("trends-meta").textContent = "멘션 수 · 최근 " + (days || 7) + "일" + (trends && trends.updated ? " · " + formatStamp(trends.updated) + " 기준" : "");
    list.innerHTML = "";
    if (!topics.length) {
      list.innerHTML = '<li class="empty">트렌드 데이터가 없습니다.</li>';
      return;
    }
    var topMentions = Math.max.apply(null, topics.map(function (t) { return t.mentions || 0; }));
    topics.forEach(function (t) {
      var li = document.createElement("li");
      li.className = "trend" + (t.mentions === topMentions ? " trend--top" : "");
      li.innerHTML = '<h3 class="trend__name">' + escapeHTML(t.name) + "</h3>" +
        '<span class="trend__count"><strong>' + formatNumber(t.mentions) + "</strong> 멘션</span>";
      var spark = Array.isArray(t.spark) ? t.spark : [];
      li.appendChild(sparkline(spark, t.name + " 최근 " + spark.length + "일 추이: " + spark.join(", "), scaleMax));
      list.appendChild(li);
    });
  }

  /* ───────── AI 질문 창 (챗봇) ───────── */
  var CHAT_ENDPOINT = "/api/chat";
  var CHAT_TIMEOUT_MS = 60000;
  var CHAT_HISTORY_MAX = 20;
  var CONTEXT_MAX_CHARS = 12000;
  var chatHistory = [];
  var chatPending = false;

  // 질문 단어 추출: 조사·요청 표현을 걷어 내고 2글자 이상만 남긴다. ("크몽은 뭐야?" → ["크몽"])
  var CHAT_STOPWORDS = [
    "관련", "관련된", "항목", "리포트", "내용", "요약", "정리", "설명", "알려줘", "알려주세요", "정리해줘",
    "설명해줘", "찾아줘", "보여줘", "뭐야", "뭔가요", "무엇", "어떤", "어떻게", "있어", "있나요", "있는",
    "대해", "대한", "그거", "이거", "저거", "좀", "그리고", "같은", "중에", "가장", "추천", "해줘"
  ];
  var PARTICLE_RE = /(에서는|에서|으로는|으로|에게|까지|부터|이랑|하고|이나|이란|란|은|는|이|가|을|를|에|의|로|과|와|도|만|나)$/;

  function questionTerms(text) {
    var out = [];
    String(text || "").toLowerCase().split(/[^0-9a-z가-힣]+/).forEach(function (w) {
      if (w.length > 2 && PARTICLE_RE.test(w)) {
        var stem = w.replace(PARTICLE_RE, "");
        if (stem.length >= 2) w = stem;
      }
      if (w.length < 2 || CHAT_STOPWORDS.indexOf(w) >= 0 || out.indexOf(w) >= 0) return;
      out.push(w);
    });
    return out;
  }

  // 제목·요약·인사이트·분류에 질문 단어가 몇 개 들어 있는지
  function relevanceScore(it, terms) {
    var hay = [it.title, it.summary, it.insight, it.category].join("\n").toLowerCase();
    return terms.reduce(function (n, t) { return n + (hay.indexOf(t) >= 0 ? 1 : 0); }, 0);
  }

  function fullContextLine(it, n) {
    return n + ". [" + it.category + "] " + it.title + "\n   요약: " + it.summary +
      (it.insight ? "\n   인사이트: " + it.insight : "") +
      "\n   작성자 " + it.author + " · 좋아요 " + it.likes + " · " + it.url;
  }

  // 한도(CONTEXT_MAX_CHARS) 안에서 ① 질문과 관련된 항목 ② 지금 보이는 항목을 요약까지,
  // 나머지는 제목만 넣는다. 들어가지 못한 항목 수도 밝혀서 모델이 '전부 봤다'고 착각하지 않게 한다.
  function buildChatContext(question) {
    var all = currentItems(), shown = reportView.shown;
    var terms = questionTerms(question);
    var used = 0, omitted = 0;
    var lines = [];
    function add(line) {
      if (used + line.length + 1 > CONTEXT_MAX_CHARS) return false;
      lines.push(line);
      used += line.length + 1;
      return true;
    }

    add(VIEWS[reportView.view] + " " + all.length + "건" +
      (reportView.category ? " · 선택 분류: " + reportView.category : " · 분류: 전체") +
      (reportView.query.trim() ? " · 검색어: " + reportView.query.trim() : ""));

    var detailed = new Set();
    var related = terms.length ? all.map(function (it, i) {
      return { it: it, i: i, score: relevanceScore(it, terms) };
    }).filter(function (r) { return r.score > 0; }).sort(function (a, b) {
      return b.score - a.score || a.i - b.i;
    }).map(function (r) { return r.it; }) : [];

    if (related.length && add("## 질문과 관련된 리포트 (질문 단어: " + terms.join(", ") + ")")) {
      related.forEach(function (it) {
        if (add(fullContextLine(it, detailed.size + 1))) detailed.add(it);
      });
    }

    // 지금 보이는 항목을 자세히 넣되, 나머지 제목 목록이 들어갈 자리는 남겨 둔다.
    var TITLES_HEADER = "## 그 밖의 제목 (요약 없음 — 제목만으로 내용을 추측하지 말 것)";
    function titleLine(it) { return "- [" + it.category + "] " + it.title; }
    var reserve = TITLES_HEADER.length + 1;
    all.forEach(function (it) { if (!detailed.has(it)) reserve += titleLine(it).length + 1; });

    var visible = shown.filter(function (it) { return !detailed.has(it); });
    if (visible.length && add("## 지금 보고 있는 리포트")) {
      visible.forEach(function (it) {
        var line = fullContextLine(it, detailed.size + 1);
        var freed = titleLine(it).length + 1;
        if (used + line.length + 1 + reserve - freed > CONTEXT_MAX_CHARS) return;
        if (add(line)) { detailed.add(it); reserve -= freed; }
      });
    }

    var rest = all.filter(function (it) { return !detailed.has(it); });
    if (rest.length && add(TITLES_HEADER)) {
      rest.forEach(function (it) {
        if (!add(titleLine(it))) omitted++;
      });
    }
    if (omitted) {
      lines.push("(분량 한도로 " + omitted + "건은 제목도 넣지 못함)");
    }
    return lines.join("\n");
  }

  function appendChat(kind, html) {
    var li = document.createElement("li");
    li.className = "chat-msg chat-msg--" + kind;
    var who = { user: "질문", assistant: "답변 · 데스크", error: "전달 실패", loading: "답변 · 데스크" }[kind] || "";
    li.innerHTML = '<p class="chat-msg__who">' + who + "</p>" + html;
    $("chat-log").appendChild(li);
    li.scrollIntoView({ block: "end" });
    return li;
  }

  function sourcesHTML(sources) {
    if (!Array.isArray(sources) || !sources.length) return "";
    return '<div class="chat-sources"><p class="chat-sources__title">참고한 외부 검색</p><ul>' +
      sources.map(function (s) {
        var items = Array.isArray(s.items) ? s.items.slice(0, 5) : [];
        return "<li><strong>" + escapeHTML(s.label || s.source) + "</strong>" +
          (s.note ? ' <span class="chat-sources__note">— ' + escapeHTML(s.note) + "</span>" : "") +
          (items.length ? "<ul>" + items.map(function (x) {
            return '<li><a href="' + escapeHTML(safeURL(x.url)) + '" target="_blank" rel="noopener noreferrer">' +
              escapeHTML(x.title || x.url) + "</a></li>";
          }).join("") + "</ul>" : "") + "</li>";
      }).join("") + "</ul></div>";
  }

  function chatErrorText(status, body) {
    if (body && typeof body.error === "string") return body.error;
    if (status === 404 || status === 405 || status === 501) {
      return "챗봇 서버(/api/chat)를 찾을 수 없습니다. 정적 서버가 아닌 Vercel 배포(또는 vercel dev)에서 동작합니다.";
    }
    return "답변을 받지 못했습니다 (응답 " + status + "). 잠시 후 다시 시도해 주세요.";
  }

  function sendChat(text) {
    if (chatPending) return;
    chatPending = true;
    $("chat-send").disabled = true;
    $("chat-log").setAttribute("aria-busy", "true");
    appendChat("user", '<p class="chat-msg__text">' + escapeHTML(text) + "</p>");
    chatHistory.push({ role: "user", content: text });
    var loading = appendChat("loading",
      '<p class="chat-msg__text chat-typing" role="status">답변 작성 중<span aria-hidden="true">.</span><span aria-hidden="true">.</span><span aria-hidden="true">.</span></p>');

    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var killer = ctrl && setTimeout(function () { ctrl.abort(); }, CHAT_TIMEOUT_MS);
    fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory.slice(-CHAT_HISTORY_MAX), context: buildChatContext(text) }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (!res.ok || !body || typeof body.reply !== "string") throw new Error(chatErrorText(res.status, body));
        return body;
      });
    }).then(function (body) {
      loading.remove();
      chatHistory.push({ role: "assistant", content: body.reply });
      appendChat("assistant", '<p class="chat-msg__text">' + escapeHTML(body.reply) + "</p>" + sourcesHTML(body.sources));
    }, function (err) {
      loading.remove();
      chatHistory.pop(); // 실패한 질문은 다음 요청의 대화 기록에서 뺀다.
      var msg = err && err.name === "AbortError" ? "응답이 너무 오래 걸려 중단했습니다. 다시 시도해 주세요."
        : (err && err.message && !/fetch|network/i.test(err.message) ? err.message : "네트워크 오류로 질문을 보내지 못했습니다.");
      appendChat("error", '<p class="chat-msg__text" role="alert">' + escapeHTML(msg) + "</p>");
      console.warn("[research-desk] chat:", err && err.message);
    }).then(function () {
      clearTimeout(killer);
      chatPending = false;
      $("chat-send").disabled = false;
      $("chat-log").removeAttribute("aria-busy");
    });
  }

  /* ───────── 질문 창 크기 조절 (마우스·터치 드래그, 방향키) ─────────
     모바일(900px 미만)은 아래 시트라 높이만, 데스크톱은 우하단에 붙어 있으므로
     위쪽(높이)·왼쪽(너비)·왼쪽 위 모서리(둘 다)를 끌어 키운다. */
  var DESKTOP_MQ = "(min-width: 900px)";
  var SIZE_KEY = "research-desk:chat-size";
  var MIN_W = 300, MIN_H_DESKTOP = 320, MIN_H_MOBILE = 260, KEY_STEP = 24;

  function setupChatResize(panel) {
    var mq = window.matchMedia ? window.matchMedia(DESKTOP_MQ) : { matches: false };
    var saved = loadSizes();

    function mode() { return mq.matches ? "desktop" : "mobile"; }

    function loadSizes() {
      try { return JSON.parse(localStorage.getItem(SIZE_KEY)) || {}; } catch (e) { return {}; }
    }
    function saveSizes() {
      try { localStorage.setItem(SIZE_KEY, JSON.stringify(saved)); } catch (e) { /* 사생활 보호 모드 등 */ }
    }

    function limits() {
      var desktop = mq.matches;
      return {
        minW: MIN_W, maxW: Math.max(MIN_W, window.innerWidth - 40),
        minH: desktop ? MIN_H_DESKTOP : MIN_H_MOBILE,
        maxH: Math.max(MIN_H_MOBILE, window.innerHeight - (desktop ? 40 : 12))
      };
    }

    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    // 저장된 크기를 현재 화면 안으로 맞춰 적용한다. 없으면 CSS 기본값.
    function apply() {
      var s = saved[mode()] || {}, L = limits();
      if (s.h) panel.style.setProperty("--chat-h", clamp(s.h, L.minH, L.maxH) + "px");
      else panel.style.removeProperty("--chat-h");
      if (mq.matches && s.w) panel.style.setProperty("--chat-w", clamp(s.w, L.minW, L.maxW) + "px");
      else panel.style.removeProperty("--chat-w");
      updateAria();
    }

    function setSize(w, h) {
      var L = limits(), s = saved[mode()] || {};
      if (h != null) { s.h = Math.round(clamp(h, L.minH, L.maxH)); panel.style.setProperty("--chat-h", s.h + "px"); }
      if (w != null && mq.matches) { s.w = Math.round(clamp(w, L.minW, L.maxW)); panel.style.setProperty("--chat-w", s.w + "px"); }
      saved[mode()] = s;
      updateAria();
    }

    function updateAria() {
      var rect = panel.getBoundingClientRect();
      each(panel.querySelectorAll("[data-resize][role='separator']"), function (h) {
        var horiz = h.getAttribute("data-resize") === "n";
        h.setAttribute("aria-valuenow", Math.round(horiz ? rect.height : rect.width));
        h.setAttribute("aria-valuetext", (horiz ? "높이 " + Math.round(rect.height) : "너비 " + Math.round(rect.width)) + "픽셀");
      });
    }

    each(panel.querySelectorAll("[data-resize]"), function (handle) {
      var dir = handle.getAttribute("data-resize");
      var drag = null;

      handle.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        e.preventDefault();
        var rect = panel.getBoundingClientRect();
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
        if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
        panel.classList.add("is-resizing");
      });

      handle.addEventListener("pointermove", function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        // 창이 오른쪽·아래에 붙어 있으므로 왼쪽·위로 끌수록 커진다.
        var w = dir.indexOf("w") >= 0 ? drag.w + (drag.x - e.clientX) : null;
        var h = dir.indexOf("n") >= 0 ? drag.h + (drag.y - e.clientY) : null;
        setSize(w, h);
      });

      function end(e) {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null;
        panel.classList.remove("is-resizing");
        saveSizes();
      }
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
      handle.addEventListener("lostpointercapture", end);

      // 손잡이 두 번 누르기: 기본 크기로
      handle.addEventListener("dblclick", reset);

      handle.addEventListener("keydown", function (e) {
        var rect = panel.getBoundingClientRect();
        var step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
        if (dir === "n" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          setSize(null, rect.height + (e.key === "ArrowUp" ? step : -step));
        } else if (dir === "w" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          setSize(rect.width + (e.key === "ArrowLeft" ? step : -step), null);
        } else return;
        e.preventDefault();
        saveSizes();
      });
    });

    function reset() {
      delete saved[mode()];
      saveSizes();
      apply();
    }

    $("chat-reset-size").addEventListener("click", reset);
    if (mq.addEventListener) mq.addEventListener("change", apply);
    else if (mq.addListener) mq.addListener(apply);
    var t = null;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(apply, 100);
    });
    return { apply: apply };
  }

  function setupChat() {
    var opener = $("chat-open"), panel = $("chat-panel"), form = $("chat-form"), input = $("chat-input");
    var closeTimer = null;
    var mobileMQ = window.matchMedia ? window.matchMedia("(max-width: 899px)") : { matches: true };
    var resizer = setupChatResize(panel);

    function focusables() {
      return Array.prototype.filter.call(
        panel.querySelectorAll('button, [href], textarea, input, [tabindex]:not([tabindex="-1"])'),
        function (el) { return !el.disabled && el.offsetParent !== null; });
    }

    function open() {
      clearTimeout(closeTimer);
      if (!$("chat-log").children.length) {
        appendChat("assistant", '<p class="chat-msg__text">지금 보고 있는 리포트 목록을 바탕으로 답합니다. ' +
          "‘최신’·‘오늘’·‘뉴스’, ‘깃허브’, ‘레딧’, ‘트위터’ 같은 말을 넣으면 외부 검색 결과도 함께 참고합니다.\n" +
          "창 가장자리(모바일은 위쪽 손잡이)를 끌면 크기를 바꿀 수 있습니다.</p>");
      }
      panel.hidden = false;
      resizer.apply();
      void panel.offsetWidth;
      panel.classList.add("is-open");
      opener.setAttribute("aria-expanded", "true");
      // 모바일에서는 시트 뒤 페이지가 같이 스크롤되지 않게 한다.
      if (mobileMQ.matches) document.body.classList.add("chat-lock");
      // 모바일에서 바로 키보드가 올라오면 화면을 가리므로 데스크톱에서만 입력창에 포커스.
      if (mobileMQ.matches) $("chat-close").focus(); else input.focus();
    }

    function close() {
      if (panel.hidden) return;
      panel.classList.remove("is-open");
      opener.setAttribute("aria-expanded", "false");
      document.body.classList.remove("chat-lock");
      closeTimer = setTimeout(function () { panel.hidden = true; }, reducedMotion() ? 0 : 280);
      opener.focus();
    }

    opener.addEventListener("click", function () { if (panel.classList.contains("is-open")) close(); else open(); });
    $("chat-close").addEventListener("click", close);
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      // 열려 있는 동안 포커스를 창 안에 가둔다.
      var els = focusables();
      if (!els.length) return;
      var first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text || chatPending) return;
      input.value = "";
      sendChat(text);
    });
    input.addEventListener("keydown", function (e) {
      // 한글 조합 중 Enter는 글자 확정용. 모바일은 줄바꿈으로 두고 보내기 버튼을 쓴다.
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !mobileMQ.matches) {
        e.preventDefault();
        form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });
  }

  /* ───────── 로그인 · 북마크 ─────────
     /api/auth/*, /api/bookmarks (Vercel 함수). 정적 서버로만 열면 이 API가 없으므로
     로그인 영역과 저장 버튼을 숨기고 나머지 기능은 그대로 둔다. */
  var AUTH_ME = "/api/auth/me";
  var AUTH_LOGIN = "/api/auth/login";
  var AUTH_LOGOUT = "/api/auth/logout";
  var BOOKMARKS_API = "/api/bookmarks";

  // available: 로그인 API 응답을 받았는지, loginReady: 서버에 Google 키가 설정됐는지
  var account = { available: false, loginReady: false, user: null };
  var savedKeys = new Set();
  var savePending = new Set();

  // 서버와 같은 방식으로 URL을 정규화해 북마크 식별자로 쓴다.
  function bookmarkKey(url) {
    if (!/^https?:\/\//i.test(url || "")) return "";
    try { return new URL(String(url).trim()).href; } catch (e) { return ""; }
  }

  function apiJSON(path, method, body) {
    return fetch(path, {
      method: method || "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: "same-origin"
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.error) || "응답 " + res.status);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function loginHref() {
    return AUTH_LOGIN + "?return=" + encodeURIComponent(location.pathname + location.search + location.hash);
  }

  function goLogin() { location.href = loginHref(); }

  function showNotice(text) {
    var el = $("account-notice");
    el.textContent = text || "";
    el.hidden = !text;
  }

  function setBookmarks(items) {
    reportView.sets.bookmarks = items;
    savedKeys = new Set(items.map(function (it) { return bookmarkKey(it.url); }));
  }

  // 페이지 시작 시 한 번: 로그인 상태 → (로그인했다면) 북마크 목록. 실패해도 reject하지 않는다.
  function loadAccount() {
    return apiJSON(AUTH_ME).then(function (me) {
      account.available = true;
      account.loginReady = !!me.loginReady;
      account.user = me.user || null;
      if (!account.user) return null;
      return apiJSON(BOOKMARKS_API).then(function (data) {
        setBookmarks(Array.isArray(data.items) ? data.items : []);
      }, function (err) {
        showNotice("북마크를 불러오지 못했습니다: " + err.message);
      });
    }).then(function () {
      renderAccount();
      return { ok: true };
    }, function (err) {
      // 정적 서버(404 등): 로그인 기능 없이 진행
      account.available = false;
      renderAccount();
      console.info("[research-desk] 로그인 API 없음:", err && err.message);
      return { ok: true };
    });
  }

  function renderAccount() {
    var box = $("account");
    box.hidden = !account.available;
    if (!account.available) return;
    var u = account.user;
    if (u) {
      box.innerHTML =
        (u.picture ? '<img class="account__avatar" src="' + escapeHTML(u.picture) + '" alt="" width="28" height="28" referrerpolicy="no-referrer">' : "") +
        '<span class="account__name" title="' + escapeHTML(u.email) + '">' + escapeHTML(u.name || u.email) + "</span>" +
        '<button type="button" class="account__btn" data-account="logout">로그아웃</button>';
    } else if (account.loginReady) {
      box.innerHTML = '<a class="account__btn account__btn--login" data-account="login" href="' + escapeHTML(loginHref()) + '">' +
        '<span class="account__g" aria-hidden="true">G</span> Google로 로그인</a>';
    } else {
      box.innerHTML = '<button type="button" class="account__btn" disabled title="서버에 Google OAuth 설정이 필요합니다">로그인 준비 중</button>';
    }
  }

  // 저장 버튼: 로그인 기능이 있을 때만 그린다.
  function saveButtonHTML(it) {
    var key = bookmarkKey(it && it.url);
    if (!key || !account.available || !(account.loginReady || account.user)) return "";
    var on = savedKeys.has(key);
    return '<button type="button" class="save-toggle" data-url="' + escapeHTML(key) + '" aria-pressed="' + (on ? "true" : "false") + '"' +
      (account.user ? "" : ' title="Google 로그인 후 저장할 수 있습니다"') + ">" +
      '<span class="save-toggle__icon" aria-hidden="true">' + (on ? "★" : "☆") + "</span>" +
      '<span class="save-toggle__label">' + (on ? "저장됨" : "저장") + "</span>" +
      '<span class="visually-hidden"> — ' + escapeHTML(it.title) + "</span></button>";
  }

  // 북마크 보기에서만 보이는 이름 변경 버튼 (로그인 사용자)
  function renameButtonHTML(it) {
    if (reportView.view !== "bookmarks" || !account.user) return "";
    var key = bookmarkKey(it && it.url);
    if (!key) return "";
    var renamed = !!(it.customTitle && String(it.customTitle).trim());
    return '<button type="button" class="rename-toggle" data-url="' + escapeHTML(key) + '"' +
      ' title="' + escapeHTML(renamed ? "원래 제목: " + it.title : "이 북마크의 이름을 바꿉니다") + '">' +
      '<span aria-hidden="true">✏️</span>' +
      '<span class="rename-toggle__label">' + (renamed ? "이름 변경됨" : "이름 변경") + "</span></button>";
  }

  function paintSaveButtons(key) {
    var on = savedKeys.has(key);
    each(document.querySelectorAll(".save-toggle"), function (btn) {
      if (btn.getAttribute("data-url") !== key) return;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.querySelector(".save-toggle__icon").textContent = on ? "★" : "☆";
      btn.querySelector(".save-toggle__label").textContent = on ? "저장됨" : "저장";
    });
  }

  function findItem(key) {
    var views = ["bookmarks", "today", "archive"];
    for (var v = 0; v < views.length; v++) {
      var list = reportView.sets[views[v]];
      for (var i = 0; i < list.length; i++) if (bookmarkKey(list[i].url) === key) return list[i];
    }
    return null;
  }

  function emptyListHTML() {
    if (reportView.view === "best" && !reportView.sets.best.length) return bestEmptyHTML();
    if (reportView.view !== "bookmarks" || reportView.sets.bookmarks.length) return reportView.tag ? "이 조건에 해당하는 리포트가 없습니다. 태그 필터를 해제해 보세요." : "이 분류에 해당하는 리포트가 없습니다.";
    if (!account.available) return "북마크는 배포된 사이트(Vercel)에서 로그인한 뒤 쓸 수 있습니다.";
    if (!account.user) {
      return account.loginReady
        ? '로그인하면 저장한 리포트를 여기서 모아 볼 수 있습니다. <a href="' + escapeHTML(loginHref()) + '">Google로 로그인</a>'
        : "로그인 기능이 아직 설정되지 않았습니다.";
    }
    return "아직 저장한 리포트가 없습니다. 카드의 ☆ 저장 버튼을 눌러 보세요.";
  }

  // 북마크가 바뀌면 탭 숫자와, 북마크 보기라면 목록·분류도 다시 그린다.
  function refreshBookmarks() {
    updateViewCounts();
    renderExportBar();
    if (reportView.view !== "bookmarks") return;
    renderCategories();
    applyReportView();
    writeHash();
  }

  function signedOut(message) {
    account.user = null;
    setBookmarks([]);
    renderAccount();
    renderExportBar();
    showNotice(message);
    // 저장 버튼 상태와 북마크 보기를 처음부터 다시 그린다.
    var lead = reportView.sets.today.length ? pickLead(reportView.sets.today) : null;
    if (lead) renderFront(lead);
    updateViewCounts();
    renderCategories();
    applyReportView();
  }

  function toggleSave(btn) {
    var key = btn.getAttribute("data-url");
    if (!account.user) { goLogin(); return; }
    if (savePending.has(key)) return;
    var item = findItem(key);
    if (!item) return;
    var saving = !savedKeys.has(key);
    savePending.add(key);
    btn.setAttribute("aria-busy", "true");
    if (saving) savedKeys.add(key); else savedKeys.delete(key);
    paintSaveButtons(key);

    var req = saving ? apiJSON(BOOKMARKS_API, "POST", { item: item }) : apiJSON(BOOKMARKS_API, "DELETE", { url: key });
    req.then(function (data) {
      var rest = reportView.sets.bookmarks.filter(function (it) { return bookmarkKey(it.url) !== key; });
      reportView.sets.bookmarks = saving && data && data.item ? [data.item].concat(rest) : rest;
      showNotice("");
      refreshBookmarks();
    }, function (err) {
      if (saving) savedKeys.delete(key); else savedKeys.add(key);
      paintSaveButtons(key);
      if (err.status === 401) signedOut("로그인이 만료됐습니다. 다시 로그인해 주세요.");
      else showNotice((saving ? "저장" : "저장 해제") + "하지 못했습니다: " + err.message);
    }).then(function () {
      savePending.delete(key);
      btn.removeAttribute("aria-busy");
    });
  }

  // 북마크 이름 인라인 편집: 제목을 입력창으로 바꿔 저장·취소·되돌리기를 제공한다.
  function startRename(btn) {
    if (!account.user) { goLogin(); return; }
    var key = btn.getAttribute("data-url");
    var item = findItem(key);
    if (!item) return;
    var card = btn.closest ? btn.closest("article") : null;
    var h3 = card ? card.querySelector(".report__title") : null;
    if (!h3 || h3.querySelector(".rename-editor")) return;
    var renamed = !!(item.customTitle && String(item.customTitle).trim());
    h3.innerHTML =
      '<span class="rename-editor">' +
      '<input type="text" class="rename-editor__input" maxlength="300" aria-label="북마크 이름" value="' + escapeHTML(displayTitle(item)) + '">' +
      '<button type="button" class="rename-editor__save">저장</button>' +
      '<button type="button" class="rename-editor__cancel">취소</button>' +
      (renamed ? '<button type="button" class="rename-editor__revert">원본으로 되돌리기</button>' : "") +
      "</span>";
    var input = h3.querySelector(".rename-editor__input");
    input.focus();
    try { input.select(); } catch (e) { /* 무시 */ }
    function cancel() { applyReportView(); }
    h3.querySelector(".rename-editor__save").addEventListener("click", function () { saveRename(key, input.value, btn); });
    h3.querySelector(".rename-editor__cancel").addEventListener("click", cancel);
    var revert = h3.querySelector(".rename-editor__revert");
    if (revert) revert.addEventListener("click", function () { saveRename(key, "", btn); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); saveRename(key, input.value, btn); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
  }

  function saveRename(key, value, btn) {
    var v = String(value == null ? "" : value).trim().slice(0, 300);
    btn.disabled = true;
    apiJSON(BOOKMARKS_API, "PATCH", { url: key, customTitle: v }).then(function (data) {
      if (data && data.item) {
        var list = reportView.sets.bookmarks;
        for (var i = 0; i < list.length; i++) {
          if (bookmarkKey(list[i].url) === key) { list[i] = data.item; break; }
        }
      }
      showNotice("");
      applyReportView();
      toast(v ? "북마크 이름을 바꿨습니다." : "원래 제목으로 되돌렸습니다.");
    }, function (err) {
      btn.disabled = false;
      if (err.status === 401) signedOut("로그인이 만료됐습니다. 다시 로그인해 주세요.");
      else showNotice("이름을 바꾸지 못했습니다: " + err.message);
    });
  }

  function logout(btn) {
    btn.disabled = true;
    apiJSON(AUTH_LOGOUT, "POST", {}).then(function () {
      signedOut("로그아웃했습니다.");
    }, function (err) {
      btn.disabled = false;
      showNotice("로그아웃하지 못했습니다: " + err.message);
    });
  }

  function setupAccount() {
    // 로그인 실패로 돌아온 경우(?login=failed): 알리고 주소에서 지운다.
    if (/[?&]login=failed(&|$)/.test(location.search)) {
      showNotice("로그인하지 못했습니다. 다시 시도해 주세요.");
      var search = location.search.replace(/([?&])login=failed(&|$)/, "$1").replace(/[?&]$/, "");
      history.replaceState(null, "", location.pathname + search + location.hash);
    }
    $("account").addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest("[data-account]") : null;
      if (!el) return;
      if (el.getAttribute("data-account") === "logout") logout(el);
      // 로그인 링크는 누르는 순간의 해시(보기·분류)를 돌아올 주소로 담는다.
      else el.setAttribute("href", loginHref());
    });
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".save-toggle") : null;
      if (btn) { toggleSave(btn); return; }
      var rn = e.target.closest ? e.target.closest(".rename-toggle") : null;
      if (rn) { startRename(rn); return; }
    });
  }

  /* ───────── 좋아요 (♡ 버튼 + 숫자) ─────────
     숫자는 카드를 그린 뒤 /api/likes?ids=…로 한꺼번에 받는다. 한 사람 1회:
     이 브라우저는 localStorage로, 로그인 사용자는 서버(계정당 1회)로 막는다.
     좋아요 API가 없으면(정적 서버·KV 미설정) 버튼을 숨긴다(body.likes-off). */
  var LIKES_API = "/api/likes";
  var LIKED_STORE = "rd_liked_v1";
  var LIKE_BATCH = 200;
  var likeCounts = new Map();
  var likedKeys = new Set();
  var likePending = new Set();
  var likesOff = false;
  var likeQueue = new Set();
  var likeTimer = null;

  (function loadLiked() {
    try {
      var saved = JSON.parse(localStorage.getItem(LIKED_STORE) || "[]");
      if (Array.isArray(saved)) saved.forEach(function (k) { if (typeof k === "string") likedKeys.add(k); });
    } catch (e) { /* 저장소를 못 쓰면 서버 제한만 적용된다 */ }
  })();

  function storeLiked() {
    try { localStorage.setItem(LIKED_STORE, JSON.stringify(Array.from(likedKeys).slice(-2000))); } catch (e) { /* 무시 */ }
  }

  function likeButtonHTML(it) {
    var key = itemKey(it);
    if (!key) return "";
    var on = likedKeys.has(key);
    var n = likeCounts.get(key);
    return '<button type="button" class="like-toggle" data-item="' + key + '" aria-pressed="' + (on ? "true" : "false") + '">' +
      '<span class="like-toggle__icon" aria-hidden="true">' + (on ? "♥" : "♡") + "</span>" +
      '<span class="like-toggle__count">' + (n == null ? "" : formatNumber(n)) + "</span>" +
      '<span class="visually-hidden">좋아요 — ' + escapeHTML(it.title) + "</span></button>";
  }

  function paintLikes(key) {
    var on = likedKeys.has(key);
    var n = likeCounts.get(key);
    each(document.querySelectorAll('.like-toggle[data-item="' + key + '"]'), function (btn) {
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.querySelector(".like-toggle__icon").textContent = on ? "♥" : "♡";
      btn.querySelector(".like-toggle__count").textContent = n == null ? "" : formatNumber(n);
    });
  }

  // 화면에 새로 그린 버튼들의 숫자를 모아서 받는다.
  function requestLikeCounts(root) {
    if (likesOff) return;
    each((root || document).querySelectorAll(".like-toggle[data-item]"), function (btn) {
      var key = btn.getAttribute("data-item");
      if (!likeCounts.has(key)) likeQueue.add(key);
    });
    if (!likeQueue.size) return;
    clearTimeout(likeTimer);
    likeTimer = setTimeout(flushLikeCounts, 30);
  }

  function flushLikeCounts() {
    var keys = Array.from(likeQueue);
    likeQueue.clear();
    for (var i = 0; i < keys.length; i += LIKE_BATCH) fetchLikeCounts(keys.slice(i, i + LIKE_BATCH));
  }

  function fetchLikeCounts(keys) {
    apiJSON(LIKES_API + "?ids=" + encodeURIComponent(keys.join(","))).then(function (data) {
      var likes = (data && data.likes) || {};
      keys.forEach(function (k) { likeCounts.set(k, Math.max(0, Number(likes[k]) || 0)); });
      // 로그인 사용자가 다른 기기에서 누른 좋아요도 반영한다.
      var liked = Array.isArray(data && data.liked) ? data.liked : [];
      liked.forEach(function (k) { likedKeys.add(k); });
      if (liked.length) storeLiked();
      keys.forEach(paintLikes);
    }, function (err) {
      if (err.status === 404 || err.status === 503 || err.status === 501 || !err.status) disableLikes(err);
      else console.warn("[research-desk] 좋아요 수를 불러오지 못했습니다:", err.message);
    });
  }

  function disableLikes(err) {
    if (likesOff) return;
    likesOff = true;
    document.body.classList.add("likes-off");
    console.info("[research-desk] 좋아요 API 없음:", err && err.message);
    if (reportView.view === "best") applyReportView();
  }

  function toggleLike(btn) {
    var key = btn.getAttribute("data-item");
    if (likePending.has(key)) return;
    if (likedKeys.has(key)) { toast("이미 좋아요를 눌렀어요"); return; }
    var before = likeCounts.get(key) || 0;
    likePending.add(key);
    likedKeys.add(key);
    likeCounts.set(key, before + 1);
    paintLikes(key);
    apiJSON(LIKES_API, "POST", { itemId: key }).then(function (data) {
      likeCounts.set(key, Math.max(0, Number(data && data.likes) || before + 1));
      storeLiked();
      paintLikes(key);
      if (data && data.already) toast("이미 좋아요를 눌렀어요");
      best.stale = true;
    }, function (err) {
      likedKeys.delete(key);
      likeCounts.set(key, before);
      paintLikes(key);
      toast("좋아요를 저장하지 못했습니다: " + err.message);
    }).then(function () { likePending.delete(key); });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".like-toggle") : null;
    if (btn) toggleLike(btn);
  });

  /* ───────── 주간 베스트 (좋아요 TOP 10) ───────── */
  var best = { loaded: false, loading: false, stale: false, error: "" };

  function bestItem(row) {
    var base = itemByKey.get(row.itemId) || { id: row.itemId, title: row.title, url: row.url, category: row.category };
    var copy = {};
    Object.keys(base).forEach(function (k) { copy[k] = base[k]; });
    copy.rank = row.rank;
    copy.weekLikes = row.likes;
    return copy;
  }

  function loadBest() {
    if (best.loading || (best.loaded && !best.stale) || likesOff) return;
    best.loading = true;
    best.stale = false;
    apiJSON(LIKES_API + "/top?period=week").then(function (data) {
      var rows = Array.isArray(data && data.items) ? data.items : [];
      reportView.sets.best = rows.map(bestItem);
      rows.forEach(function (r) { if (typeof r.total === "number") likeCounts.set(r.itemId, r.total); });
      best.error = "";
    }, function (err) {
      if (err.status === 404 || err.status === 503 || !err.status) disableLikes(err);
      else best.error = err.message;
    }).then(function () {
      best.loading = false;
      best.loaded = true;
      updateViewCounts();
      if (reportView.view === "best") { renderCategories(); applyReportView(); }
    });
  }

  function bestEmptyHTML() {
    if (likesOff) return "주간 베스트는 배포된 사이트(Vercel)에서 좋아요 저장소를 연결한 뒤 볼 수 있습니다.";
    if (!best.loaded) return "주간 베스트를 불러오는 중…";
    if (best.error) return "주간 베스트를 불러오지 못했습니다: " + escapeHTML(best.error);
    return "이번 주에는 아직 좋아요가 없습니다. 카드의 ♡ 버튼으로 첫 추천을 남겨 보세요.";
  }

  /* ───────── 트렌드 리포트 (주간/월간, /api/trends-report) ───────── */
  var TREND_REPORT_API = "/api/trends-report";
  var trendReport = { period: "week", cache: {}, pending: {} };

  function loadTrendReport(period) {
    trendReport.period = period;
    if (trendReport.cache[period]) { renderTrendReport(); return; }
    renderTrendReport();
    if (trendReport.pending[period]) return;
    trendReport.pending[period] = true;
    apiJSON(TREND_REPORT_API + "?period=" + period).then(function (data) {
      trendReport.cache[period] = { ok: true, data: data };
    }, function (err) {
      trendReport.cache[period] = { ok: false, error: err };
    }).then(function () {
      trendReport.pending[period] = false;
      if (trendReport.period === period) renderTrendReport();
    });
  }

  var REPORT_UNITS = { saves: "저장 ", likes: "♥ ", "source-likes": "X ♥ " };

  function reportItemHTML(it, unit) {
    var inList = itemByKey.has(it.itemId);
    var href = inList ? "#item=" + encodeURIComponent(it.itemId) : safeURL(it.url);
    return '<li class="tr-rank__item"' + categoryStyle(it.category) + '><span class="tr-rank__no">' + it.rank + "</span>" +
      '<span class="tr-rank__body"><a class="tr-rank__title" href="' + escapeHTML(href) + '"' +
        (inList ? "" : ' target="_blank" rel="noopener noreferrer"') + ">" + escapeHTML(it.title) + "</a>" +
      '<span class="tr-rank__meta">' + escapeHTML(it.category || "") + (it.count && unit ? " · " + unit + formatNumber(it.count) : "") + "</span></span></li>";
  }

  function renderTrendReport() {
    var body = $("trend-report-body");
    var entry = trendReport.cache[trendReport.period];
    var label = trendReport.period === "month" ? "월간" : "주간";
    if (!entry) { body.innerHTML = '<p class="loading">' + label + " 리포트를 집계하는 중…</p>"; return; }
    if (!entry.ok) {
      body.innerHTML = '<p class="empty">' + (entry.error && entry.error.status && entry.error.status !== 404
        ? "리포트를 불러오지 못했습니다: " + escapeHTML(entry.error.message)
        : "트렌드 리포트는 배포된 사이트(Vercel)에서 볼 수 있습니다.") + "</p>";
      return;
    }
    var r = entry.data;
    var range = shortDate(r.from) + " ~ " + shortDate(r.to);
    var saved = r.mostSaved || { items: [] };
    var savedNote = saved.basis === "saves" ? "" : '<p class="tr-note">저장 기록이 아직 없어 대신 ‘' + escapeHTML(saved.basisLabel || "") + "’ 기준으로 보여 드립니다.</p>";
    var rising = r.risingCategories || [];
    var newTags = r.newTags || [];
    body.innerHTML =
      '<p class="tr-range">' + escapeHTML(range) + " · 보관 " + formatNumber(r.totals ? r.totals.items : 0) + "건" +
        (r.totals ? " (직전 " + formatNumber(r.totals.previousItems) + "건)" : "") +
        (r.anchoredToLatest ? " · 최근 보관일 기준" : "") + "</p>" +
      '<div class="tr-grid">' +
        '<section class="tr-card"><h3 class="tr-card__title">가장 많이 저장된 글 TOP ' + (saved.items.length || 5) + "</h3>" + savedNote +
          (saved.items.length ? '<ol class="tr-rank">' + saved.items.map(function (it) { return reportItemHTML(it, REPORT_UNITS[saved.basis]); }).join("") + "</ol>" : '<p class="empty">집계된 글이 없습니다.</p>') +
        "</section>" +
        '<section class="tr-card"><h3 class="tr-card__title">급상승 카테고리</h3>' +
          (rising.length ? '<ul class="tr-cats">' + rising.map(function (c) {
            return '<li class="tr-cat"' + categoryStyle(c.category) + '><span class="tr-cat__name">' + escapeHTML(c.category) + "</span>" +
              '<span class="tr-cat__delta">+' + c.delta + (c.growth == null ? " · 신규" : " · " + c.growth + "%") + "</span>" +
              '<span class="tr-cat__count">' + c.count + "건 (직전 " + c.previous + ")</span></li>";
          }).join("") + "</ul>" : '<p class="empty">직전 기간보다 늘어난 분류가 없습니다.</p>') +
        "</section>" +
        '<section class="tr-card"><h3 class="tr-card__title">새 태그 트렌드</h3>' +
          (newTags.length ? '<ul class="tags tr-tags">' + newTags.map(function (t) {
            return '<li><button type="button" class="tag" data-report-tag="' + escapeHTML(t.tag) + '" title="‘' + escapeHTML(t.tag) + '’ 태그 글 보기">#' +
              escapeHTML(t.tag) + ' <span class="tr-tags__n">' + t.count + "</span></button></li>";
          }).join("") + "</ul>" : '<p class="empty">이번 기간에 처음 등장한 태그가 없습니다.</p>') +
        "</section>" +
      "</div>";
  }

  function setupTrendReport() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll("#trend-report [data-report-period]"));
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
      });
      if (focus) tab.focus();
      loadTrendReport(tab.getAttribute("data-report-period"));
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(tab, false); });
      tab.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        select(tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length], true);
      });
    });
    // 새 태그를 누르면 아카이브에서 그 태그로 거른다.
    $("trend-report-body").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-report-tag]") : null;
      if (!btn) return;
      reportView.tag = btn.getAttribute("data-report-tag");
      reportView.category = ALL;
      renderTagFilter();
      selectView("archive", true);
    });
  }

  /* ───────── 독자 참여: 링크 추천 · 새 글 알림 · 북마크 내보내기 ─────────
     /api/submit, /api/notify, /api/export (Vercel 함수). 로그인 API가 없으면(정적 서버) 버튼을 숨긴다. */
  var SUBMIT_API = "/api/submit";
  var NOTIFY_API = "/api/notify";
  var EXPORT_API = "/api/export";
  var picks = { loaded: false, loading: false };
  var exportPending = false;

  function openDialog(d) {
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); }
    else d.setAttribute("open", "");
  }

  function closeDialog(d) {
    if (typeof d.close === "function") d.close();
    else d.removeAttribute("open");
  }

  // 로그인 필요한 동작 앞에서: 로그인 안 했으면 로그인으로 보내거나 안내하고 false
  function requireLogin(what) {
    if (account.user) return true;
    if (account.loginReady) { toast(what + " 로그인이 필요합니다. 로그인 화면으로 이동합니다."); setTimeout(goLogin, 600); }
    else toast("로그인 기능이 아직 설정되지 않았습니다.");
    return false;
  }

  // 폼 분류 선택지: 기본 순서 + 아카이브에 실제로 있는 분류
  function formCategories(extra) {
    var names = CATEGORY_ORDER.slice();
    (extra || []).concat(reportView.sets.archive.map(function (it) { return it.category; })).forEach(function (c) {
      if (c && names.indexOf(c) < 0) names.push(c);
    });
    return names;
  }

  /* 링크 추천 */
  function openSubmit() {
    if (!requireLogin("링크를 추천하려면")) return;
    var d = $("submit-dialog");
    var sel = $("submit-category");
    var current = sel.value || "기타";
    sel.innerHTML = formCategories().map(function (c) {
      return '<option value="' + escapeHTML(c) + '"' + (c === current ? " selected" : "") + ">" + escapeHTML(c) + "</option>";
    }).join("");
    $("submit-status").textContent = "";
    openDialog(d);
    d.querySelector("[name=url]").focus();
  }

  function sendSubmit(e) {
    e.preventDefault();
    var form = $("submit-form");
    var status = $("submit-status");
    var data = {
      url: form.elements.url.value.trim(),
      title: form.elements.title.value.trim(),
      description: form.elements.description.value.trim(),
      category: form.elements.category.value
    };
    if (!/^https?:\/\/\S+$/i.test(data.url)) { status.textContent = "http(s)로 시작하는 링크 주소를 넣어 주세요."; form.elements.url.focus(); return; }
    if (!data.title) { status.textContent = "제목을 입력해 주세요."; form.elements.title.focus(); return; }
    var btn = $("submit-send");
    btn.disabled = true;
    status.textContent = "보내는 중…";
    apiJSON(SUBMIT_API, "POST", data).then(function () {
      form.reset();
      closeDialog($("submit-dialog"));
      toast("추천을 접수했습니다. 검토 후 아카이브에 올라갑니다.");
    }, function (err) {
      if (err.status === 401) { closeDialog($("submit-dialog")); signedOut("로그인이 만료됐습니다. 다시 로그인해 주세요."); return; }
      status.textContent = "보내지 못했습니다: " + err.message;
    }).then(function () { btn.disabled = false; });
  }

  /* 새 글 알림 */
  function setNotifyDisabled(off, reason) {
    var form = $("notify-form");
    each(form.querySelectorAll("input, #notify-send"), function (el) { el.disabled = off; });
    var note = $("notify-off");
    note.textContent = off ? "알림 기능 비활성화 — " + (reason || "서버 설정이 아직 끝나지 않았습니다.") : "";
    note.hidden = !off;
  }

  function renderNotifyCategories(names, chosen) {
    $("notify-categories").innerHTML = names.map(function (c, i) {
      return '<label class="check"><input type="checkbox" name="categories" value="' + escapeHTML(c) + '"' +
        (chosen.indexOf(c) >= 0 ? " checked" : "") + ' id="notify-cat-' + i + '"><span>' + escapeHTML(c) + "</span></label>";
    }).join("");
  }

  function openNotify() {
    var d = $("notify-dialog");
    var form = $("notify-form");
    var status = $("notify-status");
    status.textContent = "설정을 불러오는 중…";
    $("notify-unsub").hidden = true;
    renderNotifyCategories(formCategories(), []);
    setNotifyDisabled(true, "설정을 불러오는 중입니다.");
    $("notify-off").hidden = true;
    openDialog(d);
    apiJSON(NOTIFY_API).then(function (st) {
      var sub = st.subscription;
      renderNotifyCategories(formCategories(st.categories), sub ? sub.categories || [] : []);
      if (!form.elements.email.value) form.elements.email.value = (sub && sub.email) || (st.user && st.user.email) || "";
      setNotifyDisabled(!st.enabled, st.reason);
      $("notify-unsub").hidden = !(sub && st.enabled);
      status.textContent = sub
        ? (sub.status === "active" ? "알림을 받고 있습니다" + (sub.categories && sub.categories.length ? "(" + sub.categories.join(", ") + ")." : "(모든 분류).") : "확인 메일을 기다리는 중입니다.")
        : "";
    }, function (err) {
      setNotifyDisabled(true, "알림 서버에 연결하지 못했습니다(" + err.message + ").");
      status.textContent = "";
    });
  }

  function sendNotify(e) {
    e.preventDefault();
    var form = $("notify-form");
    var status = $("notify-status");
    var email = form.elements.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = "올바른 이메일 주소를 입력해 주세요."; form.elements.email.focus(); return; }
    var categories = [];
    each(form.querySelectorAll("input[name=categories]:checked"), function (el) { categories.push(el.value); });
    var btn = $("notify-send");
    btn.disabled = true;
    status.textContent = "신청하는 중…";
    apiJSON(NOTIFY_API, "POST", { email: email, categories: categories }).then(function (data) {
      if (data.status === "active") {
        status.textContent = "알림을 켰습니다.";
        $("notify-unsub").hidden = false;
        toast("새 글 알림을 켰습니다.");
      } else {
        status.textContent = email + "로 확인 메일을 보냈습니다. 메일의 링크를 누르면 알림이 시작됩니다.";
      }
    }, function (err) {
      status.textContent = "신청하지 못했습니다: " + err.message;
    }).then(function () { btn.disabled = false; });
  }

  function unsubscribeNotify() {
    if (!requireLogin("알림을 해지하려면")) return;
    var btn = $("notify-unsub");
    btn.disabled = true;
    apiJSON(NOTIFY_API, "DELETE", {}).then(function () {
      btn.hidden = true;
      $("notify-status").textContent = "알림을 해지했습니다.";
      toast("새 글 알림을 해지했습니다.");
    }, function (err) {
      if (err.status === 401) signedOut("로그인이 만료됐습니다. 다시 로그인해 주세요.");
      $("notify-status").textContent = "해지하지 못했습니다: " + err.message;
    }).then(function () { btn.disabled = false; });
  }

  /* 독자 추천 링크(아카이브 보기) */
  function loadPicks() {
    if (!account.available) { $("picks").classList.add("picks--off"); return; }
    if (picks.loaded || picks.loading) return;
    picks.loading = true;
    apiJSON(SUBMIT_API + "?status=approved").then(function (data) {
      picks.loaded = true;
      renderPicks(Array.isArray(data.items) ? data.items : []);
    }, function (err) {
      console.info("[research-desk] 독자 추천 없음:", err && err.message);
      $("picks").classList.add("picks--off");
    }).then(function () { picks.loading = false; });
  }

  function renderPicks(items) {
    var body = $("picks-body");
    if (!items.length) {
      body.innerHTML = '<p class="picks__empty">아직 승인된 독자 추천이 없습니다. 위의 “링크 추천하기”로 보내 주세요.</p>';
      return;
    }
    body.innerHTML = '<ul class="picks__list">' + items.map(function (it) {
      return '<li class="pick"><span class="pick__cat">' + escapeHTML(it.category || "기타") + "</span>" +
        '<a class="pick__title" href="' + escapeHTML(it.url) + '" target="_blank" rel="noopener noreferrer ugc">' + escapeHTML(it.title) + "</a>" +
        (it.summary ? '<p class="pick__summary">' + escapeHTML(it.summary) + "</p>" : "") + "</li>";
    }).join("") + "</ul>";
  }

  /* 북마크 내보내기 */
  function renderExportBar() {
    var bar = $("export-bar");
    if (!bar) return;
    bar.hidden = !(reportView.view === "bookmarks" && account.user);
    var empty = !reportView.sets.bookmarks.length;
    each(bar.querySelectorAll("[data-export]"), function (b) {
      b.disabled = empty || exportPending;
      b.title = empty ? "저장한 북마크가 없습니다" : "";
    });
  }

  function filenameFrom(header, fallback) {
    var m = /filename="?([^";]+)"?/i.exec(header || "");
    return m ? m[1] : fallback;
  }

  function exportBookmarks(format) {
    if (!requireLogin("내보내려면") || exportPending) return;
    exportPending = true;
    renderExportBar();
    fetch(EXPORT_API + "?format=" + format, { cache: "no-store", credentials: "same-origin" }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return null; }).then(function (data) {
          var err = new Error((data && data.error) || "응답 " + res.status);
          err.status = res.status;
          throw err;
        });
      }
      var name = filenameFrom(res.headers.get("Content-Disposition"), "bookmarks." + format);
      return res.blob().then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        toast(name + " 파일로 저장했습니다.");
      });
    }).catch(function (err) {
      if (err.status === 401) signedOut("로그인이 만료됐습니다. 다시 로그인해 주세요.");
      else toast("내보내지 못했습니다: " + err.message);
    }).then(function () {
      exportPending = false;
      renderExportBar();
    });
  }

  function setupParticipation() {
    var actions = $("desk-actions");
    actions.hidden = !account.available;
    actions.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-desk]") : null;
      if (!btn) return;
      if (btn.getAttribute("data-desk") === "submit") openSubmit();
      else openNotify();
    });
    $("submit-form").addEventListener("submit", sendSubmit);
    $("notify-form").addEventListener("submit", sendNotify);
    $("notify-unsub").addEventListener("click", unsubscribeNotify);
    each(document.querySelectorAll(".sheet"), function (d) {
      d.addEventListener("click", function (e) {
        // 닫기 버튼, 또는 바깥(backdrop) 클릭
        if (e.target === d || (e.target.closest && e.target.closest("[data-close]"))) closeDialog(d);
      });
    });
    $("export-bar").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-export]") : null;
      if (btn && !btn.disabled) exportBookmarks(btn.getAttribute("data-export"));
    });
    if (!account.available) $("picks").classList.add("picks--off");
  }

  /* ───────── 시작 ───────── */
  function settle(p) {
    return p.then(function (v) { return { ok: true, value: v }; }, function (e) { return { ok: false, error: e }; });
  }

  function init() {
    setupChat();
    setupAccount();
    Promise.all([
      settle(fetchJSON(SOURCES.daily)),
      settle(fetchJSON(SOURCES.insights)),
      settle(fetchJSON(SOURCES.trends)),
      settle(fetchJSON(SOURCES.archive)),
      loadAccount()
    ]).then(function (r) {
      var daily = r[0].ok ? r[0].value : null;
      var trends = r[2].ok ? r[2].value : null;
      renderUpdated(daily, trends);

      var today = daily && Array.isArray(daily.items) ? daily.items : [];
      reportView.sets.archive = archiveItems(r[3].ok ? r[3].value : null);
      indexMedia(reportView.sets.archive);
      if (today.length) renderFront(pickLead(today));
      else showFailure($("front-body"), "오늘의 리포트");

      reportView.sets.today = today;
      // 주간 베스트·트렌드 리포트가 키로 원래 카드를 찾을 수 있게 미리 색인한다.
      rememberItems(today);
      rememberItems(reportView.sets.archive);
      indexDetails(reportView.sets.archive);
      indexTags(reportView.sets.archive);
      reportView.archiveUpdated = r[3].ok && r[3].value ? r[3].value.updated : "";

      setupViews();
      setupCategories();
      setupSearch();
      setupTags();
      setupTrendReport();
      setupParticipation();

      var hash = readHash();
      // 오늘 자료가 없으면 아카이브부터 보여 준다.
      var view = hash.view || (today.length ? "today" : "archive");
      reportView.category = hash.cat || ALL;
      reportView.tag = hash.tag || "";
      renderTagFilter();
      selectView(view, false);
      if (!currentItems().length && reportView.view !== "bookmarks") showFailure($("report-list"), VIEWS[reportView.view]);
      // 공유 링크(#item=…)로 들어온 경우. giscus 로그인에서 돌아온 경우(?giscus=…)는 댓글 창까지 다시 연다.
      if (hash.item && !focusItem(hash.item, /[?&]giscus=/.test(location.search))) {
        reportView.item = "";
        writeHash();
      }

      if (r[1].ok) { insightsData = r[1].value; setupInsightTabs(); }
      else showFailure($("panel-insight"), "인사이트");

      if (trends) renderTrends(trends);
      else showFailure($("trend-list"), "트렌드");

      // 주소창에서 해시를 직접 바꾼 경우
      window.addEventListener("hashchange", function () {
        var h = readHash();
        if (h.item && h.item !== reportView.item) {
          if (focusItem(h.item, false)) return;
          reportView.item = "";
          writeHash();
        }
        if (!h.view && h.cat == null && h.tag == null) return;
        reportView.category = h.cat || ALL;
        reportView.tag = h.tag || "";
        renderTagFilter();
        selectView(h.view || "today", false);
      });

      r.forEach(function (x) { if (!x.ok) console.warn("[research-desk]", x.error && x.error.message); });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
