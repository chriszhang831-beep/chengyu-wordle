/* 校验 AI 生成的一批故事
 * 用法：node _validate_batch.js path/to/batch-N-out.txt
 *   - 读取 AI 输出（应该是 [{...}, {...}, ...] 形式的 JS 数组）
 *   - 对每条逐项检查：
 *       1. cluePool 全部 10 个字串是否都连续出现在 story 里
 *       2. story 长度 100-150 个汉字（含标点）
 *       3. source 非空
 *   - 输出 OK / 失败 列表，最后整理出合格的条目供整合
 */

global.window = {};
require("./data.js");
const fs = require("fs");
const path = process.argv[2];
if (!path) { console.error("用法: node _validate_batch.js batch-N-out.txt"); process.exit(1); }

// 建立 idiom -> cluePool 的快速索引
const POOL = new Map();
for (const stage of global.window.STAGES) {
  for (const it of stage.idioms) POOL.set(it.idiom, { stage: stage.id, cluePool: it.cluePool });
}

// 读取原文并尝试解析
let raw = fs.readFileSync(path, "utf8").trim();
// 把可能存在的 ```js ... ``` 包装、前言、后语都剥掉
raw = raw.replace(/^```[a-zA-Z]*\s*/m, "").replace(/```\s*$/m, "").trim();
const start = raw.indexOf("[");
const end   = raw.lastIndexOf("]");
if (start < 0 || end < 0) { console.error("找不到 [ 或 ]，输出格式有问题"); process.exit(1); }
raw = raw.slice(start, end + 1);

let parsed;
try {
  // 容忍 JS 对象字面量写法（key 不带引号、属性末尾允许逗号）
  parsed = eval("(" + raw + ")");
} catch (e) {
  console.error("解析失败：", e.message);
  console.error("---raw 开头 200 字---");
  console.error(raw.slice(0, 200));
  process.exit(1);
}

if (!Array.isArray(parsed)) { console.error("不是数组"); process.exit(1); }

const passed = [];
const failed = [];

for (const ent of parsed) {
  const issues = [];
  if (!ent || typeof ent !== "object") { failed.push({ ent, issues: ["非对象"] }); continue; }
  const { idiom, source, story } = ent;
  if (!idiom) issues.push("缺 idiom");
  if (!source || !source.trim()) issues.push("缺 source");
  if (!story || !story.trim()) issues.push("缺 story");

  const info = POOL.get(idiom);
  if (!info) issues.push("idiom 不在题库中（可能 AI 改写了成语）");
  else {
    // 长度检查（用 Array.from 数 unicode 字符数）
    const len = Array.from(story).length;
    if (len < 90)  issues.push(`太短 ${len} 字`);
    if (len > 170) issues.push(`太长 ${len} 字`);
    // 子串检查
    const missing = info.cluePool.filter(c => !story.includes(c));
    if (missing.length) issues.push(`漏线索 [${missing.join(" / ")}]`);
  }

  if (issues.length) failed.push({ idiom, issues });
  else passed.push({ idiom, source, story });
}

// 报告
console.log("========================================");
console.log(`共 ${parsed.length} 条，通过 ${passed.length}，失败 ${failed.length}`);
console.log("========================================");
if (failed.length) {
  console.log("\n=== 失败列表（需要让 AI 重写或人工修补）===");
  for (const f of failed) console.log(" ✗", f.idiom || "(无 idiom)", "—", f.issues.join("; "));
}
if (passed.length) {
  console.log("\n=== 通过列表（可整合到 data.js）===");
  for (const p of passed) console.log(" ✓", p.idiom);
}

// 把合格条目以"等待整合"的格式输出到 passed.json，方便我整合
const outFile = path.replace(/\.[^.]+$/, "") + ".passed.json";
fs.writeFileSync(outFile, JSON.stringify(passed, null, 2), "utf8");
console.log(`\n合格条目已写入: ${outFile}`);
