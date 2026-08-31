/*
 * ロジックのテスト:  npm test
 *
 * ここでいちばん大事なのは「全ジャンル × 全レベルを たくさんの seed で回して、
 * 答えが いつも きれいな数に なるか」を 見張ること。問題は 答えから 逆算して
 * 作って いるので、ここが 通る かぎり 「割り切れない 問題」は 出ない。
 */
const test = require('node:test');
const assert = require('node:assert');
const Core = require('./core.js');

const SEEDS = 400;                       // 1 ジャンル 1 レベルあたり 何回 作るか
const ALL = Core.TOPICS.map((t) => t.id);

/** ジャンル × レベル の 全通りを seed を変えて 作る */
function eachProblem(fn) {
  for (const topic of ALL) {
    for (const level of [1, 2, 3]) {
      for (let s = 0; s < SEEDS; s++) {
        const rng = Core.mulberry32(s * 7919 + level * 131 + topic.length);
        fn(Core.makeProblem(topic, level, rng), topic, level, s);
      }
    }
  }
}

/* ---------------------------------------------------------------- 乱数 */

test('同じ seed からは 同じ問題が 出る', () => {
  const a = Core.makeQuiz({ level: 2, count: 10, seed: 12345 });
  const b = Core.makeQuiz({ level: 2, count: 10, seed: 12345 });
  assert.deepStrictEqual(a.map((p) => p.question), b.map((p) => p.question));
});

test('seed が ちがえば 問題も 変わる', () => {
  const a = Core.makeQuiz({ level: 2, count: 10, seed: 1 });
  const b = Core.makeQuiz({ level: 2, count: 10, seed: 2 });
  assert.notDeepStrictEqual(a.map((p) => p.question), b.map((p) => p.question));
});

/* ---------------------------------------------------------------- 入力を読む */

test('全角の数字・記号でも 読める', () => {
  assert.strictEqual(Core.parseInput('１２３').value, 123);
  assert.strictEqual(Core.parseInput('２８．２６').value, 28.26);
  assert.strictEqual(Core.parseInput('３／４').value, 0.75);
  assert.strictEqual(Core.parseInput('－５').value, -5);
  assert.strictEqual(Core.parseInput(' 12 %').value, 12);
});

test('読めない入力は ok:false', () => {
  for (const bad of ['', '   ', 'abc', '1/2/3', '3/0', '1..2', '+-3']) {
    assert.strictEqual(Core.parseInput(bad).ok, false, `読めては いけない: "${bad}"`);
  }
});

/* ---------------------------------------------------------------- 採点 */

test('正解・不正解を 見分ける', () => {
  const p = { answer: Core.numAns(28.26, 2) };
  assert.strictEqual(Core.judge(p, '28.26').correct, true);
  assert.strictEqual(Core.judge(p, '28.260').correct, true);
  assert.strictEqual(Core.judge(p, '28.3').correct, false);
  assert.strictEqual(Core.judge(p, '').ok, false);
});

test('分数は 約分していないと 正解に しない', () => {
  const p = { answer: Core.fracAns(1, 2) };
  assert.strictEqual(Core.judge(p, '1/2').correct, true);
  assert.strictEqual(Core.judge(p, '2/4').correct, false);
  assert.strictEqual(Core.judge(p, '2/4').reason, 'unreduced');
  assert.strictEqual(Core.judge(p, '0.5').reason, 'needFraction');
  assert.strictEqual(Core.judge(p, '1/3').correct, false);
});

test('答えが 整数に なる 分数は 整数で 答えても 正解', () => {
  const p = { answer: Core.fracAns(6, 3) };
  assert.strictEqual(Core.judge(p, '2').correct, true);
  assert.strictEqual(Core.judge(p, '2/1').correct, true);
});

/* ---------------------------------------------------------------- 問題そのもの */

test('答えは いつも きれいな数に なる', () => {
  eachProblem((p, topic, level, seed) => {
    const where = `${topic} L${level} seed=${seed}: ${p.question}`;
    const a = p.answer;
    assert.ok(Number.isFinite(a.value), '答えが 数に ならない — ' + where);
    if (a.type === 'number') {
      assert.ok(a.decimals <= 3, '小数が 細かすぎる — ' + where);
      assert.strictEqual(Core.round(a.value, a.decimals), a.value, '割り切れない — ' + where);
      if (a.decimals === 0) assert.ok(Number.isInteger(a.value), '整数に ならない — ' + where);
    } else {
      assert.ok(Number.isInteger(a.num) && Number.isInteger(a.den) && a.den > 0, '分数が こわれている — ' + where);
      const r = Core.reduceFrac(a.num, a.den);
      assert.ok(r.num === a.num && r.den === a.den, '約分されていない — ' + where);
      assert.ok(a.den <= 200, '分母が 大きすぎる — ' + where);
    }
  });
});

