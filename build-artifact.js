/*
 * テストプレイ用に、全部を 1 枚の HTML に まとめる:  npm run artifact
 *
 * Artifact として 公開する ときは <!doctype> や <head> を 自分で 書かない
 * 決まりに なって いるので、<title> → <style> → 中身 → <script> の 順に 並べる。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const OUT = process.argv[2] || path.join(ROOT, 'artifact.html');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/\s*<script src="[^"]*"><\/script>/g, '');

const page = [
  '<title>さんすうドリル</title>',
  '<style>',
  read('styles.css'),
  '/* 1 枚に まとめた ときは、外側の 余白は こちらで 持つ */',
  'html, body { height: 100%; }',
  '</style>',
  body.trim(),
  '<script>',
  read('core.js'),
  '</script>',
  '<script>',
  read('app.js'),
  '</script>',
  ''
].join('\n');

fs.writeFileSync(OUT, page);
console.log(`${path.basename(OUT)} を つくった (${Math.round(page.length / 1024)}KB)`);
