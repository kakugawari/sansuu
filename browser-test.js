/*
 * ブラウザで 実際に 動かして 確かめる テスト:  npm run test:ui
 *
 *   npm i -D playwright        (グローバルに 入って いれば そのまま 使う)
 *
 * 画面まわりの 不具合は node のテストでは 捕まらない。ここでは 本物の
 * ブラウザを 立ち上げ、指の操作 (タップ) を そのまま 再現して 確かめる。
 *
 * ★ 直した 不具合には、かならず 見張り役を ここに 置くこと。
 */
const { spawn } = require('node:child_process');
const { execSync } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const PORT = Number(process.env.PORT || 8123);
const URL = `http://localhost:${PORT}/`;
const ROOT = __dirname;
const CHROMIUM = process.env.CHROMIUM_PATH;   // 手元の Chromium を 使いたいとき

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + message);
  } else {
    failed++;
    console.log('  \x1b[31m✗ FAIL\x1b[0m ' + message);
  }
}

function skip(message) { console.log('  \x1b[90m- とばした: ' + message + '\x1b[0m'); }
function section(name) { console.log('\n' + name); }

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(URL, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - started > 10000) reject(new Error('サーバーが起動しない'));
          else setTimeout(tick, 100);
        });
    };
    tick();
  });
}

/** playwright を さがす (このフォルダ → グローバル の順) */
function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* つぎを 試す */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(root, 'playwright'));
  } catch (e) {
    console.error('playwright が 必要です:  npm i -D playwright');
    process.exit(1);
  }
}

/**
 * 何かした 直後に、その要素が 本来の場所から どれだけ ずれるかを
 * 1 フレームずつ 測る。「押した瞬間に 一瞬とぶ」たぐいの 不具合は これで 見つかる。
 * @returns {Promise<number>} 最大の ずれ (px)
 */
function measureJump(page, selector, act) {
  return page.evaluate(async ({ sel, code }) => {
    const before = document.querySelector(sel).getBoundingClientRect();
    // eslint-disable-next-line no-new-func
    new Function(code)();
    let worst = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const el = document.querySelector(sel);
      if (!el) { worst = Infinity; break; }
      const now = el.getBoundingClientRect();
      worst = Math.max(worst, Math.abs(now.left - before.left), Math.abs(now.top - before.top));
    }
    return Math.round(worst);
  }, { sel: selector, code: act });
}

/** いまの問題の 正しい答えを、テンキーを 指で 押して 入れる */
async function tapAnswer(page, text) {
  for (const ch of text) {
    const key = ch === '.' ? 'dot' : ch === '/' ? 'slash' : ch === '-' ? 'sign' : ch;
    await page.locator(`[data-key="${key}"]`).tap();
  }
}

async function tapCorrect(page) {
  const answer = await page.evaluate(() => window.__app.current().answerText);
  await tapAnswer(page, answer);
  await page.locator('#btnSubmit').tap();
  return answer;
}