test('問題文・解説に undefined や NaN が まぎれない', () => {
  eachProblem((p, topic, level, seed) => {
    const where = `${topic} L${level} seed=${seed}`;
    const texts = [p.question].concat(p.steps);
    for (const t of texts) {
      assert.strictEqual(typeof t, 'string', '文字列で ない — ' + where);
      assert.ok(t.length > 0, '空の文 — ' + where);
      assert.ok(!/undefined|NaN|Infinity/.test(t), `こわれた文: ${t} — ${where}`);
      assert.ok(!/\d\.\d{4,}/.test(t), `小数が 細かすぎる: ${t} — ${where}`);
    }
    assert.ok(p.steps.length > 0, '解説が ない — ' + where);
  });
});

test('自分の答えで 採点すると かならず 正解に なる', () => {
  eachProblem((p, topic, level, seed) => {
    const result = Core.judge(p, p.answerText);
    assert.ok(result.correct, `自分の答えが 通らない (${p.answerText}) — ${topic} L${level} seed=${seed}: ${p.question}`);
  });
});

test('答えは かならず テンキーだけで 打てる形に なる', () => {
  // テンキーに あるのは 数字・小数点・分数の せん・符号だけ。
  // 「3.5/2」の ような 打てない 答えが 出たら ここで 止める。
  eachProblem((p, topic, level, seed) => {
    assert.ok(/^-?\d+(\.\d+|\/\d+)?$/.test(p.answerText),
      `テンキーで 打てない 答え: ${p.answerText} — ${topic} L${level} seed=${seed}`);
    assert.ok(p.answerText.replace(/\D/g, '').length <= 9,
      `答えの けたが 多すぎる: ${p.answerText} — ${topic} L${level} seed=${seed}`);
  });
});

test('分数の 書き方 {{a/b}} が こわれていない', () => {
  eachProblem((p) => {
    const found = p.question.match(/\{\{[^}]*\}\}/g) || [];
    for (const token of found) {
      assert.ok(/^\{\{\d+( \d+)?\/\d+\}\}$/.test(token), 'こわれた分数: ' + token + ' — ' + p.question);
    }
  });
});

test('図の 数字は すべて 正の数', () => {
  eachProblem((p, topic, level, seed) => {
    if (!p.figure) return;
    for (const key of Object.keys(p.figure)) {
      const v = p.figure[key];
      if (typeof v === 'number') {
        assert.ok(v > 0 && Number.isFinite(v), `図の ${key} が ${v} — ${topic} L${level} seed=${seed}`);
      }
    }
  });
});

test('単位ごとの 常識はずれを はじく', () => {
  eachProblem((p, topic, level, seed) => {
    const where = `${topic} L${level} seed=${seed}: ${p.question} → ${p.answerText}${p.unit}`;
    const v = p.answer.value;
    if (p.unit === '%') assert.ok(v > 0 && v <= 100, '濃度・割合が 0〜100% に ない — ' + where);
    if (p.unit === '点') assert.ok(v >= 0 && v <= 100, 'テストの点が 0〜100 に ない — ' + where);
    if (['cm', 'cm²', 'cm³', 'g', 'km', 'm', '人', '円', 'L'].includes(p.unit)) {
      assert.ok(v > 0, '長さ・重さ・お金が 0 以下 — ' + where);
    }
    if (p.unit === '分後' || p.unit === '時間') assert.ok(v > 0, '時間が 0 以下 — ' + where);
  });
});

/* --- 問題文に 書かれた 数だけを 使って、答えを 別の道すじで 検算する --- */

