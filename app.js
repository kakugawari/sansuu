/*!
 * app.js — 画面まわり。操作と描画だけを 書く (計算は core.js)。
 */
(function () {
  'use strict';

  const C = window.Core;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STORE_KEY = 'sansuu.stats.v1';

  /* ================================================================
   * 小道具
   * ============================================================== */

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const key in attrs) if (attrs[key] != null) node.setAttribute(key, String(attrs[key]));
    return node;
  }

  /**
   * 塗りの こさ・文字の 大きさは style で 書く。
   * SVG の 属性 (fill-opacity="..." など) は、CSS の class 指定に 必ず 負ける。
   * .shape { fill-opacity: .13 } が 効いて しまい、濃さの ちがいが 出なかった。
   */
  function styleFor(node, part) {
    if (part.fillOpacity != null) node.style.fillOpacity = part.fillOpacity;
    if (part.size != null) node.style.fontSize = part.size + 'px';
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  /**
   * 問題文の {{3/4}} を 縦書きの 分数に、{{2 1/3}} を 帯分数に して 並べる。
   * 文字は すべて textContent で 入れる (HTML を 組み立てない)。
   */
  function renderRich(container, text) {
    clear(container);
    const parts = String(text).split(/(\{\{[^}]*\}\})/);
    for (const part of parts) {
      const m = part.match(/^\{\{(?:(\d+) )?(\d+)\/(\d+)\}\}$/);
      if (!m) {
        if (part) container.appendChild(document.createTextNode(part));
        continue;
      }
      if (m[1]) container.appendChild(el('span', 'mixed-whole', m[1]));
      const frac = el('span', 'frac');
      frac.appendChild(el('span', 'fn', m[2]));
      frac.appendChild(el('span', 'fd', m[3]));
      container.appendChild(frac);
    }
  }

  /* ================================================================
   * 図を 描く
   *
   * 図形は 「cm を そのまま 座標に した 形」で 組み立て、最後に まとめて
   * 拡大する。こうすると 「たて 3cm よこ 9cm」が ちゃんと 細長く 見える。
   * ============================================================== */

  const MARGIN = { left: 46, top: 26, right: 30, bottom: 32 };

  /**
   * 奥行きの 見せ方。実際の 長さの 半分くらいで 斜めに ずらすが、
   * 手前の 面より 大きく ずらすと 何の形か 分からなく なるので 頭を おさえる。
   */
  function depthOffset(depth, front) {
    return clamp(depth * 0.5, 1, front * 0.6);
  }

  function figureSVG(fig) {
    if (!fig) return null;
    const build = FIGURES[fig.kind];
    if (!build) return null;

    const plan = build(fig);                                   // {w, h, parts:[…]}
    const scale = clamp(Math.min(300 / plan.w, 210 / plan.h), 7, 30);
    const width = plan.w * scale + MARGIN.left + MARGIN.right;
    const height = plan.h * scale + MARGIN.top + MARGIN.bottom;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${Math.round(width)} ${Math.round(height)}`,
      width: Math.round(width), height: Math.round(height),
      role: 'img', 'aria-label': '問題の図'
    });
    const g = svgEl('g', { transform: `translate(${MARGIN.left},${MARGIN.top})` });

    for (const part of plan.parts) {
      if (part.type === 'poly') {
        g.appendChild(styleFor(svgEl('polygon', {
          class: part.klass || 'shape',
          points: part.points.map((p) => `${round1(p[0] * scale)},${round1(p[1] * scale)}`).join(' ')
        }), part));
      } else if (part.type === 'line') {
        g.appendChild(svgEl('line', {
          class: part.klass || 'aux',
          x1: round1(part.x1 * scale), y1: round1(part.y1 * scale),
          x2: round1(part.x2 * scale), y2: round1(part.y2 * scale)
        }));
      } else if (part.type === 'ellipse') {
        g.appendChild(styleFor(svgEl('ellipse', {
          class: part.klass || 'shape',
          cx: round1(part.cx * scale), cy: round1(part.cy * scale),
          rx: round1(part.rx * scale), ry: round1(part.ry * scale)
        }), part));
      } else if (part.type === 'text' && part.text) {
        const t = styleFor(svgEl('text', {
          x: round1(part.x * scale + (part.dx || 0)),
          y: round1(part.y * scale + (part.dy || 0)),
          'text-anchor': part.anchor || 'middle',
          'dominant-baseline': part.baseline || 'middle'
        }), part);
        t.textContent = part.text;
        g.appendChild(t);
      }
    }
    svg.appendChild(g);
    return svg;
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  function label(x, y, text, anchor, dx, dy) {
    return { type: 'text', x: x, y: y, text: text, anchor: anchor || 'middle', dx: dx || 0, dy: dy || 0 };
  }

  const FIGURES = {
    rect: function (f) {
      const parts = [
        { type: 'poly', points: [[0, 0], [f.w, 0], [f.w, f.h], [0, f.h]] },
        label(f.w / 2, 0, f.labelTop, 'middle', 0, -12),
        label(0, f.h / 2, f.labelLeft, 'end', -10, 0)
      ];
      if (f.inside) parts.push(label(f.w / 2, f.h / 2, f.inside));
      return { w: f.w, h: f.h, parts: parts };
    },

    tri: function (f) {
      const apex = f.base * 0.32;
      const parts = [
        { type: 'poly', points: [[0, f.height], [f.base, f.height], [apex, 0]] },
        { type: 'line', x1: apex, y1: 0, x2: apex, y2: f.height },
        label(f.base / 2, f.height, f.labelBase, 'middle', 0, 18),
        label(apex, f.height / 2, f.labelHeight, 'start', 8, 0)
      ];
      if (f.inside) parts.push(label(f.base * 0.62, f.height * 0.66, f.inside));
      return { w: f.base, h: f.height, parts: parts };
    },

    para: function (f) {
      const skew = Math.max(f.base * 0.25, 1);
      const parts = [
        { type: 'poly', points: [[skew, 0], [skew + f.base, 0], [f.base, f.height], [0, f.height]] },
        { type: 'line', x1: skew, y1: 0, x2: skew, y2: f.height },
        label(f.base / 2, f.height, f.labelBase, 'middle', 0, 18),
        label(skew, f.height / 2, f.labelHeight, 'start', 8, 0)
      ];
      return { w: f.base + skew, h: f.height, parts: parts };
    },

    trapezoid: function (f) {
      const off = (f.bottom - f.top) / 2;
      return {
        w: f.bottom, h: f.height,
        parts: [
          { type: 'poly', points: [[off, 0], [off + f.top, 0], [f.bottom, f.height], [0, f.height]] },
          { type: 'line', x1: off, y1: 0, x2: off, y2: f.height },
          label(off + f.top / 2, 0, f.labelTop, 'middle', 0, -12),
          label(f.bottom / 2, f.height, f.labelBottom, 'middle', 0, 18),
          label(off, f.height / 2, f.labelHeight, 'start', 8, 0)
        ]
      };
    },

    circle: function (f) {
      return {
        w: f.r * 2, h: f.r * 2,
        parts: [
          { type: 'ellipse', cx: f.r, cy: f.r, rx: f.r, ry: f.r },
          { type: 'line', x1: f.r, y1: f.r, x2: f.r * 2, y2: f.r },
          label(f.r * 1.5, f.r, f.labelR, 'middle', 0, -12)
        ]
      };
    },

    lshape: function (f) {
      const W = f.W, H = f.H, cw = f.cutW, ch = f.cutH;
      return {
        w: W, h: H,
        parts: [
          { type: 'poly', points: [[0, 0], [W, 0], [W, H - ch], [W - cw, H - ch], [W - cw, H], [0, H]] },
          label(W / 2, 0, f.labelW, 'middle', 0, -12),
          label(0, H / 2, f.labelH, 'end', -10, 0),
          label(W - cw / 2, H - ch, f.labelCutW, 'middle', 0, -10),
          label(W - cw, H - ch / 2, f.labelCutH, 'end', -6, 0)
        ]
      };
    },

    box: function (f) {
      const dz = depthOffset(f.d, f.w);
      return {
        w: f.w + dz, h: f.h + dz,
        parts: [
          { type: 'poly', points: [[0, dz], [f.w, dz], [f.w, dz + f.h], [0, dz + f.h]] },
          { type: 'poly', points: [[0, dz], [dz, 0], [f.w + dz, 0], [f.w, dz]] },
          { type: 'poly', points: [[f.w, dz], [f.w + dz, 0], [f.w + dz, f.h], [f.w, dz + f.h]] },
          label(f.w / 2, dz + f.h, f.labelW, 'middle', 0, 18),
          label(f.w + dz, dz / 2 + f.h / 2, f.labelH, 'start', 8, 0),
          label(dz / 2, dz / 2, f.labelD, 'end', -6, -4)
        ]
      };
    },

    cylinder: function (f) {
      const ry = Math.max(f.r * 0.34, 0.6);
      return {
        w: f.r * 2, h: f.h + ry * 2,
        parts: [
          { type: 'ellipse', cx: f.r, cy: ry + f.h, rx: f.r, ry: ry },
          { type: 'poly', points: [[0, ry], [f.r * 2, ry], [f.r * 2, ry + f.h], [0, ry + f.h]] },
          { type: 'ellipse', cx: f.r, cy: ry, rx: f.r, ry: ry },
          { type: 'line', x1: f.r, y1: ry, x2: f.r * 2, y2: ry },
          label(f.r * 1.5, ry, f.labelR, 'middle', 0, -12),
          label(f.r * 2, ry + f.h / 2, f.labelH, 'start', 8, 0)
        ]
      };
    },

    /*
     * 食塩水の ビーカー。入れものを 横に ならべ、間に ＋ や → を 置く。
     * 液面の 高さは 「いちばん 重い ものを 1」と した ときの 割合で 決め、
     * 塗りの こさは 濃度で 決める。だから 「うすい 400g」と 「濃い 100g」の
     * ちがいが、数字を 読む 前に 目で わかる。
     */
    beakers: function (f) {
      const W = 3, H = 4, GAP = 1.7;
      const items = f.items || [];
      const ops = f.ops || [];
      const amounts = items.map((it) => it.amount || 0).filter((a) => a > 0);
      const maxAmount = amounts.length ? Math.max.apply(null, amounts) : 1;
      const parts = [];

      items.forEach(function (item, i) {
        const x = i * (W + GAP);

        if (item.type === 'salt') {
          parts.push({ type: 'poly', klass: 'shape', fillOpacity: 0.45,
            points: [[x + 0.5, H], [x + 1.5, H - 1.3], [x + 2.5, H]] });
          parts.push({ type: 'line', klass: 'edge', x1: x + 0.2, y1: H, x2: x + 2.8, y2: H });
          parts.push({ type: 'ellipse', klass: 'shape', fillOpacity: 0.8, cx: x + 1.5, cy: H - 0.55, rx: 0.09, ry: 0.09 });
          parts.push({ type: 'ellipse', klass: 'shape', fillOpacity: 0.8, cx: x + 1.1, cy: H - 0.25, rx: 0.09, ry: 0.09 });
          parts.push({ type: 'ellipse', klass: 'shape', fillOpacity: 0.8, cx: x + 1.9, cy: H - 0.3, rx: 0.09, ry: 0.09 });
        } else {
          const level = item.amount ? 0.3 + 0.55 * (item.amount / maxAmount) : 0.6;
          const surface = H * (1 - level);
          // 濃度 0〜30% を 塗りの こさ 0.15〜0.75 に わりあてる。
          // 幅を 広く とらないと、暗い画面で ちがいが 見えない。
          const strength = 0.15 + Math.min(item.percent == null ? 10 : item.percent, 30) / 30 * 0.6;
          parts.push({ type: 'poly', klass: 'shape', fillOpacity: item.type === 'water' ? 0.07 : strength,
            points: [[x, surface], [x + W, surface], [x + W, H], [x, H]] });
          // ガラス。上は 開けておく (ふたを しない)
          parts.push({ type: 'line', klass: 'edge', x1: x, y1: 0, x2: x, y2: H });
          parts.push({ type: 'line', klass: 'edge', x1: x, y1: H, x2: x + W, y2: H });
          parts.push({ type: 'line', klass: 'edge', x1: x + W, y1: 0, x2: x + W, y2: H });
          // 目もり
          [0.3, 0.5, 0.7].forEach(function (t) {
            parts.push({ type: 'line', klass: 'edge', x1: x, y1: H * t, x2: x + 0.4, y2: H * t });
          });
        }

        if (item.top) parts.push(label(x + W / 2, 0, item.top, 'middle', 0, -10));
        if (item.bottom) parts.push(label(x + W / 2, H, item.bottom, 'middle', 0, 18));

        const op = ops[i];
        if (op && i < items.length - 1) {
          const mark = label(x + W + GAP / 2, H * 0.55, op);
          mark.size = 20;
          parts.push(mark);
        }
      });

      return { w: items.length * W + Math.max(0, items.length - 1) * GAP, h: H, parts: parts };
    },

    prism: function (f) {
      const dz = depthOffset(f.len, f.base);
      const b = f.base, th = f.height;
      const apex = b * 0.35;
      const front = [[0, dz + th], [b, dz + th], [apex, dz]];
      const back = front.map((p) => [p[0] + dz, p[1] - dz]);
      return {
        w: b + dz, h: th + dz,
        parts: [
          { type: 'poly', points: back, klass: 'edge' },
          { type: 'line', x1: front[0][0], y1: front[0][1], x2: back[0][0], y2: back[0][1], klass: 'edge' },
          { type: 'line', x1: front[1][0], y1: front[1][1], x2: back[1][0], y2: back[1][1], klass: 'edge' },
          { type: 'line', x1: front[2][0], y1: front[2][1], x2: back[2][0], y2: back[2][1], klass: 'edge' },
          { type: 'poly', points: front },
          { type: 'line', x1: apex, y1: dz, x2: apex, y2: dz + th },
          label(b / 2, dz + th, f.labelBase, 'middle', 0, 18),
          label(apex, dz + th / 2, f.labelHeight, 'start', 8, 0),
          label((b + b + dz) / 2, (dz + th + th) / 2, f.labelLen, 'start', 8, 6)
        ]
      };
    }
  };

  /* ================================================================
   * 画面の 中身
   * ============================================================== */

  const els = {
    stage: $('stage'),
    quizTop: $('quizTop'),
    quizBottom: $('quizBottom'),
    progress: $('progress'),
    btnQuit: $('btnQuit'),
    home: $('homeScreen'),
    quiz: $('quizScreen'),
    result: $('resultScreen'),
    levelPicker: $('levelPicker'),
    topicPicker: $('topicPicker'),
    countPicker: $('countPicker'),
    btnAllTopics: $('btnAllTopics'),
    btnStart: $('btnStart'),
    startHint: $('startHint'),
    statsPanel: $('statsPanel'),
    statsList: $('statsList'),
    btnClearStats: $('btnClearStats'),
    barFill: $('barFill'),
    qTopic: $('qTopic'),
    qLevel: $('qLevel'),
    question: $('question'),
    figure: $('figure'),
    answerBox: $('answerBox'),
    answerText: $('answerText'),
    answerUnit: $('answerUnit'),
    answerHint: $('answerHint'),
    judge: $('judge'),
    solution: $('solution'),
    keypad: $('keypad'),
    btnSubmit: $('btnSubmit'),
    btnNext: $('btnNext'),
    scoreFace: $('scoreFace'),
    scoreBig: $('scoreBig'),
    scoreLine: $('scoreLine'),
    wrongList: $('wrongList'),
    btnRetryWrong: $('btnRetryWrong'),
    btnAgain: $('btnAgain'),
    btnHome: $('btnHome')
  };

  const COUNTS = [5, 10, 20];

  const state = {
    screen: 'home',
    level: 1,
    count: 10,
    topics: [],                          // えらんでいる ジャンル (最初は から)
    quiz: [],
    index: 0,
    input: '',
    judged: null,                        // 'ok' | 'ng' | null (まだ 答えていない)
    results: [],
    stats: null
  };

  /* ---------------------------------------------------------------
   * きろく (localStorage への 書き込みは 1 セットの おわりに 1 回だけ)
   * ------------------------------------------------------------- */

  function loadStats() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (data && data.topics) return data;
    } catch (e) { /* こわれていても 気にしない */ }
    return { topics: {}, plays: 0 };
  }

  function saveStats() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state.stats)); } catch (e) { /* 保存できなくても 遊べる */ }
  }

  function recordResults() {
    const stats = state.stats;
    stats.plays = (stats.plays || 0) + 1;
    for (const r of state.results) {
      const row = stats.topics[r.problem.topic] || (stats.topics[r.problem.topic] = { tried: 0, correct: 0 });
      row.tried++;
      if (r.correct) row.correct++;
    }
    saveStats();      // ここ 1 回だけ。1 問ごとに 書くと 操作が つまる
  }

  function renderStats() {
    const rows = C.TOPICS.filter((t) => state.stats.topics[t.id] && state.stats.topics[t.id].tried > 0);
    els.statsPanel.hidden = rows.length === 0;
    clear(els.statsList);
    for (const topic of rows) {
      const data = state.stats.topics[topic.id];
      const rate = Math.round(data.correct / data.tried * 100);
      const row = el('div', 'stat-row');
      row.appendChild(el('span', 'stat-name', topic.emoji + ' ' + topic.name));
      const bar = el('div', 'stat-bar');
      const fill = el('div', 'stat-fill');
      fill.style.width = rate + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('span', 'stat-num', `${data.correct}/${data.tried}`));
      els.statsList.appendChild(row);
    }
  }

  /* ---------------------------------------------------------------
   * ホーム
   * ------------------------------------------------------------- */

  function chip(mainText, subText, onClick) {
    const button = el('button', 'chip');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.appendChild(el('span', 'chip-main', mainText));
    if (subText) button.appendChild(el('span', 'chip-sub', subText));
    button.addEventListener('click', onClick);
    return button;
  }

  function buildHome() {
    C.LEVELS.forEach((level) => {
      const button = chip(level.name, level.hint, () => { state.level = level.id; syncHome(); });
      button.dataset.level = String(level.id);
      els.levelPicker.appendChild(button);
    });

    C.TOPICS.forEach((topic) => {
      const button = chip(topic.emoji + ' ' + topic.name, topic.desc, () => {
        const i = state.topics.indexOf(topic.id);
        if (i >= 0) state.topics.splice(i, 1); else state.topics.push(topic.id);
        syncHome();
      });
      button.dataset.topic = topic.id;
      els.topicPicker.appendChild(button);
    });

    COUNTS.forEach((count) => {
      const button = chip(count + ' 問', null, () => { state.count = count; syncHome(); });
      button.dataset.count = String(count);
      els.countPicker.appendChild(button);
    });
  }

  function syncHome() {
    els.levelPicker.querySelectorAll('.chip').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.level) === state.level));
    });
    els.topicPicker.querySelectorAll('.chip').forEach((b) => {
      b.setAttribute('aria-pressed', String(state.topics.indexOf(b.dataset.topic) >= 0));
    });
    els.countPicker.querySelectorAll('.chip').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.count) === state.count));
    });
    // ジャンルを えらぶまでは 始められない
    els.btnStart.disabled = state.topics.length === 0;
    els.startHint.hidden = state.topics.length > 0;
    renderStats();
  }

  /* ---------------------------------------------------------------
   * 画面の きりかえ
   * ------------------------------------------------------------- */

  function showScreen(name) {
    state.screen = name;
    els.home.hidden = name !== 'home';
    els.quiz.hidden = name !== 'quiz';
    els.result.hidden = name !== 'result';
    els.btnQuit.hidden = name !== 'quiz';
    els.progress.hidden = name !== 'quiz';
    els.stage.scrollTop = 0;
  }

  function goHome() {
    showScreen('home');
    syncHome();
  }

  /* ---------------------------------------------------------------
   * 出題
   * ------------------------------------------------------------- */

  function startQuiz(problems) {
    if (!problems && !state.topics.length) return;      // ジャンル未えらび
    state.quiz = problems || C.makeQuiz({
      topics: state.topics.slice(),
      level: state.level,
      count: state.count
    });
    state.index = 0;
    state.results = [];
    showScreen('quiz');
    showProblem();
  }

  function current() { return state.quiz[state.index]; }

  function showProblem() {
    const problem = current();
    state.input = '';
    state.judged = null;

    els.progress.textContent = `${state.index + 1} / ${state.quiz.length}`;
    els.barFill.style.width = (state.index / state.quiz.length * 100) + '%';
    els.qTopic.textContent = problem.topicName;
    els.qLevel.textContent = (C.LEVELS[problem.level - 1] || {}).name || '';

    renderRich(els.question, problem.question);

    clear(els.figure);
    const svg = figureSVG(problem.figure);
    if (svg) els.figure.appendChild(svg);
    els.figure.hidden = !svg;

    els.answerUnit.textContent = problem.unit || '';
    const isFraction = problem.answer.type === 'fraction';
    els.answerHint.hidden = !isFraction;
    els.answerHint.textContent = isFraction ? '分数は 3/4 のように 書きます' : '';

    els.judge.hidden = true;
    els.quizBottom.classList.remove('is-ok', 'is-ng');
    els.solution.hidden = true;
    els.keypad.hidden = false;
    els.btnSubmit.hidden = false;
    els.btnNext.hidden = true;
    els.quizTop.scrollTop = 0;
    renderAnswer();
  }

  function renderAnswer() {
    els.answerText.textContent = state.input;
    els.answerBox.classList.toggle('is-ok', state.judged === 'ok');
    els.answerBox.classList.toggle('is-ng', state.judged === 'ng');
  }

  /** テンキーからの 入力。おかしな 並びは そもそも 入れない。 */
  function typeKey(key) {
    if (state.judged) return;                       // 答え合わせの あとは 変えない
    const value = state.input;
    if (key === 'back') state.input = value.slice(0, -1);
    else if (key === 'clear') state.input = '';
    else if (key === 'sign') state.input = value.charAt(0) === '-' ? value.slice(1) : '-' + value;
    else if (key === 'dot') {
      const tail = value.split('/').pop();
      if (tail.indexOf('.') < 0 && tail.length) state.input = value + '.';
    } else if (key === 'slash') {
      if (value.indexOf('/') < 0 && value.indexOf('.') < 0 && /\d$/.test(value)) state.input = value + '/';
    } else if (/^\d$/.test(key)) {
      if (value.replace(/\D/g, '').length < 9) state.input = value + key;
    }
    renderAnswer();
  }

  function showJudge(kind, text) {
    els.judge.hidden = false;
    els.judge.className = 'judge is-' + kind;
    // せいかい・ざんねん は 下の パネルごと 色を 変える (「おしい!」は 変えない)
    els.quizBottom.classList.toggle('is-ok', kind === 'ok');
    els.quizBottom.classList.toggle('is-ng', kind === 'ng');
    renderRich(els.judge, text);
  }

  function showSolution(problem) {
    clear(els.solution);
    els.solution.hidden = false;
    els.solution.appendChild(el('h3', null, 'とき方'));
    const list = el('ol');
    for (const step of problem.steps) {
      const item = el('li');
      renderRich(item, step);
      list.appendChild(item);
    }
    els.solution.appendChild(list);
  }

  function submit() {
    if (state.judged) return;
    const problem = current();
    const result = C.judge(problem, state.input);

    if (!result.ok) {
      showJudge('hint', 'すうじを 入れてね。');
      return;
    }
    // 「値は 合っているけれど 書き方が おしい」ときは、まだ ×に しないで やり直す
    if (result.reason === 'unreduced') {
      showJudge('hint', 'おしい! 約分 できるよ。');
      return;
    }
    if (result.reason === 'needFraction') {
      showJudge('hint', 'おしい! 分数で 答えてね。');
      return;
    }

    state.judged = result.correct ? 'ok' : 'ng';
    state.results.push({ problem: problem, input: state.input, correct: result.correct });

    if (result.correct) showJudge('ok', 'せいかい！ 🎉');
    else showJudge('ng', 'ざんねん… こたえは ' + problem.answerLabel + (problem.unit || ''));

    showSolution(problem);
    els.keypad.hidden = true;          // 答え合わせの あとは もう 使わない。とき方に 場所を ゆずる
    els.btnSubmit.hidden = true;
    els.btnNext.hidden = false;
    els.btnNext.textContent = state.index + 1 < state.quiz.length ? 'つぎへ' : 'けっかを みる';
    renderAnswer();
    els.quizTop.scrollTop = els.quizTop.scrollHeight;   // とき方まで 送る
  }

  function next() {
    if (!state.judged) return;
    if (state.index + 1 < state.quiz.length) {
      state.index++;
      showProblem();
      return;
    }
    finish();
  }

  /* ---------------------------------------------------------------
   * けっか
   * ------------------------------------------------------------- */

  function finish() {
    recordResults();

    const correct = state.results.filter((r) => r.correct).length;
    const total = state.results.length;
    const rate = total ? correct / total : 0;

    els.scoreFace.textContent = rate === 1 ? '💮' : rate >= 0.8 ? '😄' : rate >= 0.5 ? '🙂' : '💪';
    els.scoreBig.textContent = `${correct} / ${total}`;
    els.scoreLine.textContent = rate === 1 ? 'ぜんもん せいかい！' :
      rate >= 0.8 ? 'よく できました！' :
        rate >= 0.5 ? 'あと すこし！' : 'とき方を 見て、もう いちど やってみよう。';

    const wrong = state.results.filter((r) => !r.correct);
    clear(els.wrongList);
    for (const r of wrong) {
      const item = el('div', 'wrong-item');
      const q = el('div');
      renderRich(q, r.problem.question);
      item.appendChild(q);
      const answer = el('div', 'wrong-answer');
      answer.appendChild(document.createTextNode('こたえ: '));
      const strong = el('b');
      renderRich(strong, r.problem.answerLabel + (r.problem.unit || ''));
      answer.appendChild(strong);
      item.appendChild(answer);
      els.wrongList.appendChild(item);
    }
    els.btnRetryWrong.hidden = wrong.length === 0;
    els.btnRetryWrong.dataset.count = String(wrong.length);

    showScreen('result');
  }

  function retryWrong() {
    const wrong = state.results.filter((r) => !r.correct).map((r, i) => {
      const copy = Object.assign({}, r.problem);
      copy.index = i;
      return copy;
    });
    if (wrong.length) startQuiz(wrong);
  }

  /* ---------------------------------------------------------------
   * テンキー
   * ------------------------------------------------------------- */

  // 3 行 × 5 列。4 行の 電卓型より 60px ほど 低く なり、
  // そのぶん 問題文と 図に 場所を まわせる (小さい 画面で ここが 効く)。
  const KEYS = [
    ['1', '2', '3', '4', '5'],
    ['6', '7', '8', '9', '0'],
    ['dot', 'slash', 'sign', 'clear', 'back']
  ];
  const KEY_LABEL = { back: '⌫', clear: 'C', slash: '/', dot: '.', sign: '±' };
  const KEY_TITLE = { back: '1 文字 けす', clear: 'ぜんぶ けす', slash: '分数の せん', dot: '小数点', sign: 'プラスと マイナスを 入れかえる' };

  function buildKeypad() {
    for (const row of KEYS) {
      for (const key of row) {
        if (key === null) { els.keypad.appendChild(el('span')); continue; }
        const button = el('button', /^\d$/.test(key) ? 'key' : 'key key-fn', KEY_LABEL[key] || key);
        button.type = 'button';
        button.dataset.key = key;
        if (KEY_TITLE[key]) button.setAttribute('aria-label', KEY_TITLE[key]);
        button.addEventListener('click', () => typeKey(key));
        els.keypad.appendChild(button);
      }
    }
  }

  /* ---------------------------------------------------------------
   * はじめる
   * ------------------------------------------------------------- */

  function main() {
    state.stats = loadStats();
    buildHome();
    buildKeypad();
    syncHome();

    els.btnStart.addEventListener('click', () => startQuiz(null));
    els.btnAllTopics.addEventListener('click', () => {
      state.topics = state.topics.length === C.TOPICS.length ? [] : C.TOPICS.map((t) => t.id);
      syncHome();
    });
    els.btnSubmit.addEventListener('click', submit);
    els.btnNext.addEventListener('click', next);
    els.btnQuit.addEventListener('click', goHome);
    els.btnHome.addEventListener('click', goHome);
    els.btnAgain.addEventListener('click', () => startQuiz(null));
    els.btnRetryWrong.addEventListener('click', retryWrong);
    els.btnClearStats.addEventListener('click', () => {
      state.stats = { topics: {}, plays: 0 };
      saveStats();
      syncHome();
    });

    // パソコンの キーボードでも 打てるように する
    document.addEventListener('keydown', (event) => {
      if (state.screen !== 'quiz') return;
      const key = event.key;
      if (/^\d$/.test(key)) { typeKey(key); event.preventDefault(); }
      else if (key === '.') { typeKey('dot'); event.preventDefault(); }
      else if (key === '/') { typeKey('slash'); event.preventDefault(); }
      else if (key === '-') { typeKey('sign'); event.preventDefault(); }
      else if (key === 'Backspace') { typeKey('back'); event.preventDefault(); }
      else if (key === 'Enter') { (state.judged ? next : submit)(); event.preventDefault(); }
      else if (key === 'Escape') { goHome(); event.preventDefault(); }
    });

    showScreen('home');

    // 自動テストから 中を のぞく ための 入口
    window.__app = {
      state: function () { return state; },
      current: current,
      start: startQuiz,
      submit: submit,
      next: next,
      type: typeKey,
      typeAll: function (text) { for (const ch of String(text)) typeKey(ch === '.' ? 'dot' : ch === '/' ? 'slash' : ch === '-' ? 'sign' : ch); },
      home: goHome,
      figureSVG: figureSVG
    };
  }

  main();
})();
