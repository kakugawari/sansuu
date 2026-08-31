/*!
 * core.js — 出題と採点のロジック。DOM を触らないので node でテストできる。
 *
 * ブラウザでは <script> で読み込むと window.Core になり、
 * node からは require() できる。
 *
 * 【この作りの肝】
 * 問題は「答えから逆算して」作る。たとえば食塩水なら、先に濃度と食塩の量を
 * 決めてから全体の量を出す。こうすると、割り切れない・答えが小数だらけ、
 * といった事故が起こりようがない。core.test.js は全ジャンル・全レベルを
 * たくさんの seed で回し、答えがきれいな数になっていることを毎回確かめる。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Core = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PI = 3.14; // 小学校で使う円周率

  /* ================================================================
   * 乱数と小道具
   * ============================================================== */

  /** 決まった順番で数を出す乱数 (mulberry32)。同じ seed からは同じ問題が出る。 */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 配列をその場で混ぜる。rng を渡せば結果を再現できる。 */
  function shuffle(array, rng) {
    const random = rng || Math.random;
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const t = array[i];
      array[i] = array[j];
      array[j] = t;
    }
    return array;
  }

  /** min 以上 max 以下の整数 */
  function randInt(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  /** 配列から 1 つ選ぶ */
  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a;
  }

  function lcm(a, b) { return Math.abs(a * b) / (gcd(a, b) || 1); }

  /** 小数の誤差をならして丸める */
  function round(x, digits) {
    const f = Math.pow(10, digits || 0);
    return Math.round((x + (x >= 0 ? 1 : -1) * Number.EPSILON * Math.abs(x)) * f) / f;
  }

  /** 表示用の数字。末尾の 0 は落とす (28.20 → 28.2) */
  function fmt(x) {
    const s = String(round(x, 6));
    return s;
  }

  function reduceFrac(n, d) {
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d) || 1;
    return { num: n / g, den: d / g };
  }

  /* ================================================================
   * 答えの形
   *   number   … 数値。decimals は「そこまでの桁で割り切れる」ことの記録
   *   fraction … 分数。約分済みで持つ
   * ============================================================== */

  function numAns(value, decimals) {
    const d = decimals || 0;
    return { type: 'number', value: round(value, d), decimals: d };
  }

  function fracAns(n, d) {
    const r = reduceFrac(n, d);
    return { type: 'fraction', num: r.num, den: r.den, value: r.num / r.den };
  }

  /** 答えを文字にする ("3/4" や "28.26")。入力欄にそのまま打てる形。 */
  function answerText(answer) {
    if (answer.type === 'fraction') {
      return answer.den === 1 ? String(answer.num) : answer.num + '/' + answer.den;
    }
    return fmt(answer.value);
  }

  /** 画面用の答え。分数は {{3/4}} という印をつけて返す (app.js が縦書きに直す) */
  function answerLabel(answer) {
    if (answer.type === 'fraction' && answer.den !== 1) {
      return '{{' + answer.num + '/' + answer.den + '}}';
    }
    return answerText(answer);
  }

  /** 全角で打たれても読めるようにする */
  function toHalfWidth(text) {
    return String(text == null ? '' : text)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[．。]/g, '.')
      .replace(/[／]/g, '/')
      .replace(/[－ー−―‐]/g, '-')
      .replace(/[，、,]/g, '');
  }

  /**
   * 打たれた文字を数として読む。
   * "3/4" は分数、"0.5" は数、空や記号だけは ok:false。
   */
  function parseInput(text) {
    const s = toHalfWidth(text).replace(/\s/g, '').replace(/[%％]/g, '');
    if (!s) return { ok: false, reason: 'empty' };

    let m = s.match(/^(-?\d+)\/(\d+)$/);
    if (m) {
      const den = Number(m[2]);
      if (den === 0) return { ok: false, reason: 'zero' };
      const n = Number(m[1]);
      return { ok: true, kind: 'fraction', num: n, den: den, value: n / den };
    }

    m = s.match(/^-?(\d+(\.\d+)?|\.\d+)$/);
    if (m) return { ok: true, kind: 'number', value: Number(s) };

    return { ok: false, reason: 'format' };
  }

  const NEAR = 1e-9;

  /**
   * 採点する。
   *   correct         … 正解
   *   reason:'unreduced'   … 値は合っているが約分していない
   *   reason:'needFraction'… 分数で答える問題を小数で答えた
   */
  function judge(problem, text) {
    const input = parseInput(text);
    if (!input.ok) return { ok: false, correct: false, reason: input.reason };
    const a = problem.answer;

    if (a.type === 'fraction') {
      if (input.kind === 'fraction') {
        if (input.num * a.den === a.num * input.den) {
          const r = reduceFrac(input.num, input.den);
          if (r.num === input.num && r.den === input.den) return { ok: true, correct: true };
          return { ok: true, correct: false, reason: 'unreduced' };
        }
        return { ok: true, correct: false };
      }
      if (Math.abs(input.value - a.value) < NEAR) {
        if (a.den === 1) return { ok: true, correct: true };
        return { ok: true, correct: false, reason: 'needFraction' };
      }
      return { ok: true, correct: false };
    }

    if (Math.abs(input.value - a.value) < NEAR) return { ok: true, correct: true };
    return { ok: true, correct: false };
  }

  /* ================================================================
   * 問題を作る道具
   * ============================================================== */

  /** 問題文の中の分数。app.js が {{3/4}} を縦書きの分数に直す。 */
  function fracTok(n, d) { return '{{' + n + '/' + d + '}}'; }
  /** 帯分数 {{2 1/3}} */
  function mixedTok(w, n, d) { return '{{' + w + ' ' + n + '/' + d + '}}'; }

  const NAMES = ['あきら', 'ゆい', 'そうた', 'みなみ', 'はると', 'さくら', 'けんと', 'ひなた'];

  /* ---------------------------------------------------------------
   * 面積
   * ------------------------------------------------------------- */

  function areaL1(rng) {
    switch (pick(rng, ['rect', 'square', 'back'])) {
      case 'rect': {
        const w = randInt(rng, 3, 12), h = randInt(rng, 2, 10);
        return {
          question: `たて ${h}cm、よこ ${w}cm の 長方形の 面積は 何 cm² ですか。`,
          figure: { kind: 'rect', w: w, h: h, labelTop: w + 'cm', labelLeft: h + 'cm' },
          answer: numAns(w * h), unit: 'cm²',
          steps: ['長方形の面積 = たて × よこ', `${h} × ${w} = ${w * h}`]
        };
      }
      case 'square': {
        const s = randInt(rng, 3, 15);
        return {
          question: `1 辺が ${s}cm の 正方形の 面積は 何 cm² ですか。`,
          figure: { kind: 'rect', w: s, h: s, labelTop: s + 'cm', labelLeft: s + 'cm' },
          answer: numAns(s * s), unit: 'cm²',
          steps: ['正方形の面積 = 1辺 × 1辺', `${s} × ${s} = ${s * s}`]
        };
      }
      default: {
        const w = randInt(rng, 3, 12), h = randInt(rng, 2, 9);
        return {
          question: `面積が ${w * h}cm² の 長方形が あります。たてが ${h}cm の とき、よこは 何 cm ですか。`,
          figure: { kind: 'rect', w: w, h: h, labelTop: '?', labelLeft: h + 'cm', inside: w * h + 'cm²' },
          answer: numAns(w), unit: 'cm',
          steps: ['よこ = 面積 ÷ たて', `${w * h} ÷ ${h} = ${w}`]
        };
      }
    }
  }

  function areaL2(rng) {
    switch (pick(rng, ['tri', 'para', 'trapezoid'])) {
      case 'tri': {
        let b = randInt(rng, 3, 14), h = randInt(rng, 2, 12);
        if ((b * h) % 2 === 1) h += 1;               // 答えを整数にする
        return {
          question: `底辺が ${b}cm、高さが ${h}cm の 三角形の 面積は 何 cm² ですか。`,
          figure: { kind: 'tri', base: b, height: h, labelBase: b + 'cm', labelHeight: h + 'cm' },
          answer: numAns(b * h / 2), unit: 'cm²',
          steps: ['三角形の面積 = 底辺 × 高さ ÷ 2', `${b} × ${h} ÷ 2 = ${b * h / 2}`]
        };
      }
      case 'para': {
        const b = randInt(rng, 3, 13), h = randInt(rng, 2, 11);
        return {
          question: `底辺が ${b}cm、高さが ${h}cm の 平行四辺形の 面積は 何 cm² ですか。`,
          figure: { kind: 'para', base: b, height: h, labelBase: b + 'cm', labelHeight: h + 'cm' },
          answer: numAns(b * h), unit: 'cm²',
          steps: ['平行四辺形の面積 = 底辺 × 高さ', `${b} × ${h} = ${b * h}`]
        };
      }
      default: {
        const a = randInt(rng, 2, 9);
        const b = a + randInt(rng, 1, 7);
        let h = randInt(rng, 2, 10);
        if (((a + b) * h) % 2 === 1) h += 1;
        return {
          question: `上底が ${a}cm、下底が ${b}cm、高さが ${h}cm の 台形の 面積は 何 cm² ですか。`,
          figure: { kind: 'trapezoid', top: a, bottom: b, height: h, labelTop: a + 'cm', labelBottom: b + 'cm', labelHeight: h + 'cm' },
          answer: numAns((a + b) * h / 2), unit: 'cm²',
          steps: ['台形の面積 = (上底 + 下底) × 高さ ÷ 2', `(${a} + ${b}) × ${h} ÷ 2 = ${(a + b) * h / 2}`]
        };
      }
    }
  }

  function areaL3(rng) {
    switch (pick(rng, ['circle', 'lshape', 'triHeight', 'circumference'])) {
      case 'circle': {
        const r = randInt(rng, 2, 12);
        return {
          question: `半径 ${r}cm の 円の 面積は 何 cm² ですか。円周率は 3.14 と します。`,
          figure: { kind: 'circle', r: r, labelR: r + 'cm' },
          answer: numAns(r * r * PI, 2), unit: 'cm²',
          steps: ['円の面積 = 半径 × 半径 × 円周率', `${r} × ${r} × 3.14 = ${fmt(round(r * r * PI, 2))}`]
        };
      }
      case 'circumference': {
        const r = randInt(rng, 2, 15);
        return {
          question: `半径 ${r}cm の 円の 円周の 長さは 何 cm ですか。円周率は 3.14 と します。`,
          figure: { kind: 'circle', r: r, labelR: r + 'cm' },
          answer: numAns(2 * r * PI, 2), unit: 'cm',
          steps: ['円周 = 直径 × 円周率', `${2 * r} × 3.14 = ${fmt(round(2 * r * PI, 2))}`]
        };
      }
      case 'lshape': {
        const W = randInt(rng, 7, 15), H = randInt(rng, 6, 13);
        const cw = randInt(rng, 2, W - 3), ch = randInt(rng, 2, H - 3);
        return {
          question: `図のような L 字型の 土地が あります。面積は 何 cm² ですか。`,
          figure: { kind: 'lshape', W: W, H: H, cutW: cw, cutH: ch, labelW: W + 'cm', labelH: H + 'cm', labelCutW: cw + 'cm', labelCutH: ch + 'cm' },
          answer: numAns(W * H - cw * ch), unit: 'cm²',
          steps: [
            '大きい長方形から、欠けている長方形を ひく',
            `${W} × ${H} = ${W * H}`,
            `${cw} × ${ch} = ${cw * ch}`,
            `${W * H} − ${cw * ch} = ${W * H - cw * ch}`
          ]
        };
      }
      default: {
        const b = randInt(rng, 3, 14);
        const h = randInt(rng, 2, 12);
        const area = b * h / 2;
        return {
          question: `面積が ${fmt(area)}cm²、底辺が ${b}cm の 三角形の 高さは 何 cm ですか。`,
          figure: { kind: 'tri', base: b, height: h, labelBase: b + 'cm', labelHeight: '?', inside: fmt(area) + 'cm²' },
          answer: numAns(h), unit: 'cm',
          steps: ['高さ = 面積 × 2 ÷ 底辺', `${fmt(area)} × 2 ÷ ${b} = ${h}`]
        };
      }
    }
  }

  /* ---------------------------------------------------------------
   * 体積
   * ------------------------------------------------------------- */

  function volumeL1(rng) {
    switch (pick(rng, ['box', 'cube'])) {
      case 'box': {
        const w = randInt(rng, 2, 10), d = randInt(rng, 2, 9), h = randInt(rng, 2, 9);
        return {
          question: `たて ${d}cm、よこ ${w}cm、高さ ${h}cm の 直方体の 体積は 何 cm³ ですか。`,
          figure: { kind: 'box', w: w, d: d, h: h, labelW: w + 'cm', labelD: d + 'cm', labelH: h + 'cm' },
          answer: numAns(w * d * h), unit: 'cm³',
          steps: ['直方体の体積 = たて × よこ × 高さ', `${d} × ${w} × ${h} = ${w * d * h}`]
        };
      }
      default: {
        const s = randInt(rng, 2, 12);
        return {
          question: `1 辺が ${s}cm の 立方体の 体積は 何 cm³ ですか。`,
          figure: { kind: 'box', w: s, d: s, h: s, labelW: s + 'cm', labelD: s + 'cm', labelH: s + 'cm' },
          answer: numAns(s * s * s), unit: 'cm³',
          steps: ['立方体の体積 = 1辺 × 1辺 × 1辺', `${s} × ${s} × ${s} = ${s * s * s}`]
        };
      }
    }
  }

  function volumeL2(rng) {
    switch (pick(rng, ['depth', 'back', 'liters'])) {
      case 'depth': {
        const a = pick(rng, [10, 20, 25, 40, 50]);
        const b = pick(rng, [10, 20, 25, 40, 50]);
        const depth = randInt(rng, 2, 20);
        const cm3 = a * b * depth;
        return {
          question: `たて ${a}cm、よこ ${b}cm の 直方体の 水そうに、水が ${fmt(cm3 / 1000)}L 入って います。水の 深さは 何 cm ですか。`,
          figure: { kind: 'box', w: b, d: a, h: Math.max(depth, 3), labelW: b + 'cm', labelD: a + 'cm', labelH: '?' },
          answer: numAns(depth), unit: 'cm',
          steps: [
            '1L = 1000cm³ なので、まず cm³ に なおす',
            `${fmt(cm3 / 1000)}L = ${cm3}cm³`,
            '深さ = 体積 ÷ (たて × よこ)',
            `${cm3} ÷ (${a} × ${b}) = ${depth}`
          ]
        };
      }
      case 'liters': {
        const a = pick(rng, [10, 20, 30, 40, 50]);
        const b = pick(rng, [10, 20, 30, 40, 50]);
        const h = pick(rng, [10, 20, 25, 30, 40]);
        const cm3 = a * b * h;
        return {
          question: `たて ${a}cm、よこ ${b}cm、高さ ${h}cm の 直方体の 水そうに、いっぱいに 水を 入れます。水は 何 L 入りますか。`,
          figure: { kind: 'box', w: b, d: a, h: h, labelW: b + 'cm', labelD: a + 'cm', labelH: h + 'cm' },
          answer: numAns(cm3 / 1000, 3), unit: 'L',
          steps: [
            `${a} × ${b} × ${h} = ${cm3}cm³`,
            '1000cm³ = 1L',
            `${cm3} ÷ 1000 = ${fmt(cm3 / 1000)}`
          ]
        };
      }
      default: {
        const w = randInt(rng, 2, 10), d = randInt(rng, 2, 9), h = randInt(rng, 2, 9);
        return {
          question: `体積が ${w * d * h}cm³ の 直方体が あります。たてが ${d}cm、よこが ${w}cm の とき、高さは 何 cm ですか。`,
          figure: { kind: 'box', w: w, d: d, h: h, labelW: w + 'cm', labelD: d + 'cm', labelH: '?' },
          answer: numAns(h), unit: 'cm',
          steps: ['高さ = 体積 ÷ (たて × よこ)', `${w * d * h} ÷ (${d} × ${w}) = ${h}`]
        };
      }
    }
  }

  function volumeL3(rng) {
    switch (pick(rng, ['cylinder', 'prism'])) {
      case 'cylinder': {
        const r = randInt(rng, 2, 10), h = randInt(rng, 3, 15);
        const v = r * r * PI * h;
        return {
          question: `底面の 半径が ${r}cm、高さが ${h}cm の 円柱の 体積は 何 cm³ ですか。円周率は 3.14 と します。`,
          figure: { kind: 'cylinder', r: r, h: h, labelR: r + 'cm', labelH: h + 'cm' },
          answer: numAns(v, 2), unit: 'cm³',
          steps: [
            '円柱の体積 = 底面積 × 高さ',
            `底面積 = ${r} × ${r} × 3.14 = ${fmt(round(r * r * PI, 2))}`,
            `${fmt(round(r * r * PI, 2))} × ${h} = ${fmt(round(v, 2))}`
          ]
        };
      }
      default: {
        let b = randInt(rng, 3, 12), th = randInt(rng, 2, 10);
        if ((b * th) % 2 === 1) th += 1;
        const len = randInt(rng, 3, 12);
        const base = b * th / 2;
        return {
          question: `図のような 三角柱の 体積は 何 cm³ ですか。`,
          figure: { kind: 'prism', base: b, height: th, len: len, labelBase: b + 'cm', labelHeight: th + 'cm', labelLen: len + 'cm' },
          answer: numAns(base * len), unit: 'cm³',
          steps: [
            '角柱の体積 = 底面積 × 高さ',
            `底面積 = ${b} × ${th} ÷ 2 = ${fmt(base)}`,
            `${fmt(base)} × ${len} = ${fmt(base * len)}`
          ]
        };
      }
    }
  }

  /* ---------------------------------------------------------------
   * 濃度 (食塩水)
   *
   * 濃度 p% の食塩水 T g に とけている食塩は T×p/100 g。これが整数に
   * なるよう、T は 100/gcd(p,100) の倍数からしか選ばない。
   * ------------------------------------------------------------- */

  const PERCENTS = [4, 5, 8, 10, 12, 15, 20, 25];

  /** 濃度 p% で、食塩の量が整数になる食塩水の重さ */
  function cleanTotal(rng, p, minTotal, maxTotal) {
    const step = 100 / gcd(p, 100);
    const lo = Math.max(1, Math.ceil((minTotal || 50) / step));
    const hi = Math.max(lo, Math.floor((maxTotal || 500) / step));
    return step * randInt(rng, lo, hi);
  }

  function densityL1(rng) {
    const p = pick(rng, PERCENTS);
    const total = cleanTotal(rng, p, 50, 500);
    const salt = total * p / 100;
    const water = total - salt;

    switch (pick(rng, ['toPercent', 'toSalt', 'toWater'])) {
      case 'toPercent':
        return {
          question: `水 ${water}g に 食塩 ${salt}g を とかしました。この 食塩水の 濃度は 何 % ですか。`,
          answer: numAns(p), unit: '%',
          steps: [
            '濃度 = 食塩 ÷ 食塩水全体 × 100',
            `食塩水全体 = ${water} + ${salt} = ${total}`,
            `${salt} ÷ ${total} × 100 = ${p}`
          ]
        };
      case 'toSalt':
        return {
          question: `濃度 ${p}% の 食塩水が ${total}g あります。とけている 食塩は 何 g ですか。`,
          answer: numAns(salt), unit: 'g',
          steps: ['食塩 = 食塩水全体 × 濃度 ÷ 100', `${total} × ${p} ÷ 100 = ${salt}`]
        };
      default:
        return {
          question: `濃度 ${p}% の 食塩水を ${total}g つくります。水は 何 g 必要ですか。`,
          answer: numAns(water), unit: 'g',
          steps: [
            `食塩 = ${total} × ${p} ÷ 100 = ${salt}`,
            `水 = 全体 − 食塩 = ${total} − ${salt} = ${water}`
          ]
        };
    }
  }

  /** 濃い方 → うすい方 の組。食塩の量を lcm にすると 両方の重さが整数になる。 */
  const PERCENT_PAIRS = [[10, 5], [20, 10], [25, 20], [12, 8], [15, 10], [20, 15], [8, 4], [20, 5], [25, 15], [15, 12]];

  function densityL2(rng) {
    const pair = pick(rng, PERCENT_PAIRS);
    const hi = pair[0], lo = pair[1];
    const salt = lcm(hi, lo) * randInt(rng, 1, 2);
    const heavy = salt * 100 / hi;   // 濃い方の重さ
    const light = salt * 100 / lo;   // うすい方の重さ
    const water = light - heavy;

    if (rng() < 0.5) {
      return {
        question: `濃度 ${hi}% の 食塩水 ${heavy}g に、水を ${water}g 加えました。濃度は 何 % に なりますか。`,
        answer: numAns(lo), unit: '%',
        steps: [
          '水を加えても、食塩の量は 変わらない',
          `食塩 = ${heavy} × ${hi} ÷ 100 = ${salt}`,
          `全体 = ${heavy} + ${water} = ${light}`,
          `${salt} ÷ ${light} × 100 = ${lo}`
        ]
      };
    }
    return {
      question: `濃度 ${lo}% の 食塩水 ${light}g を 熱して、水を ${water}g 蒸発させました。濃度は 何 % に なりますか。`,
      answer: numAns(hi), unit: '%',
      steps: [
        '水が 蒸発しても、食塩の量は 変わらない',
        `食塩 = ${light} × ${lo} ÷ 100 = ${salt}`,
        `全体 = ${light} − ${water} = ${heavy}`,
        `${salt} ÷ ${heavy} × 100 = ${hi}`
      ]
    };
  }

  const MIX_RATIOS = [[1, 1], [1, 2], [2, 1], [1, 3], [3, 1], [2, 3], [3, 2]];

  function densityL3(rng) {
    switch (pick(rng, ['mix', 'addWaterAmount', 'addSaltAmount'])) {
      case 'mix': {
        // 先に「混ぜたあとの濃度 p3」を決め、そこから両側の濃度を作る。
        // p1 = p3 + n×t, p2 = p3 − m×t なら、m:n で混ぜた濃度は必ず p3 に なる。
        let m = 1, n = 1, t = 5, p3 = 10;
        for (let i = 0; i < 30; i++) {
          const r = pick(rng, MIX_RATIOS);
          const tt = randInt(rng, 1, 5);
          const pp = randInt(rng, 4, 18);
          if (pp - r[0] * tt >= 2 && pp + r[1] * tt <= 30) { m = r[0]; n = r[1]; t = tt; p3 = pp; break; }
        }
        const p1 = p3 + n * t, p2 = p3 - m * t;
        const k = pick(rng, [100, 200]);
        const A = m * k, B = n * k;
        const s1 = A * p1 / 100, s2 = B * p2 / 100;
        return {
          question: `濃度 ${p1}% の 食塩水 ${A}g と、濃度 ${p2}% の 食塩水 ${B}g を まぜました。濃度は 何 % に なりますか。`,
          answer: numAns(p3), unit: '%',
          steps: [
            'それぞれの 食塩の量を たして、全体の重さで わる',
            `${A} × ${p1} ÷ 100 = ${fmt(s1)}`,
            `${B} × ${p2} ÷ 100 = ${fmt(s2)}`,
            `(${fmt(s1)} + ${fmt(s2)}) ÷ (${A} + ${B}) × 100 = ${p3}`
          ]
        };
      }
      case 'addWaterAmount': {
        const pair = pick(rng, PERCENT_PAIRS);
        const hi = pair[0], lo = pair[1];
        const salt = lcm(hi, lo) * randInt(rng, 1, 2);
        const heavy = salt * 100 / hi;
        const light = salt * 100 / lo;
        return {
          question: `濃度 ${hi}% の 食塩水 ${heavy}g を、濃度 ${lo}% に するには 水を 何 g 加えれば よいですか。`,
          answer: numAns(light - heavy), unit: 'g',
          steps: [
            `食塩 = ${heavy} × ${hi} ÷ 100 = ${salt}`,
            `${lo}% に する とき、全体は ${salt} ÷ ${lo} × 100 = ${light}`,
            `加える水 = ${light} − ${heavy} = ${light - heavy}`
          ]
        };
      }
      default: {
        // 食塩を x g 加えて 濃度を 上げる。x = T×(p2−p1)/(100−p2) が整数に
        // なるよう、T の 刻みを 先に 計算しておく。
        let p1 = 10, p2 = 20;
        for (let i = 0; i < 30; i++) {
          const a = pick(rng, PERCENTS), b = pick(rng, PERCENTS);
          if (b > a) { p1 = a; p2 = b; break; }
        }
        const g = gcd(p2 - p1, 100 - p2);
        const step = lcm((100 - p2) / g, 100 / gcd(p1, 100));
        const kMax = Math.max(1, Math.floor(600 / step));
        const total = step * randInt(rng, 1, kMax);
        const salt = total * p1 / 100;
        const add = total * (p2 - p1) / (100 - p2);
        return {
          question: `濃度 ${p1}% の 食塩水 ${total}g に 食塩を 加えて、濃度 ${p2}% に します。食塩を 何 g 加えれば よいですか。`,
          answer: numAns(add), unit: 'g',
          steps: [
            `いまの食塩 = ${total} × ${p1} ÷ 100 = ${fmt(salt)}`,
            `食塩を x g 加えると (${fmt(salt)} + x) ÷ (${total} + x) = ${p2} ÷ 100`,
            `x = ${fmt(add)}`,
            `たしかめ: (${fmt(salt)} + ${fmt(add)}) ÷ ${fmt(total + add)} × 100 = ${p2}`
          ]
        };
      }
    }
  }

  /* ---------------------------------------------------------------
   * 割合
   * ------------------------------------------------------------- */

  const RATIO_PERCENTS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80];

  function cleanWhole(rng, p, minN, maxN) {
    const step = 100 / gcd(p, 100);
    const lo = Math.max(1, Math.ceil((minN || 20) / step));
    const hi = Math.max(lo, Math.floor((maxN || 400) / step));
    return step * randInt(rng, lo, hi);
  }

  function ratioL1(rng) {
    const p = pick(rng, RATIO_PERCENTS);
    const whole = cleanWhole(rng, p, 20, 400);
    const part = whole * p / 100;

    switch (pick(rng, ['part', 'percent', 'decimal'])) {
      case 'part':
        return {
          question: `${whole} 人の ${p}% は 何人ですか。`,
          answer: numAns(part), unit: '人',
          steps: ['くらべる量 = もとにする量 × 割合', `${whole} × ${p} ÷ 100 = ${part}`]
        };
      case 'percent':
        return {
          question: `${part} 人は ${whole} 人の 何 % ですか。`,
          answer: numAns(p), unit: '%',
          steps: ['割合 = くらべる量 ÷ もとにする量', `${part} ÷ ${whole} × 100 = ${p}`]
        };
      default: {
        const d = p / 100;
        return {
          question: `${fmt(d)} を 百分率で あらわすと 何 % ですか。`,
          answer: numAns(p), unit: '%',
          steps: ['小数を 100 倍すると 百分率に なる', `${fmt(d)} × 100 = ${p}`]
        };
      }
    }
  }

  function ratioL2(rng) {
    switch (pick(rng, ['discountWari', 'discountPercent', 'increase'])) {
      case 'discountWari': {
        const price = 100 * randInt(rng, 3, 50);
        const wari = randInt(rng, 1, 5);
        const paid = price * (10 - wari) / 10;
        return {
          question: `定価 ${price} 円の 品物を ${wari} 割引きで 買いました。代金は 何 円ですか。`,
          answer: numAns(paid), unit: '円',
          steps: [
            `${wari} 割引き = 定価の ${(10 - wari) * 10}%`,
            `${price} × ${(10 - wari) * 10} ÷ 100 = ${paid}`
          ]
        };
      }
      case 'discountPercent': {
        const price = 100 * randInt(rng, 3, 50);
        const p = pick(rng, [5, 10, 15, 20, 25, 30, 40]);
        const paid = price * (100 - p) / 100;
        return {
          question: `定価 ${price} 円の 品物が ${p}% 引きに なって います。代金は 何 円ですか。`,
          answer: numAns(paid), unit: '円',
          steps: [`${p}% 引き = 定価の ${100 - p}%`, `${price} × ${100 - p} ÷ 100 = ${paid}`]
        };
      }
      default: {
        const base = 100 * randInt(rng, 2, 40);
        const p = pick(rng, [5, 10, 15, 20, 25, 30, 50]);
        return {
          question: `${base} 円の ${p}% 増しは 何 円ですか。`,
          answer: numAns(base * (100 + p) / 100), unit: '円',
          steps: [`${p}% 増し = もとの ${100 + p}%`, `${base} × ${100 + p} ÷ 100 = ${base * (100 + p) / 100}`]
        };
      }
    }
  }

  function ratioL3(rng) {
    switch (pick(rng, ['findWhole', 'beforeDiscount', 'buai'])) {
      case 'findWhole': {
        const p = pick(rng, RATIO_PERCENTS);
        const whole = cleanWhole(rng, p, 40, 600);
        const part = whole * p / 100;
        return {
          question: `ある 学校の 生徒の ${p}% が ${part} 人です。生徒は 全部で 何人ですか。`,
          answer: numAns(whole), unit: '人',
          steps: ['もとにする量 = くらべる量 ÷ 割合', `${part} ÷ ${p} × 100 = ${whole}`]
        };
      }
      case 'beforeDiscount': {
        const price = 100 * randInt(rng, 3, 60);
        const p = pick(rng, [10, 20, 25, 30, 40]);
        const paid = price * (100 - p) / 100;
        return {
          question: `${p}% 引きで 買ったら ${paid} 円でした。この 品物の 定価は 何 円ですか。`,
          answer: numAns(price), unit: '円',
          steps: [
            `はらった 代金は 定価の ${100 - p}%`,
            `定価 = ${paid} ÷ ${100 - p} × 100 = ${price}`
          ]
        };
      }
      default: {
        const wari = randInt(rng, 1, 9);
        const bu = randInt(rng, 0, 9);
        const p = wari * 10 + bu;
        const buai = `${wari}割${bu ? bu + '分' : ''}`;
        return {
          question: `${buai} を 百分率で あらわすと 何 % ですか。`,
          answer: numAns(p), unit: '%',
          steps: ['1 割 = 10%、1 分 = 1%', `${buai} = ${p}%`]
        };
      }
    }
  }

  /* ---------------------------------------------------------------
   * 速さ
   * ------------------------------------------------------------- */

  function speedL1(rng) {
    if (rng() < 0.5) {
      const v = randInt(rng, 3, 80), t = randInt(rng, 2, 9);
      return {
        question: `時速 ${v}km で ${t} 時間 走ると、何 km 進みますか。`,
        answer: numAns(v * t), unit: 'km',
        steps: ['道のり = 速さ × 時間', `${v} × ${t} = ${v * t}`]
      };
    }
    const v = pick(rng, [40, 50, 60, 70, 80, 100, 120, 150, 200, 250]);
    const t = randInt(rng, 3, 20);
    return {
      question: `分速 ${v}m で ${t} 分 歩くと、何 m 進みますか。`,
      answer: numAns(v * t), unit: 'm',
      steps: ['道のり = 速さ × 時間', `${v} × ${t} = ${v * t}`]
    };
  }

  function speedL2(rng) {
    switch (pick(rng, ['speed', 'time', 'toHour', 'toMinute'])) {
      case 'speed': {
        const v = randInt(rng, 3, 90), t = randInt(rng, 2, 9);
        return {
          question: `${v * t}km の 道のりを ${t} 時間で 進みました。速さは 時速 何 km ですか。`,
          answer: numAns(v), unit: 'km/時',
          steps: ['速さ = 道のり ÷ 時間', `${v * t} ÷ ${t} = ${v}`]
        };
      }
      case 'time': {
        const v = randInt(rng, 3, 60), t = randInt(rng, 2, 9);
        return {
          question: `${v * t}km の 道のりを 時速 ${v}km で 進むと、何 時間 かかりますか。`,
          answer: numAns(t), unit: '時間',
          steps: ['時間 = 道のり ÷ 速さ', `${v * t} ÷ ${v} = ${t}`]
        };
      }
      case 'toHour': {
        const v = pick(rng, [50, 100, 150, 200, 250, 300, 350, 400]);
        return {
          question: `分速 ${v}m は 時速 何 km ですか。`,
          answer: numAns(v * 60 / 1000, 1), unit: 'km/時',
          steps: [
            `1 時間 = 60 分 なので、${v} × 60 = ${v * 60}m`,
            `1km = 1000m なので、${v * 60} ÷ 1000 = ${fmt(v * 60 / 1000)}`
          ]
        };
      }
      default: {
        const km = pick(rng, [3, 6, 9, 12, 15, 18, 24, 30, 36, 42]);
        return {
          question: `時速 ${km}km は 分速 何 m ですか。`,
          answer: numAns(km * 1000 / 60), unit: 'm/分',
          steps: [
            `${km}km = ${km * 1000}m`,
            `1 時間 = 60 分 なので、${km * 1000} ÷ 60 = ${km * 1000 / 60}`
          ]
        };
      }
    }
  }

  /** 追いつき算。あとから出た人が追いつく時間が 整数に なる 組だけ 使う。 */
  const CATCHUP = [[60, 80, 4], [50, 75, 6], [60, 90, 5], [40, 60, 9], [70, 105, 4],
    [80, 100, 5], [60, 100, 4], [50, 80, 6], [90, 120, 4], [75, 100, 4]];
  /** 往復の平均の速さ 2ab/(a+b) が 整数に なる 組 */
  const ROUNDTRIP = [[30, 60], [20, 30], [40, 60], [12, 24], [10, 15], [20, 80], [45, 90], [24, 40]];

  function speedL3(rng) {
    switch (pick(rng, ['meet', 'catchup', 'roundtrip'])) {
      case 'meet': {
        const a = pick(rng, [50, 60, 70, 80, 90]);
        const b = pick(rng, [40, 50, 60, 70, 100]);
        const t = randInt(rng, 4, 20);
        const d = (a + b) * t;
        const n1 = pick(rng, NAMES), n2 = pick(rng, NAMES.filter((x) => x !== n1));
        return {
          question: `${d}m はなれた 2 地点から、${n1}さんは 分速 ${a}m、${n2}さんは 分速 ${b}m で 向かい合って 同時に 出発しました。2 人が 出会うのは 何 分後ですか。`,
          answer: numAns(t), unit: '分後',
          steps: [
            '2 人は 1 分間に (自分の速さ + 相手の速さ) だけ 近づく',
            `${a} + ${b} = ${a + b}`,
            `${d} ÷ ${a + b} = ${t}`
          ]
        };
      }
      case 'catchup': {
        const c = pick(rng, CATCHUP);
        const a = c[0], b = c[1], k = c[2];
        const t = a * k / (b - a);
        const n1 = pick(rng, NAMES), n2 = pick(rng, NAMES.filter((x) => x !== n1));
        return {
          question: `${n1}さんが 分速 ${a}m で 家を 出ました。${k} 分後に ${n2}さんが 分速 ${b}m で 同じ 道を 追いかけます。${n2}さんが ${n1}さんに 追いつくのは、出発してから 何 分後ですか。`,
          answer: numAns(t), unit: '分後',
          steps: [
            `はじめの 差 = ${a} × ${k} = ${a * k}m`,
            `1 分間に ちぢまる 差 = ${b} − ${a} = ${b - a}m`,
            `${a * k} ÷ ${b - a} = ${t}`
          ]
        };
      }
      default: {
        const r = pick(rng, ROUNDTRIP);
        const a = r[0], b = r[1];
        const d = lcm(a, b) * randInt(rng, 1, 2);
        const ave = 2 * a * b / (a + b);
        return {
          question: `家から ${d}km はなれた 町へ 行くのに、行きは 時速 ${a}km、帰りは 時速 ${b}km で 進みました。往復の 平均の 速さは 時速 何 km ですか。`,
          answer: numAns(ave, 2), unit: 'km/時',
          steps: [
            `行き = ${d} ÷ ${a} = ${fmt(d / a)} 時間、帰り = ${d} ÷ ${b} = ${fmt(d / b)} 時間`,
            `往復の 道のり = ${d * 2}km、かかった 時間 = ${fmt(d / a + d / b)} 時間`,
            `${d * 2} ÷ ${fmt(d / a + d / b)} = ${fmt(ave)}`
          ]
        };
      }
    }
  }

  /* ---------------------------------------------------------------
   * 平均
   * ------------------------------------------------------------- */

  /**
   * 平均が ちょうど mean に なる n 個の 数を つくる。
   * 差を +d と −d の 組で 用意するので、合計は 必ず n×mean に なり、
   * どの数も mean±spread から はみ出さない (0 点や 120 点が 出ない)。
   */
  function spreadAround(rng, n, mean, spread) {
    const diffs = [];
    for (let i = 0; i < Math.floor(n / 2); i++) {
      const d = randInt(rng, 1, spread);
      diffs.push(d, -d);
    }
    if (n % 2 === 1) diffs.push(0);
    shuffle(diffs, rng);
    return diffs.map((d) => mean + d);
  }

  function averageL1(rng) {
    const n = randInt(rng, 4, 6);
    const mean = randInt(rng, 55, 92);
    const values = spreadAround(rng, n, mean, 8);
    return {
      question: `${n} 回の テストの 点数は ${values.join('、')} 点でした。平均は 何 点ですか。`,
      answer: numAns(mean), unit: '点',
      steps: [
        '平均 = 合計 ÷ 個数',
        `${values.join(' + ')} = ${n * mean}`,
        `${n * mean} ÷ ${n} = ${mean}`
      ]
    };
  }

  function averageL2(rng) {
    if (rng() < 0.5) {
      const n = randInt(rng, 3, 5);
      const m1 = randInt(rng, 60, 82);
      // 必要な点は m1 + (n+1)×up。100 点を こえない 範囲でしか 上げない
      const up = randInt(rng, 1, Math.max(1, Math.floor((100 - m1) / (n + 1))));
      const m2 = m1 + up;
      const need = (n + 1) * m2 - n * m1;
      return {
        question: `${n} 回の テストの 平均は ${m1} 点でした。${n + 1} 回目の テストで、平均を ${m2} 点に するには 何 点 とれば よいですか。`,
        answer: numAns(need), unit: '点',
        steps: [
          `いままでの 合計 = ${m1} × ${n} = ${m1 * n}`,
          `ほしい 合計 = ${m2} × ${n + 1} = ${m2 * (n + 1)}`,
          `${m2 * (n + 1)} − ${m1 * n} = ${need}`
        ]
      };
    }
    const n = randInt(rng, 4, 6);
    const mean = randInt(rng, 55, 90);
    const values = spreadAround(rng, n, mean, 7);
    const hidden = values[values.length - 1];
    const shown = values.slice(0, n - 1);
    return {
      question: `${n} 人の テストの 平均は ${mean} 点です。${n - 1} 人の 点数が ${shown.join('、')} 点の とき、のこりの 1 人は 何 点ですか。`,
      answer: numAns(hidden), unit: '点',
      steps: [
        `全体の 合計 = ${mean} × ${n} = ${mean * n}`,
        `わかっている 合計 = ${shown.join(' + ')} = ${shown.reduce((a, b) => a + b, 0)}`,
        `${mean * n} − ${shown.reduce((a, b) => a + b, 0)} = ${hidden}`
      ]
    };
  }

  function averageL3(rng) {
    if (rng() < 0.5) {
      // 男女別の平均から 全体の平均。全体の平均が 整数に なる 組を さがす。
      let a = 20, b = 20, p = 70, q = 80, M = 75;
      for (let i = 0; i < 60; i++) {
        const aa = randInt(rng, 8, 25), bb = randInt(rng, 8, 25);
        const pp = randInt(rng, 55, 90), qq = randInt(rng, 55, 90);
        if (pp === qq) continue;
        const total = aa * pp + bb * qq;
        if (total % (aa + bb) === 0) { a = aa; b = bb; p = pp; q = qq; M = total / (aa + bb); break; }
      }
      return {
        question: `ある クラスの 男子 ${a} 人の 平均は ${p} 点、女子 ${b} 人の 平均は ${q} 点でした。クラス 全体の 平均は 何 点ですか。`,
        answer: numAns(M), unit: '点',
        steps: [
          `男子の 合計 = ${a} × ${p} = ${a * p}`,
          `女子の 合計 = ${b} × ${q} = ${b * q}`,
          `(${a * p} + ${b * q}) ÷ (${a} + ${b}) = ${M}`
        ]
      };
    }
    // wrong ÷ n が 割り切れる 人数だけ 使う (答えが 循環小数に ならない)
    const n = pick(rng, [5, 10, 20, 25]);
    const mean = randInt(rng, 30, 60);
    const wrong = randInt(rng, 2, 9);
    return {
      question: `${n} 人の 平均は ${mean} 点でしたが、1 人の 点数を ${wrong} 点 多く 数えて いました。正しい 平均は 何 点ですか。`,
      answer: numAns(mean - wrong / n, 3), unit: '点',
      steps: [
        `まちがえた 合計 = ${mean} × ${n} = ${mean * n}`,
        `正しい 合計 = ${mean * n} − ${wrong} = ${mean * n - wrong}`,
        `${mean * n - wrong} ÷ ${n} = ${fmt(round((mean * n - wrong) / n, 3))}`
      ]
    };
  }

  /* ---------------------------------------------------------------
   * 分数
   * ------------------------------------------------------------- */

  const DENS = [2, 3, 4, 5, 6, 8, 9, 10, 12];

  /**
   * 分母 d に対して、約分できない 分子を 選ぶ。
   * 問題文に 3/9 のような 「約分できる 分数」を 出さない ための もの。
   */
  function properNum(rng, d) {
    const candidates = [];
    for (let i = 1; i < d; i++) if (gcd(i, d) === 1) candidates.push(i);
    return pick(rng, candidates);
  }

  function fractionL1(rng) {
    const d1 = pick(rng, DENS), d2 = pick(rng, DENS);
    const n1 = properNum(rng, d1), n2 = properNum(rng, d2);
    const den = lcm(d1, d2);                 // 通分は 最小公倍数で
    const a1 = n1 * (den / d1), a2 = n2 * (den / d2);

    if (rng() < 0.5) {
      const num = a1 + a2;
      const reduced = reduceFrac(num, den);
      return {
        question: `${fracTok(n1, d1)} + ${fracTok(n2, d2)} を 計算しましょう。`,
        answer: fracAns(num, den), unit: '',
        steps: [
          d1 === d2 ? '分母が 同じなので、分子を たす' : `分母を ${den} に そろえる`,
          `${fracTok(a1, den)} + ${fracTok(a2, den)} = ${fracTok(num, den)}`,
          reduced.den === den ? 'これ以上 約分できない' : `約分して ${answerLabel(fracAns(num, den))}`
        ]
      };
    }

    // ひき算は 大きい方から 小さい方を ひく (答えが 0 より 大きく なる)
    let hi = { n: a1, d: den, sn: n1, sd: d1 }, lo = { n: a2, d: den, sn: n2, sd: d2 };
    if (a1 < a2) { const t = hi; hi = lo; lo = t; }
    const num = hi.n - lo.n;
    if (num === 0) return fractionL1(rng);    // 同じ数どうしは 出しなおす
    const reduced = reduceFrac(num, den);
    return {
      question: `${fracTok(hi.sn, hi.sd)} − ${fracTok(lo.sn, lo.sd)} を 計算しましょう。`,
      answer: fracAns(num, den), unit: '',
      steps: [
        d1 === d2 ? '分母が 同じなので、分子を ひく' : `分母を ${den} に そろえる`,
        `${fracTok(hi.n, den)} − ${fracTok(lo.n, den)} = ${fracTok(num, den)}`,
        reduced.den === den ? 'これ以上 約分できない' : `約分して ${answerLabel(fracAns(num, den))}`
      ]
    };
  }

  function fractionL2(rng) {
    const d1 = pick(rng, DENS), d2 = pick(rng, DENS);
    const n1 = properNum(rng, d1), n2 = properNum(rng, d2);
    if (rng() < 0.5) {
      return {
        question: `${fracTok(n1, d1)} × ${fracTok(n2, d2)} を 計算しましょう。`,
        answer: fracAns(n1 * n2, d1 * d2), unit: '',
        steps: [
          '分数どうしの かけ算は、分子は 分子どうし、分母は 分母どうし',
          `${fracTok(n1 * n2, d1 * d2)}`,
          `約分して ${answerLabel(fracAns(n1 * n2, d1 * d2))}`
        ]
      };
    }
    return {
      question: `${fracTok(n1, d1)} ÷ ${fracTok(n2, d2)} を 計算しましょう。`,
      answer: fracAns(n1 * d2, d1 * n2), unit: '',
      steps: [
        'わる数を ひっくり返して かける',
        `${fracTok(n1, d1)} × ${fracTok(d2, n2)} = ${fracTok(n1 * d2, d1 * n2)}`,
        `約分して ${answerLabel(fracAns(n1 * d2, d1 * n2))}`
      ]
    };
  }

  function fractionL3(rng) {
    switch (pick(rng, ['missing', 'three', 'mixed'])) {
      case 'missing': {
        const d1 = pick(rng, DENS), d2 = pick(rng, DENS);
        const n1 = properNum(rng, d1), n2 = properNum(rng, d2);
        const den = lcm(d1, d2);
        const sum = reduceFrac(n1 * (den / d1) + n2 * (den / d2), den);
        return {
          question: `□ + ${fracTok(n1, d1)} = ${fracTok(sum.num, sum.den)} の □ に 入る 数は 何ですか。`,
          answer: fracAns(n2, d2), unit: '',
          steps: [
            '□ = 右の数 − 左の数',
            `${fracTok(sum.num, sum.den)} − ${fracTok(n1, d1)} = ${answerLabel(fracAns(n2, d2))}`
          ]
        };
      }
      case 'three': {
        const d1 = pick(rng, DENS), d2 = pick(rng, DENS), d3 = pick(rng, DENS);
        const n1 = properNum(rng, d1), n2 = properNum(rng, d2), n3 = properNum(rng, d3);
        const den = lcm(lcm(d1, d2), d3);
        const a1 = n1 * (den / d1), a2 = n2 * (den / d2), a3 = n3 * (den / d3);
        const num = a1 + a2 + a3;
        const reduced = reduceFrac(num, den);
        return {
          question: `${fracTok(n1, d1)} + ${fracTok(n2, d2)} + ${fracTok(n3, d3)} を 計算しましょう。`,
          answer: fracAns(num, den), unit: '',
          steps: [
            `3 つの 分母の 最小公倍数 ${den} に そろえる`,
            `${fracTok(a1, den)} + ${fracTok(a2, den)} + ${fracTok(a3, den)} = ${fracTok(num, den)}`,
            reduced.den === den ? 'これ以上 約分できない' : `約分して ${answerLabel(fracAns(num, den))}`
          ]
        };
      }
      default: {
        const w1 = randInt(rng, 1, 3), d1 = pick(rng, DENS), n1 = properNum(rng, d1);
        const w2 = randInt(rng, 1, 3), d2 = pick(rng, DENS), n2 = properNum(rng, d2);
        const i1 = w1 * d1 + n1, i2 = w2 * d2 + n2;   // 仮分数に なおす
        const den = lcm(d1, d2);
        const num = i1 * (den / d1) + i2 * (den / d2);
        return {
          question: `${mixedTok(w1, n1, d1)} + ${mixedTok(w2, n2, d2)} を 計算しましょう。答えは 帯分数に せず、分数の ままで 書きましょう。`,
          answer: fracAns(num, den), unit: '',
          steps: [
            `帯分数を 仮分数に なおす: ${mixedTok(w1, n1, d1)} = ${fracTok(i1, d1)}、${mixedTok(w2, n2, d2)} = ${fracTok(i2, d2)}`,
            `分母を ${den} に そろえて たすと ${fracTok(num, den)}`,
            `答え ${answerLabel(fracAns(num, den))}`
          ]
        };
      }
    }
  }

  /* ---------------------------------------------------------------
   * 方程式 (中学)
   * ------------------------------------------------------------- */

  function equationL1(rng) {
    const x = randInt(rng, -9, 12);
    switch (pick(rng, ['add', 'sub', 'mul', 'div'])) {
      case 'add': {
        const a = randInt(rng, 2, 20);
        return {
          question: `x + ${a} = ${x + a} を 解きましょう。`,
          answer: numAns(x), unit: '',
          steps: [`両辺から ${a} を ひく`, `x = ${x + a} − ${a} = ${x}`]
        };
      }
      case 'sub': {
        const a = randInt(rng, 2, 20);
        return {
          question: `x − ${a} = ${x - a} を 解きましょう。`,
          answer: numAns(x), unit: '',
          steps: [`両辺に ${a} を たす`, `x = ${x - a} + ${a} = ${x}`]
        };
      }
      case 'mul': {
        const a = randInt(rng, 2, 9);
        return {
          question: `${a}x = ${a * x} を 解きましょう。`,
          answer: numAns(x), unit: '',
          steps: [`両辺を ${a} で わる`, `x = ${a * x} ÷ ${a} = ${x}`]
        };
      }
      default: {
        const a = randInt(rng, 2, 9);
        return {
          question: `x ÷ ${a} = ${x} を 解きましょう。`,
          answer: numAns(a * x), unit: '',
          steps: [`両辺に ${a} を かける`, `x = ${x} × ${a} = ${a * x}`]
        };
      }
    }
  }

  function equationL2(rng) {
    const x = randInt(rng, -8, 12);
    if (rng() < 0.5) {
      const a = randInt(rng, 2, 9), b = randInt(rng, -12, 15);
      const c = a * x + b;
      return {
        question: `${a}x ${b < 0 ? '− ' + -b : '+ ' + b} = ${c} を 解きましょう。`,
        answer: numAns(x), unit: '',
        steps: [
          `${b < 0 ? '両辺に ' + -b + ' を たす' : '両辺から ' + b + ' を ひく'}`,
          `${a}x = ${a * x}`,
          `x = ${a * x} ÷ ${a} = ${x}`
        ]
      };
    }
    const a = randInt(rng, 3, 9);
    const c = randInt(rng, 1, a - 1);   // 左辺の x の 係数を 大きく して 割り切れる ように する
    const b = randInt(rng, -10, 12);
    const d = (a - c) * x + b;          // a x + b = c x + d に なるよう d を 決める
    return {
      question: `${a}x ${b < 0 ? '− ' + -b : '+ ' + b} = ${c}x ${d < 0 ? '− ' + -d : '+ ' + d} を 解きましょう。`,
      answer: numAns(x), unit: '',
      steps: [
        'x を 左辺に、数を 右辺に あつめる',
        `${a}x − ${c}x = ${d} − ${b}`,
        `${a - c}x = ${(a - c) * x}`,
        `x = ${x}`
      ]
    };
  }

  function equationL3(rng) {
    switch (pick(rng, ['price', 'consecutive', 'ageOrTimes', 'paren'])) {
      case 'price': {
        const unit = 10 * randInt(rng, 5, 30);
        const count = randInt(rng, 2, 6);
        const box = 10 * randInt(rng, 5, 20);
        return {
          question: `1 個 x 円の りんごを ${count} 個 と、${box} 円の かごを 買ったら 代金は ${unit * count + box} 円でした。りんご 1 個の ねだんは 何 円ですか。`,
          answer: numAns(unit), unit: '円',
          steps: [
            `${count}x + ${box} = ${unit * count + box}`,
            `${count}x = ${unit * count}`,
            `x = ${unit}`
          ]
        };
      }
      case 'consecutive': {
        const mid = randInt(rng, 3, 40);
        return {
          question: `連続する 3 つの 整数の 和が ${3 * mid} です。まん中の 数は いくつですか。`,
          answer: numAns(mid), unit: '',
          steps: [
            'まん中を x と おくと (x−1) + x + (x+1) = 3x',
            `3x = ${3 * mid}`,
            `x = ${mid}`
          ]
        };
      }
      case 'ageOrTimes': {
        const times = randInt(rng, 2, 5);
        const small = randInt(rng, 4, 30);
        const total = small * (times + 1);
        return {
          question: `兄の 年れいは 弟の ${times} 倍で、2 人 あわせて ${total} さいです。弟は 何 さいですか。`,
          answer: numAns(small), unit: 'さい',
          steps: [
            `弟を x さい と すると x + ${times}x = ${total}`,
            `${times + 1}x = ${total}`,
            `x = ${small}`
          ]
        };
      }
      default: {
        const x = randInt(rng, -6, 12);
        const a = randInt(rng, 2, 6), b = randInt(rng, -8, 8), c = randInt(rng, 2, 9);
        const right = a * (x + b) + c;
        return {
          question: `${a}(x ${b < 0 ? '− ' + -b : '+ ' + b}) + ${c} = ${right} を 解きましょう。`,
          answer: numAns(x), unit: '',
          steps: [
            'かっこを はずす',
            `${a}x ${a * b < 0 ? '− ' + -(a * b) : '+ ' + a * b} + ${c} = ${right}`,
            `${a}x = ${a * x}`,
            `x = ${x}`
          ]
        };
      }
    }
  }

  /* ================================================================
   * ジャンル一覧と 出題
   * ============================================================== */

  const TOPICS = [
    { id: 'area', name: '面積', emoji: '📐', desc: '長方形・三角形・台形・円' },
    { id: 'volume', name: '体積', emoji: '🧊', desc: '直方体・水そう・円柱' },
    { id: 'density', name: '濃度', emoji: '🧪', desc: '食塩水の こさ' },
    { id: 'ratio', name: '割合', emoji: '💯', desc: '百分率・割引き' },
    { id: 'speed', name: '速さ', emoji: '🚄', desc: '速さ・時間・道のり' },
    { id: 'average', name: '平均', emoji: '📊', desc: '平均と その 逆算' },
    { id: 'fraction', name: '分数', emoji: '🍰', desc: '分数の たし算・かけ算' },
    { id: 'equation', name: '方程式', emoji: '⚖️', desc: '一次方程式と 文章題' }
  ];

  const LEVELS = [
    { id: 1, name: 'やさしい', hint: '小学 4〜5 年' },
    { id: 2, name: 'ふつう', hint: '小学 6 年' },
    { id: 3, name: 'むずかしい', hint: '中学 1〜2 年' }
  ];

  const GENERATORS = {
    area: [areaL1, areaL2, areaL3],
    volume: [volumeL1, volumeL2, volumeL3],
    density: [densityL1, densityL2, densityL3],
    ratio: [ratioL1, ratioL2, ratioL3],
    speed: [speedL1, speedL2, speedL3],
    average: [averageL1, averageL2, averageL3],
    fraction: [fractionL1, fractionL2, fractionL3],
    equation: [equationL1, equationL2, equationL3]
  };

  function topicById(id) {
    for (let i = 0; i < TOPICS.length; i++) if (TOPICS[i].id === id) return TOPICS[i];
    return null;
  }

  /**
   * 問題を 1 問つくる。
   * @param {string} topicId  ジャンル
   * @param {number} level    1〜3
   * @param {function} rng    乱数 (省略時は Math.random)
   */
  function makeProblem(topicId, level, rng) {
    const gens = GENERATORS[topicId];
    if (!gens) throw new Error('知らないジャンル: ' + topicId);
    const lv = Math.min(3, Math.max(1, Math.round(level || 1)));
    const random = rng || Math.random;
    const p = gens[lv - 1](random);
    const topic = topicById(topicId);
    return {
      topic: topicId,
      topicName: topic ? topic.name : topicId,
      level: lv,
      question: p.question,
      figure: p.figure || null,
      answer: p.answer,
      unit: p.unit || '',
      steps: p.steps || [],
      answerText: answerText(p.answer),
      answerLabel: answerLabel(p.answer)
    };
  }

  /**
   * 1 セット分の 問題を つくる。同じ問題文は 出さない。
   * @param {object} opt {topics:[id], level, count, seed}
   */
  function makeQuiz(opt) {
    const options = opt || {};
    const ids = (options.topics && options.topics.length ? options.topics : TOPICS.map((t) => t.id))
      .filter((id) => GENERATORS[id]);
    if (!ids.length) throw new Error('ジャンルが 1 つも ない');
    const count = Math.max(1, options.count || 10);
    const level = options.level || 1;
    const rng = mulberry32(options.seed == null ? (Math.random() * 4294967296) >>> 0 : options.seed);

    const order = [];
    while (order.length < count) {
      const bag = shuffle(ids.slice(), rng);
      for (let i = 0; i < bag.length && order.length < count; i++) order.push(bag[i]);
    }

    const seen = Object.create(null);
    const list = [];
    for (let i = 0; i < order.length; i++) {
      let problem = null;
      for (let tries = 0; tries < 40; tries++) {
        const candidate = makeProblem(order[i], level, rng);
        if (!seen[candidate.question]) { problem = candidate; break; }
      }
      if (!problem) problem = makeProblem(order[i], level, rng); // それでもダメなら 重複を 許す
      seen[problem.question] = true;
      problem.index = list.length;
      list.push(problem);
    }
    return list;
  }

  return {
    PI: PI,
    TOPICS: TOPICS,
    LEVELS: LEVELS,
    mulberry32: mulberry32,
    shuffle: shuffle,
    randInt: randInt,
    pick: pick,
    gcd: gcd,
    lcm: lcm,
    round: round,
    fmt: fmt,
    reduceFrac: reduceFrac,
    numAns: numAns,
    fracAns: fracAns,
    answerText: answerText,
    answerLabel: answerLabel,
    parseInput: parseInput,
    judge: judge,
    topicById: topicById,
    makeProblem: makeProblem,
    makeQuiz: makeQuiz
  };
});