test('食塩水の 問題は 問題文の 数だけで 検算しても 合う', () => {
  const hits = { mix: 0, add: 0, evap: 0, salt: 0, dissolve: 0, contain: 0 };
  eachProblem((p, topic) => {
    if (topic !== 'density') return;
    const q = p.question;
    let m;

    if ((m = q.match(/濃度 (\d+)% の 食塩水 (\d+)g と、濃度 (\d+)% の 食塩水 (\d+)g を まぜました/))) {
      const [p1, a, p2, b] = m.slice(1).map(Number);
      assert.strictEqual(Core.round((p1 * a + p2 * b) / (a + b), 6), p.answer.value, '混ぜた濃度が 合わない — ' + q);
      hits.mix++;
    } else if ((m = q.match(/濃度 (\d+)% の 食塩水 (\d+)g に、水を (\d+)g 加えました/))) {
      const [p1, t, w] = m.slice(1).map(Number);
      assert.strictEqual(Core.round(t * p1 / (t + w), 6), p.answer.value, '加水後の濃度が 合わない — ' + q);
      hits.add++;
    } else if ((m = q.match(/濃度 (\d+)% の 食塩水 (\d+)g を 熱して、水を (\d+)g 蒸発させました/))) {
      const [p1, t, w] = m.slice(1).map(Number);
      assert.strictEqual(Core.round(t * p1 / (t - w), 6), p.answer.value, '蒸発後の濃度が 合わない — ' + q);
      hits.evap++;
    } else if ((m = q.match(/濃度 (\d+)% の 食塩水 (\d+)g に 食塩を 加えて、濃度 (\d+)% に します/))) {
      const [p1, t, p2] = m.slice(1).map(Number);
      const x = p.answer.value;
      assert.strictEqual(Core.round((t * p1 / 100 + x) / (t + x) * 100, 6), p2, '加える食塩が 合わない — ' + q);
      hits.salt++;
    } else if ((m = q.match(/水 (\d+)g に 食塩 (\d+)g を とかしました/))) {
      const [w, s] = m.slice(1).map(Number);
      assert.strictEqual(Core.round(s / (w + s) * 100, 6), p.answer.value, 'とかした濃度が 合わない — ' + q);
      hits.dissolve++;
    } else if ((m = q.match(/濃度 (\d+)% の 食塩水が (\d+)g あります/))) {
      const [p1, t] = m.slice(1).map(Number);
      assert.strictEqual(t * p1 / 100, p.answer.value, '食塩の量が 合わない — ' + q);
      hits.contain++;
    }
  });
  for (const key of Object.keys(hits)) {
    assert.ok(hits[key] > 0, `検算できた問題が 0 件: ${key} (問題文を 変えたら ここも 直す)`);
  }
});

test('面積の 問題は 問題文の 数だけで 検算しても 合う', () => {
  let rect = 0, tri = 0, circle = 0;
  eachProblem((p, topic) => {
    if (topic !== 'area') return;
    const q = p.question;
    let m;
    if ((m = q.match(/たて (\d+)cm、よこ (\d+)cm の 長方形の 面積/))) {
      const [h, w] = m.slice(1).map(Number);
      assert.strictEqual(h * w, p.answer.value, '長方形の面積が 合わない — ' + q);
      rect++;
    } else if ((m = q.match(/底辺が (\d+)cm、高さが (\d+)cm の 三角形の 面積/))) {
      const [b, h] = m.slice(1).map(Number);
      assert.strictEqual(b * h / 2, p.answer.value, '三角形の面積が 合わない — ' + q);
      tri++;
    } else if ((m = q.match(/半径 (\d+)cm の 円の 面積/))) {
      const r = Number(m[1]);
      assert.strictEqual(Core.round(r * r * 3.14, 2), p.answer.value, '円の面積が 合わない — ' + q);
      circle++;
    }
  });
  assert.ok(rect > 0 && tri > 0 && circle > 0, '検算できた問題が 0 件 (問題文を 変えたら ここも 直す)');
});

/* ---------------------------------------------------------------- セット作り */

test('1 セットの 中に 同じ問題は 出ない', () => {
  for (let seed = 0; seed < 60; seed++) {
    for (const level of [1, 2, 3]) {
      const quiz = Core.makeQuiz({ level: level, count: 20, seed: seed });
      const questions = quiz.map((p) => p.question);
      assert.strictEqual(new Set(questions).size, questions.length,
        `同じ問題が 2 回 出た (level=${level} seed=${seed})`);
    }
  }
});

test('えらんだ ジャンル・問題数・レベルの とおりに 出る', () => {
  const quiz = Core.makeQuiz({ topics: ['area', 'density'], level: 3, count: 12, seed: 99 });
  assert.strictEqual(quiz.length, 12);
  assert.ok(quiz.every((p) => p.level === 3));
  assert.ok(quiz.every((p) => p.topic === 'area' || p.topic === 'density'));
  assert.ok(new Set(quiz.map((p) => p.topic)).size === 2, '両方の ジャンルが 出る');
  assert.deepStrictEqual(quiz.map((p) => p.index), quiz.map((_, i) => i));
});

test('ジャンルは 順ぐりに 出る (かたよらない)', () => {
  const quiz = Core.makeQuiz({ level: 1, count: 24, seed: 5 });
  const counts = {};
  quiz.forEach((p) => { counts[p.topic] = (counts[p.topic] || 0) + 1; });
  for (const id of ALL) assert.strictEqual(counts[id], 3, `${id} の 出題数が かたよった`);
});

test('知らない ジャンルは エラーに する', () => {
  assert.throws(() => Core.makeProblem('nazo', 1, Core.mulberry32(1)));
});
