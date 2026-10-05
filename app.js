(() => {
  "use strict";

  const DATA = {
    daily: "data/daily.json",
    insights: "data/insights.json",
    trends: "data/trends.json",
  };
  const PERIODS = ["daily", "weekly", "monthly"];
  const numberFmt = new Intl.NumberFormat("ko-KR");
  const compactFmt = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });

  const $ = (sel) => document.querySelector(sel);

  // 매일 JSON만 교체하므로 브라우저/CDN 캐시를 우회해 항상 최신 파일을 받는다.
  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${path} 로드 실패 (HTTP ${res.status})`);
    return res.json();
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of [].concat(children)) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function safeUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
    } catch {
      return null;
    }
  }

  function formatDate(value, withTime = false) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value ?? "";
    return date.toLocaleString("ko-KR", {
      year: "numeric", month: "long", day: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  }

  function showState(container, message, isError = false) {
    container.replaceChildren(el("p", { class: isError ? "state error" : "state", text: message }));
    container.removeAttribute("aria-busy");
  }

  /* 오늘의 리포트 */
  function renderReport(data) {
    const list = $("#report-list");
    const items = Array.isArray(data.items) ? data.items : [];
    $("#report-meta").textContent = data.date ? `${formatDate(data.date)} · ${items.length}건` : `${items.length}건`;
    if (!items.length) return showState(list, "오늘 등록된 리포트가 없습니다.");

    list.replaceChildren(...items.map((item) => {
      const url = safeUrl(item.url);
      const author = item.author || {};
      return el("article", { class: "card" }, [
        el("div", { class: "card-tags" }, [
          item.category && el("span", { class: "tag category", text: item.category }),
          item.source && el("span", { class: "tag", text: item.source }),
        ]),
        el("h3", { text: item.title ?? "(제목 없음)" }),
        item.summary && el("p", { text: item.summary }),
        el("div", { class: "card-foot" }, [
          el("span", { class: "author" }, [
            el("strong", { text: author.name ?? "알 수 없음" }),
            author.handle && el("span", { text: author.handle }),
          ]),
          el("span", { class: "likes", title: "좋아요", text: `♥ ${numberFmt.format(Number(item.likes) || 0)}` }),
          url && el("a", { class: "card-link", href: url, target: "_blank", rel: "noopener noreferrer", text: "원문 보기 ↗" }),
        ]),
      ]);
    }));
    list.removeAttribute("aria-busy");
  }

  /* 인사이트 (탭) */
  function renderInsight(insights, period) {
    const panel = $("#insight-panel");
    panel.setAttribute("aria-labelledby", `tab-${period}`);
    const entry = insights[period];
    if (!entry) return showState(panel, "이 기간의 인사이트가 아직 없습니다.");

    const points = Array.isArray(entry.points) ? entry.points : [];
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    panel.replaceChildren(
      entry.period && el("p", { class: "period", text: entry.period }),
      el("h3", { text: entry.headline ?? "" }),
      entry.summary && el("p", { class: "summary", text: entry.summary }),
      points.length ? el("ul", {}, points.map((p) => el("li", { text: p }))) : null,
      keywords.length ? el("div", { class: "keywords" }, keywords.map((k) => el("span", { class: "tag", text: `#${k}` }))) : null,
    );
  }

  function setupTabs(insights) {
    const tabs = PERIODS.map((p) => $(`#tab-${p}`));
    const select = (tab, focus) => {
      for (const t of tabs) {
        const active = t === tab;
        t.setAttribute("aria-selected", String(active));
        t.tabIndex = active ? 0 : -1;
      }
      if (focus) tab.focus();
      renderInsight(insights, tab.dataset.period);
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(tab, false));
      tab.addEventListener("keydown", (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        select(tabs[(i + step + tabs.length) % tabs.length], true);
      });
    });
    select(tabs[0], false);
  }

  /* 트렌드 */
  const SVG_NS = "http://www.w3.org/2000/svg";

  function sparkline(series, direction) {
    const w = 120, h = 32, pad = 3;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", `spark ${direction}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `추이: ${series.join(", ")}`);
    if (series.length < 2) return svg;

    const min = Math.min(...series), max = Math.max(...series);
    const span = max - min || 1;
    const pts = series.map((v, i) => [
      pad + (i / (series.length - 1)) * (w - pad * 2),
      h - pad - ((v - min) / span) * (h - pad * 2),
    ]);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

    const area = document.createElementNS(SVG_NS, "path");
    area.setAttribute("d", `${line} L${pts.at(-1)[0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`);
    area.setAttribute("fill", "currentColor");
    area.setAttribute("fill-opacity", "0.12");

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", line);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");

    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", pts.at(-1)[0].toFixed(1));
    dot.setAttribute("cy", pts.at(-1)[1].toFixed(1));
    dot.setAttribute("r", "2.2");
    dot.setAttribute("fill", "currentColor");

    svg.append(area, path, dot);
    return svg;
  }

  function renderTrends(data) {
    const list = $("#trend-list");
    const topics = (Array.isArray(data.topics) ? data.topics : [])
      .slice()
      .sort((a, b) => (Number(b.mentions) || 0) - (Number(a.mentions) || 0));
    const range = data.range || {};
    $("#trends-meta").textContent = range.label || (range.start && range.end ? `${range.start} ~ ${range.end}` : "");
    if (!topics.length) return showState(list, "트렌드 데이터가 없습니다.");

    const head = el("div", { class: "trend-row head", "aria-hidden": "true" }, [
      el("span", { text: "#" }), el("span", { text: "토픽" }),
      el("span", { class: "mentions", text: "멘션" }), el("span", { text: "추이" }),
      el("span", { class: "change", text: "변화" }),
    ]);

    const rows = topics.map((t, i) => {
      const series = (Array.isArray(t.series) ? t.series : []).map(Number).filter(Number.isFinite);
      const change = Number(t.changePct);
      const hasChange = Number.isFinite(change);
      const direction = !hasChange || change === 0 ? "flat" : change > 0 ? "up" : "down";
      return el("div", { class: "trend-row" }, [
        el("span", { class: "rank", text: i + 1 }),
        el("span", { class: "topic" }, [t.topic ?? "", t.description && el("small", { text: t.description })]),
        el("span", { class: "mentions", title: numberFmt.format(Number(t.mentions) || 0), text: compactFmt.format(Number(t.mentions) || 0) }),
        el("span", { class: "spark-cell" }, [sparkline(series, direction)]),
        el("span", {
          class: `change ${direction}`,
          text: hasChange ? `${change > 0 ? "▲" : change < 0 ? "▼" : "–"} ${Math.abs(change).toFixed(1)}%` : "–",
        }),
      ]);
    });
    list.replaceChildren(head, ...rows);
  }

  /* 부트스트랩: 섹션별로 독립 로드해 한 파일이 깨져도 나머지는 표시한다. */
  async function init() {
    const updated = [];
    const sections = [
      [DATA.daily, renderReport, "#report-list"],
      [DATA.insights, setupTabs, "#insight-panel"],
      [DATA.trends, renderTrends, "#trend-list"],
    ];
    await Promise.all(sections.map(async ([path, render, target]) => {
      try {
        const data = await loadJSON(path);
        render(data);
        if (data.updatedAt) updated.push(data.updatedAt);
      } catch (err) {
        console.warn(err);
        showState($(target), "데이터를 불러오지 못했습니다.", true);
      }
    }));
    const latest = updated.map((v) => new Date(v)).filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => b - a)[0];
    $("#updated-at").textContent = latest ? `마지막 업데이트 ${formatDate(latest, true)}` : "";
  }

  init();
})();
