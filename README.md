# 成语密码机 · 推理猜成语

中式推理小游戏。Wordle 风格的颜色反馈 + 拖拽交互 + 五段教材分级题库。

## 玩法

1. 主页选择学段：小学 / 初中 / 高中 / 高考高频 / 成语字典。
2. 进关：上方 4 个空槽位，下方 16 宫格里散落 4 条正确线索 + 12 条干扰线索。
3. 把宫格里的词填入 4 个槽位（**点击**填到下一个空槽，或**拖拽**到任意槽位 / 槽位之间互换），点"提交验证"。
4. 槽位变色：
   - 🟩 绿：线索正确 + 位置正确
   - 🟨 黄：线索正确，位置错了
   - ⬛ 灰：线索完全不属于本关
5. 灰色线索在 16 宫格里自动变暗、不可点击，帮你排除。绿/黄的线索保留状态，可以重排重交。
6. **4 个槽位全部变绿即通关**：自动揭晓成语，盖章祝贺，"下一题"按钮可继续抽取本学段题目。

## 数据结构（v3）

每个成语只声明一次，正确线索池 10 条，由代码运行时随机抽取 4 条作为本局答案。干扰词从同学段其它成语的线索池里捞——**同一个成语两次进入抽到的线索几乎不会重复**，实现"千人千面"。

`data.js` 结构：

```js
window.STAGES = [
  {
    id: "primary", label: "小学阶段", desc: "...", icon: "📘", color: "#5fbb56",
    idioms: [
      {
        idiom: "守株待兔",
        meaning: "...",
        cluePool: [
          "宋国农夫","树桩","撞死兔子","死守原地",
          "等待奇遇","不劳而获","墨守成规","不知变通",
          "侥幸心理","韩非子"
        ],
      },
      ...
    ],
  },
  ...
];
```

**扩充新成语**只要往对应学段的 `idioms` 数组里塞条目即可，10 条左右线索为佳。
**新增学段题目**只要给该学段的 `idioms` 填数据，首页会自动从"敬请期待"变为可挑战。

当前内置：
- 小学：守株待兔、亡羊补牢、拔苗助长
- 初中：卧薪尝胆、画蛇添足、完璧归赵
- 高中 / 高考高频 / 成语字典：占位中

## 算法

```text
startNewRound(stageId):
  1. pickNextIdiom(stageId)             // 优先未通关，全通关后随机复习
  2. buildLevelInstance:
       correctClues  = sampleN(cluePool, 4)               // 千人千面
       distractor    = ⋃ 同学段其它成语.cluePool
       distractors   = sampleN(distractor - correctClues, 12)
       poolOrder     = shuffle(correctClues + distractors)
  3. 渲染、等待玩家操作
```

干扰词不足 12 个时（学段内成语数过少），用 `FALLBACK_DISTRACTORS` 池补齐，保证 16 宫格永远填满。

## 持久化

`localStorage["miyi.v3"]`：

```json
{
  "stages": {
    "primary": { "completed": ["守株待兔"] },
    "middle":  { "completed": [] }
  },
  "seenHelp": true
}
```

## 项目结构

```
chengyu-wordle/
  index.html   骨架 + 全部 CSS
  data.js      STAGES 题库（独立，便于扩充/置换为外部 JSON）
  app.js       游戏主逻辑：抽题、渲染、拖拽、判定、胜利演出
  README.md    本文档
```

## 本地运行

```bash
cd chengyu-wordle
python -m http.server 5173
# 浏览器打开 http://localhost:5173
```

> 注意：因为分文件结构里浏览器要 fetch `data.js` / `app.js`，**直接双击 index.html** 可能因 file:// 安全策略加载失败。建议用本地 HTTP 服务。

## 部署到 Vercel

1. 推到 GitHub。
2. [vercel.com](https://vercel.com) → Add New Project → 选 repo → Framework 选 `Other` → Deploy。
3. 拿到 `xxx.vercel.app` 链接发到微信群即可访问。

## 视觉规范（v3）

- 全局字号 1.3x，槽位 20px / 宫格 18px / 按钮 19px / 顶栏 22px / hero 54px
- 三色对比：`#5fbb56` 绿 / `#e6b840` 黄 / `#6a5f4c` 灰
- 槽位 `min-height: 84px`，宫格 `min-height: 76px`，文字 `line-height: 1.25`，4 字会自然折成两行不挤
- 中国风调性：墨黑底 + 金线 + 朱红印章 + 玉色绿，"马善政"标题字 + "站酷小薇"正文字

## 后续可拓展

按价值排序：
1. **批量灌入题目**：把每个学段填满 20~50 题，让玩家有连玩动机
2. **难度更细的干扰策略**：高考高频学段干扰词加权选用"形近成语"或"易混典故"
3. **本关步数 + 评星**：用 3 次提交以内 3 星，4-5 次 2 星，6+ 次 1 星
4. **分享图**：通关 Canvas 拼一张"小学阶段 · 守株待兔 · 3 步通关"的中国风海报
5. **每日挑战**：跨学段每日一题，独立排行
6. **PWA**：支持"添加到主屏幕"，离线可玩（题库已经能离线）