/** 横スクロールが 出て いないか */
function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function run() {
  const { chromium, devices } = loadPlaywright();

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], { stdio: 'ignore' });
  await waitForServer();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  try {
    // ------------------------------------------------ スマホで開く
    section('スマホで開く');
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const phone = await context.newPage();
    phone.on('pageerror', (e) => errors.push('スマホ: ' + e.message));
    phone.on('console', (m) => { if (m.type() === 'error') errors.push('スマホ: ' + m.text()); });
    await phone.goto(URL);
    await phone.waitForFunction(() => window.__app);
    ok(true, 'ページが 開いて、画面の しくみが 立ち上がる');

    const fit = await phone.evaluate(() => ({
      title: document.querySelector('h1').textContent.trim(),
      levels: document.querySelectorAll('#levelPicker .chip').length,
      topics: document.querySelectorAll('#topicPicker .chip').length,
      keys: document.querySelectorAll('.key').length
    }));
    ok((await overflow(phone)) <= 1, 'ホームで 横スクロールが 出ない');
    ok(fit.title.length > 0, `見出しが 出ている (${fit.title})`);
    ok(fit.levels === 3, `レベルが 3 つ 出る (${fit.levels})`);
    ok(fit.topics === 8, `ジャンルが 8 つ 出る (${fit.topics})`);
    ok(fit.keys === 15, `テンキーが 15 個 出る (${fit.keys})`);

    // 最初は ジャンルを えらんでいない ので、まだ 始められない
    const fresh = await phone.evaluate(() => ({
      chosen: document.querySelectorAll('#topicPicker .chip[aria-pressed="true"]').length,
      disabled: document.getElementById('btnStart').disabled,
      hint: !document.getElementById('startHint').hidden
    }));
    ok(fresh.chosen === 0, `はじめは ジャンルが 1 つも えらばれて いない (${fresh.chosen} 個)`);
    ok(fresh.disabled && fresh.hint, 'ジャンルを えらぶまで スタートは 押せない');

    await phone.locator('#topicPicker .chip', { hasText: '面積' }).tap();
    const afterPick = await phone.evaluate(() => ({
      chosen: document.querySelectorAll('#topicPicker .chip[aria-pressed="true"]').length,
      disabled: document.getElementById('btnStart').disabled
    }));
    ok(afterPick.chosen === 1 && !afterPick.disabled, '1 つ えらぶと スタートできる');
    await phone.locator('#btnAllTopics').tap();
    ok(await phone.evaluate(() => document.querySelectorAll('#topicPicker .chip[aria-pressed="true"]').length) === 8,
      '「ぜんぶ」で 8 ジャンル えらべる');

    // 指で さわる ところが 小さすぎないか (44px は Apple の めやす)
    const small = await phone.evaluate(() => {
      const bad = [];
      document.querySelectorAll('#homeScreen .chip, #homeScreen .btn-big').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height < 40) bad.push(el.textContent.trim() + ':' + Math.round(r.height));
      });
      return bad;
    });
    ok(small.length === 0, small.length ? '押しにくい ボタン: ' + small.join(' / ') : 'ボタンが どれも 指で 押せる 大きさ');

    // ------------------------------------------------ 1 問 とく
    section('問題を とく');
    await phone.locator('#countPicker .chip', { hasText: '5 問' }).tap();
    await phone.locator('#btnStart').tap();   // ジャンルは 上で 「ぜんぶ」を えらんである
    await phone.waitForSelector('#quizScreen:not([hidden])');
    ok(await phone.locator('#question').textContent() !== '', '問題文が 出る');
    // hidden にした 画面が ほんとうに 消えているか (display の 上書き事故よけ)
    const leftovers = await phone.evaluate(() => ['homeScreen', 'resultScreen', 'btnNext']
      .filter((id) => document.getElementById(id).getBoundingClientRect().height > 0));
    ok(leftovers.length === 0, leftovers.length ? '消えていない: ' + leftovers.join(' / ') : 'ホームと けっかの 画面は 消えている');
    ok((await phone.locator('#progress').textContent()).trim() === '1 / 5', '「1 / 5」と 出る');
    ok((await overflow(phone)) <= 1, '問題の画面でも 横スクロールが 出ない');

    // ここから先は seed を 固定する。失敗したとき 同じ問題で 追いかけられる。
    await phone.evaluate(() => window.__app.start(window.Core.makeQuiz({ level: 1, count: 5, seed: 20250831 })));
    await phone.waitForTimeout(60);

    // スクロールしなくても 「こたえる」が 見えているか
    const reach = await phone.evaluate(() => {
      const r = document.getElementById('btnSubmit').getBoundingClientRect();
      return { bottom: Math.round(r.bottom), top: Math.round(r.top), view: window.innerHeight };
    });
    ok(reach.bottom <= reach.view + 1 && reach.top > 0,
      `「こたえる」が スクロールなしで 押せる (下端 ${reach.bottom}px / 画面 ${reach.view}px)`);

    const plainPanel = await phone.evaluate(() => getComputedStyle(document.getElementById('quizBottom')).backgroundColor);
    const first = await tapCorrect(phone);
    await phone.waitForTimeout(120);
    const afterCorrect = await phone.evaluate(() => ({
      judge: document.getElementById('judge').textContent,
      panel: getComputedStyle(document.getElementById('quizBottom')).backgroundColor,
      judgeBottom: Math.round(document.getElementById('judge').getBoundingClientRect().bottom),
      answerTop: Math.round(document.getElementById('answerBox').getBoundingClientRect().top),
      solutionShown: !document.getElementById('solution').hidden,
      steps: document.querySelectorAll('#solution li').length,
      nextShown: !document.getElementById('btnNext').hidden,
      submitHidden: document.getElementById('btnSubmit').hidden
    }));
    ok(afterCorrect.judge.indexOf('せいかい') >= 0, `正しい答え (${first}) で せいかいに なる`);
    ok(afterCorrect.judgeBottom <= afterCorrect.answerTop, '「せいかい!」は こたえ欄の 上に 出る');
    ok(afterCorrect.panel !== plainPanel, `せいかいの ときは 下の パネルごと 色が 変わる (${plainPanel} → ${afterCorrect.panel})`);
    ok(afterCorrect.solutionShown && afterCorrect.steps > 0, `とき方が ${afterCorrect.steps} 行 出る`);
    ok(afterCorrect.nextShown && afterCorrect.submitHidden, '「つぎへ」に 変わる');

    // 押した直後に 表示が 飛ばないか (CSS の 上書き事故よけ)
    await phone.locator('#btnNext').tap();
    await phone.waitForTimeout(100);
    const jump = await measureJump(phone, '#answerBox', 'document.querySelector(\'[data-key="7"]\').click()');
    ok(jump < 12, `キーを 押した 直後に こたえ欄が 飛ばない (最大ずれ ${jump}px)`);

    // ------------------------------------------------ まちがえたとき
    section('まちがえたとき');
    await phone.locator('[data-key="clear"]').tap();
    await tapAnswer(phone, '9999');
    await phone.locator('#btnSubmit').tap();
    await phone.waitForTimeout(120);
    const wrong = await phone.evaluate(() => ({
      judge: document.getElementById('judge').textContent,
      panel: getComputedStyle(document.getElementById('quizBottom')).backgroundColor,
      answer: window.__app.current().answerLabel,
      klass: document.getElementById('answerBox').className
    }));
    ok(wrong.judge.indexOf('ざんねん') >= 0, 'ちがう答えは ばつに なる');
    ok(wrong.judge.replace(/\s/g, '').indexOf(wrong.answer.replace(/[{}\s]/g, '')) >= 0,
      `ばつの ときに 正しい答えが 出る (${wrong.judge.trim()})`);
    ok(wrong.klass.indexOf('is-ng') >= 0, 'こたえ欄の わくが 赤く なる');
    ok(wrong.panel !== plainPanel && wrong.panel !== afterCorrect.panel,
      `ばつの ときは 別の 色に なる (${wrong.panel})`);

    // ------------------------------------------------ 最後まで やる
    section('最後まで やる');
    await phone.locator('#btnNext').tap();
    for (let i = 0; i < 3; i++) {
      await phone.waitForTimeout(60);
      await tapCorrect(phone);
      await phone.waitForTimeout(60);
      await phone.locator('#btnNext').tap();
    }
    await phone.waitForSelector('#resultScreen:not([hidden])');
    const result = await phone.evaluate(() => ({
      score: document.getElementById('scoreBig').textContent,
      wrongItems: document.querySelectorAll('.wrong-item').length,
      retryShown: !document.getElementById('btnRetryWrong').hidden,
      saved: JSON.parse(localStorage.getItem('sansuu.stats.v1') || 'null')
    }));
    ok(result.score === '4 / 5', `けっかが 出る (${result.score})`);
    ok(result.wrongItems === 1, `まちがえた 問題が ${result.wrongItems} 件 ならぶ`);
    ok(result.retryShown, '「まちがえた もんだいだけ」が 出る');
    ok(result.saved && result.saved.plays === 1, 'きろくが 保存される');
    const tried = result.saved ? Object.keys(result.saved.topics).reduce((a, k) => a + result.saved.topics[k].tried, 0) : 0;
    ok(tried === 5, `きろくに 5 問 ぶん 入る (${tried})`);

    await phone.locator('#btnRetryWrong').tap();
    await phone.waitForSelector('#quizScreen:not([hidden])');
    ok((await phone.locator('#progress').textContent()).trim() === '1 / 1', 'まちがえた 1 問だけ やり直せる');

    // ------------------------------------------------ どの答えも テンキーで 打てるか
    section('どの答えも テンキーで 打てるか');
    let typed = 0;
    let typedNg = [];
    await phone.evaluate(() => window.__app.start(window.Core.makeQuiz({ level: 3, count: 16, seed: 4649 })));
    for (let i = 0; i < 16; i++) {
      await phone.waitForTimeout(30);
      const answer = await tapCorrect(phone);
      const state = await phone.evaluate(() => ({
        judged: window.__app.state().judged,
        shown: document.getElementById('answerText').textContent,
        topic: window.__app.current().topicName
      }));
      if (state.judged === 'ok' && state.shown === answer) typed++;
      else typedNg.push(`${state.topic}: ${answer} → ${state.shown}`);
      await phone.locator('#btnNext').tap();
    }
    ok(typed === 16, typedNg.length ? '打てない答え: ' + typedNg.join(' / ') : '16 問ぶんの 答えが すべて テンキーだけで 打てる');

    // ------------------------------------------------ 図
    section('図');
    await phone.evaluate(() => window.__app.start(window.Core.makeQuiz({ topics: ['area'], level: 1, count: 3, seed: 4 })));
    await phone.waitForTimeout(80);
    const figure = await phone.evaluate(() => {
      const svg = document.querySelector('#figure svg');
      if (!svg) return null;
      const box = svg.getBoundingClientRect();
      const stage = document.getElementById('stage').getBoundingClientRect();
      return { w: Math.round(box.width), h: Math.round(box.height), fits: box.width <= stage.width + 1, texts: svg.querySelectorAll('text').length };
    });
    ok(figure !== null, '面積の 問題で 図が 出る');
    ok(figure && figure.fits, `図が 画面から はみ出さない (図 ${figure && figure.w}px / 画面 ${Math.round((await phone.evaluate(() => document.getElementById('stage').getBoundingClientRect().width)))}px)`);
    ok(figure && figure.texts >= 2, `図に 長さの 数字が ${figure && figure.texts} 個 入る`);
    ok((await overflow(phone)) <= 1, '図が 出ても 横スクロールが 出ない');

    // ------------------------------------------------ とちゅうの しきを かく らん
    section('とちゅうの しきを かく らん');
    await phone.evaluate(() => window.__app.start(window.Core.makeQuiz({ topics: ['area'], level: 1, count: 2, seed: 9 })));
    await phone.waitForTimeout(80);

    function isBlank(pixels) {
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) return false;
      return true;
    }

    const beforeDraw = await phone.evaluate(() => {
      const c = document.getElementById('scratchCanvas');
      const ctx = c.getContext('2d');
      return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
    });
    ok(isBlank(beforeDraw), 'かく らんは 最初 なにも 書かれていない');

    await phone.locator('#scratchCanvas').scrollIntoViewIfNeeded();
    const box = await phone.locator('#scratchCanvas').boundingBox();
    await phone.mouse.move(box.x + 10, box.y + 10);
    await phone.mouse.down();
    await phone.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 8 });
    await phone.mouse.up();
    const afterDraw = await phone.evaluate(() => {
      const c = document.getElementById('scratchCanvas');
      const ctx = c.getContext('2d');
      return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
    });
    ok(!isBlank(afterDraw), '指で なぞると 線が 書ける');

    await phone.locator('#btnScratchClear').tap();
    const afterClear = await phone.evaluate(() => {
      const c = document.getElementById('scratchCanvas');
      const ctx = c.getContext('2d');
      return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
    });
    ok(isBlank(afterClear), '「けす」で まっさらに なる');

    await phone.mouse.move(box.x + 10, box.y + 10);
    await phone.mouse.down();
    await phone.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 8 });
    await phone.mouse.up();
    await tapCorrect(phone);                 // こたえてから つぎへ
    await phone.locator('#btnNext').tap();
    await phone.waitForTimeout(80);
    const nextProblem = await phone.evaluate(() => {
      const c = document.getElementById('scratchCanvas');
      const ctx = c.getContext('2d');
      return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
    });
    ok(isBlank(nextProblem), 'つぎの 問題に 進むと、書いた ものは 消える (前の 問題の 落書きが 残らない)');

    ok((await overflow(phone)) <= 1, 'かく らんが 出ても 横スクロールが 出ない');

    // ------------------------------------------------ 食塩水の ビーカー
    section('食塩水の ビーカー');
    await phone.evaluate(() => window.__app.start(window.Core.makeQuiz({ topics: ['density'], level: 2, count: 1, seed: 3 })));
    await phone.waitForTimeout(80);
    const beaker = await phone.evaluate(() => {
      const svg = document.querySelector('#figure svg');
      if (!svg) return null;
      const box = svg.getBoundingClientRect();
      const stage = document.getElementById('quizTop').getBoundingClientRect();
      // 属性ではなく「実際に 効いている 値」を 見る (class に 負けていないか)
      const fills = Array.from(svg.querySelectorAll('polygon')).map((p) => Number(getComputedStyle(p).fillOpacity));
      return {
        texts: Array.from(svg.querySelectorAll('text')).map((t) => t.textContent),
        fits: box.width <= stage.width + 1,
        w: Math.round(box.width),
        different: new Set(fills.filter((v) => v > 0).map((v) => v.toFixed(2))).size,
        strongest: Math.max.apply(null, fills)
      };
    });
    ok(beaker !== null, '食塩水の 問題で ビーカーの 図が 出る');
    ok(beaker && beaker.texts.filter((t) => /%/.test(t)).length >= 2, `濃度が 図に 書いてある (${beaker && beaker.texts.join(' ')})`);
    ok(beaker && beaker.texts.indexOf('?%') >= 0, '知りたい ところが ? に なっている');
    ok(beaker && beaker.different >= 3, `濃さの ちがいが 塗りの こさで わかる (${beaker && beaker.different} 段階)`);
    ok(beaker && beaker.strongest > 0.3, `濃い 食塩水は しっかり 濃く 塗られる (${beaker && beaker.strongest})`);
    ok(beaker && beaker.fits, `ビーカーが 画面に おさまる (${beaker && beaker.w}px)`);
    ok((await overflow(phone)) <= 1, 'ビーカーが 出ても 横スクロールが 出ない');

    // ------------------------------------------------ 分数
    section('分数');
    await phone.evaluate(() => window.__app.start(window.Core.makeQuiz({ topics: ['fraction'], level: 1, count: 2, seed: 11 })));
    await phone.waitForTimeout(80);
    const fracs = await phone.evaluate(() => document.querySelectorAll('#question .frac').length);
    ok(fracs >= 2, `分数が 縦書きで ${fracs} 個 出る`);
    ok(!(await phone.locator('#answerHint').isHidden()), '「分数は 3/4 のように 書きます」が 出る');
    const fracAnswer = await tapCorrect(phone);
    await phone.waitForTimeout(100);
    ok((await phone.locator('#judge').textContent()).indexOf('せいかい') >= 0,
      `分数の 答え (${fracAnswer}) を テンキーで 入れて せいかいに なる`);

    // 約分していない 答えは 「おしい」に して、まだ ばつに しない
    await phone.evaluate(() => window.__app.start([window.Core.makeProblem('fraction', 1, window.Core.mulberry32(3))]));
    await phone.waitForTimeout(60);
    const unreduced = await phone.evaluate(() => {
      const a = window.__app.current().answer;
      return a.num * 2 + '/' + a.den * 2;
    });
    await tapAnswer(phone, unreduced);
    await phone.locator('#btnSubmit').tap();
    await phone.waitForTimeout(80);
    const hint = await phone.evaluate(() => ({
      judge: document.getElementById('judge').textContent,
      panel: getComputedStyle(document.getElementById('quizBottom')).backgroundColor,
      judged: window.__app.state().judged,
      submitStillShown: !document.getElementById('btnSubmit').hidden
    }));
    ok(hint.judge.indexOf('約分') >= 0, `約分していない 答え (${unreduced}) は 「おしい」に なる`);
    ok(hint.judged === null && hint.submitStillShown, 'やり直せる (まだ ばつに して いない)');
    ok(hint.panel === plainPanel, 'おしい! の ときは パネルの 色を 変えない');

    // ------------------------------------------------ 明るい画面・暗い画面
    section('明るい画面と 暗い画面');
    for (const scheme of ['light', 'dark']) {
      const themed = await browser.newContext({ ...devices['iPhone 13'], colorScheme: scheme });
      const page = await themed.newPage();
      page.on('pageerror', (e) => errors.push(scheme + ': ' + e.message));
      await page.goto(URL);
      await page.waitForFunction(() => window.__app);
      await page.evaluate(() => window.__app.start(window.Core.makeQuiz({ topics: ['area'], level: 1, count: 1, seed: 2 })));
      const colors = await page.evaluate(() => ({
        bg: getComputedStyle(document.body).backgroundColor,
        fg: getComputedStyle(document.body).color,
        figure: getComputedStyle(document.querySelector('#figure svg')).color
      }));
      ok(colors.bg !== colors.fg, `${scheme}: 文字と 背景の 色が ちがう (${colors.bg} / ${colors.fg})`);
      ok(colors.figure !== colors.bg, `${scheme}: 図の 線が 背景に 溶けない (${colors.figure})`);
      await themed.close();
    }

    // 見る人が 明るい/暗いを 自分で えらんだ とき (Artifact の 画面など)
    const themed = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
    const themedPage = await themed.newPage();
    await themedPage.goto(URL);
    await themedPage.waitForFunction(() => window.__app);
    const darkBg = await themedPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const pickedLight = await themedPage.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
      return getComputedStyle(document.body).backgroundColor;
    });
    ok(darkBg !== pickedLight, `data-theme="light" を えらぶと 明るく なる (${darkBg} → ${pickedLight})`);
    await themed.close();

    // ------------------------------------------------ アイコン
    section('アイコン');
    const desk = await browser.newPage();
    await desk.goto(URL);
    const apple = await desk.evaluate(() =>
      document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
    if (!apple) {
      skip('ホーム画面用の アイコンは まだ 無い');
    } else {
      ok(apple.endsWith('.png'), `ホーム画面用アイコンが PNG (${apple})`);   // iOS は SVG を 使えない
      const res = await desk.request.get(URL + apple.replace('./', ''));
      ok(res.ok(), `${apple} が 配信される`);
    }

    // ------------------------------------------------ 更新と オフライン (sw.js があれば)
    section('更新と オフライン');
    if (!fs.existsSync(path.join(ROOT, 'sw.js'))) {
      skip('サービスワーカーは まだ 無い (オフライン対応する ときに 用意する)');
    }

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面の エラー: ' + errors.join(' / ') : 'JS エラーなし');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
