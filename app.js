/* ===================================================================
 * 成语密码机 · 主逻辑（v3）
 * 5 学段 + roguelike 抽题
 * =================================================================== */

(function(){
  "use strict";

  const STAGES = window.STAGES || [];
  const FALLBACK_DISTRACTORS = window.FALLBACK_DISTRACTORS || [];

  /* ---------- DOM 引用 ---------- */
  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);
  const viewMenu = $("#view-menu");
  const viewGame = $("#view-game");
  const btnBack  = $("#btn-back");
  const slotsEl  = $("#slots");
  const gridEl   = $("#grid");
  const gameTip  = $("#game-tip");
  const stageProgressLabel = $("#stageProgressLabel");

  /* ---------- 状态 ---------- */
  const STATE = {
    view: "menu",           // "menu" | "game"
    stageId: null,
    instance: null,         // { idiom, meaning, correctClues, distractors, poolOrder }
    poolStatus: {},         // 线索 -> "correct" | "present" | "absent"
    slots: [null,null,null,null],
    won: false,
    steps: 0,               // 本局已提交次数
    lastStars: 0,           // 本局通关时的评星结果
    lastNewRecord: false,   // 本局通关是否刷新了该成语的最高纪录
    drag: null,
  };

  /* ---------- 评星 ---------- */
  function computeStars(steps){
    if (steps <= 3) return 3;
    if (steps <= 5) return 2;
    return 1;
  }

  /* ---------- 工具 ---------- */
  function shuffle(arr){
    const a = arr.slice();
    for(let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function sampleN(arr, n){
    return shuffle(arr).slice(0, n);
  }
  // 从 arr 中等概率抽 n 个不重复元素，按它们在 arr 中的"原始顺序"返回
  // 用于：正确线索保留 cluePool 的"起承转合"叙事位置
  function sampleNSorted(arr, n){
    const len = arr.length;
    if (n >= len) return arr.slice();
    const idx = Array.from({ length: len }, (_, i) => i);
    for (let i = 0; i < n; i++){
      const j = i + Math.floor(Math.random() * (len - i));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx.slice(0, n).sort((a, b) => a - b).map(i => arr[i]);
  }

  // 4 个槽位的"起承转合"标签
  const SLOT_LABELS = ["起", "承", "转", "合"];

  /* ---------- 持久化 ---------- */
  const LS_KEY = "miyi.v3";
  function loadStore(){
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveStore(s){
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
  }
  function getStageCompleted(stageId){
    const s = loadStore();
    const arr = (s.stages && s.stages[stageId] && s.stages[stageId].completed) || [];
    return new Set(arr);
  }
  function markIdiomCompleted(stageId, idiom){
    const s = loadStore();
    s.stages = s.stages || {};
    s.stages[stageId] = s.stages[stageId] || { completed: [] };
    if (!s.stages[stageId].completed.includes(idiom)){
      s.stages[stageId].completed.push(idiom);
      saveStore(s);
    }
  }
  function getStageScores(stageId){
    const s = loadStore();
    return (s.stages && s.stages[stageId] && s.stages[stageId].scores) || {};
  }
  // 返回 true 当且仅当本次评星刷新了该成语的最高记录
  function recordIdiomScore(stageId, idiom, stars){
    const s = loadStore();
    s.stages = s.stages || {};
    s.stages[stageId] = s.stages[stageId] || { completed: [] };
    s.stages[stageId].scores = s.stages[stageId].scores || {};
    const prev = s.stages[stageId].scores[idiom] || 0;
    if (stars > prev){
      s.stages[stageId].scores[idiom] = stars;
      saveStore(s);
      return true;
    }
    return false;
  }
  function getStageStarTotal(stageId){
    const scores = getStageScores(stageId);
    let sum = 0;
    for (const k in scores) sum += scores[k] || 0;
    return sum;
  }
  function getSeenHelp(){ return !!loadStore().seenHelp; }
  function setSeenHelp(){ const s = loadStore(); s.seenHelp = true; saveStore(s); }

  /* ---------- 抽题算法（roguelike 核心） ---------- */
  function getStage(stageId){
    return STAGES.find(s => s.id === stageId) || null;
  }

  function pickNextIdiom(stageId){
    const stage = getStage(stageId);
    if (!stage || !stage.idioms.length) return null;
    const completed = getStageCompleted(stageId);
    const untried = stage.idioms.filter(it => !completed.has(it.idiom));
    if (untried.length){
      return untried[Math.floor(Math.random() * untried.length)];
    }
    // 全部通关后 -> 随机复习
    return stage.idioms[Math.floor(Math.random() * stage.idioms.length)];
  }

  function buildLevelInstance(stageId, idiomData){
    const stage = getStage(stageId);
    if (!stage || !idiomData) return null;

    // 1) 正确线索：从该成语的线索池里随机抽 4，按 cluePool 原始顺序排列
    //    这样槽位 1 = cluePool 中"靠前"的线索（典故开端），槽位 4 = "靠后"的线索（寓意启示）
    const correctClues = sampleNSorted(idiomData.cluePool, 4);

    // 2) 干扰线索：从同学段其它成语的线索池中收集
    const distractorSet = new Set();
    for (const it of stage.idioms){
      if (it.idiom === idiomData.idiom) continue;
      for (const c of it.cluePool) distractorSet.add(c);
    }
    // 也避免和正确线索撞车
    for (const c of correctClues) distractorSet.delete(c);

    // 3) 如果学段内可选干扰不够 12 个，从 FALLBACK 池补
    if (distractorSet.size < 12){
      for (const c of FALLBACK_DISTRACTORS){
        if (correctClues.includes(c)) continue;
        distractorSet.add(c);
        if (distractorSet.size >= 12) break;
      }
    }
    const distractors = sampleN(Array.from(distractorSet), 12);

    // 4) 16 宫格的排列也随机（独立于正确线索的"正确顺序"）
    const poolOrder = shuffle(correctClues.concat(distractors));

    return {
      idiom:    idiomData.idiom,
      meaning:  idiomData.meaning || "",
      source:   idiomData.source  || "",
      story:    idiomData.story   || "",
      cluePool: idiomData.cluePool.slice(),
      correctClues,
      distractors,
      poolOrder,
    };
  }

  /* ---------- 视图：主页（学段卡） ---------- */
  function renderMenu(){
    document.title = "成语密码机 · 学段选择";
    $("#topTitle").textContent = "成语密码机";
    $("#topSub").textContent = "五段教材 · 中式推理";
    btnBack.classList.add("invisible");

    viewMenu.hidden = false;
    viewGame.hidden = true;
    STATE.view = "menu";

    const listEl = $("#stagesList");
    listEl.innerHTML = "";
    for (const stage of STAGES){
      const card = document.createElement("div");
      card.className = "stage-card";
      card.style.setProperty("--accent", stage.color || "#d4af37");

      const total = stage.idioms.length;
      const completed = getStageCompleted(stage.id).size;
      const isEmpty = total === 0;
      if (isEmpty) card.classList.add("empty");

      // 图标
      const icon = document.createElement("div");
      icon.className = "sc-icon";
      icon.textContent = stage.icon || "📜";
      card.appendChild(icon);

      // 名称 + 描述
      const info = document.createElement("div");
      const name = document.createElement("div");
      name.className = "sc-name";
      name.textContent = stage.label;
      const desc = document.createElement("div");
      desc.className = "sc-desc";
      desc.textContent = isEmpty ? "敬请期待 · 题库制作中" : stage.desc;
      info.appendChild(name);
      info.appendChild(desc);
      card.appendChild(info);

      // 进度
      const prog = document.createElement("div");
      prog.className = "sc-progress";
      if (isEmpty){
        const b = document.createElement("b"); b.textContent = "—";
        const t = document.createElement("span"); t.textContent = "暂无题目";
        prog.appendChild(b); prog.appendChild(t);
      } else {
        const b = document.createElement("b");
        b.textContent = `${completed}/${total}`;
        const t = document.createElement("span"); t.textContent = "已通关";
        prog.appendChild(b); prog.appendChild(t);
        const starTotal = getStageStarTotal(stage.id);
        if (starTotal > 0){
          const sline = document.createElement("span");
          sline.className = "stars-line";
          sline.textContent = `★ ${starTotal} / ${total * 3}`;
          prog.appendChild(sline);
        }
      }
      card.appendChild(prog);

      card.addEventListener("click", () => {
        if (isEmpty){ toast("该学段题库还在制作中，敬请期待"); return; }
        enterStage(stage.id);
      });
      listEl.appendChild(card);
    }
  }

  /* ---------- 进入学段 & 开局 ---------- */
  function enterStage(stageId){
    const stage = getStage(stageId);
    if (!stage || !stage.idioms.length){
      toast("该学段题库还在制作中");
      return;
    }
    STATE.stageId = stageId;
    startNewRound();
  }

  function startNewRound(){
    const stage = getStage(STATE.stageId);
    const idiomData = pickNextIdiom(STATE.stageId);
    if (!idiomData){ renderMenu(); return; }

    STATE.instance = buildLevelInstance(STATE.stageId, idiomData);
    STATE.poolStatus = {};
    STATE.slots = [null,null,null,null];
    STATE.won = false;
    STATE.steps = 0;
    STATE.lastStars = 0;
    STATE.lastNewRecord = false;
    STATE.drag = null;
    STATE.view = "game";

    document.title = `${stage.label} · 成语密码机`;
    $("#topTitle").textContent = stage.label;
    btnBack.classList.remove("invisible");

    viewMenu.hidden = true;
    viewGame.hidden = false;
    gameTip.textContent = "";
    gameTip.className = "tip";

    updateTopSubInGame();
    updateStepLabel();
    renderSlots();
    renderGrid();
    updateSubmitButton();
    window.scrollTo({top:0});
  }

  // 顶栏副标题：游戏中显示"已通关 X/Y · ★ N/3Y"
  function updateTopSubInGame(){
    const stage = getStage(STATE.stageId);
    if (!stage){ return; }
    const total = stage.idioms.length;
    const done = getStageCompleted(stage.id).size;
    const stars = getStageStarTotal(stage.id);
    $("#topSub").textContent = `已通关 ${done}/${total} · ★ ${stars}/${total * 3}`;
  }

  // 游戏面板右上：本关步数
  function updateStepLabel(){
    if (!stageProgressLabel) return;
    if (STATE.view !== "game"){ stageProgressLabel.textContent = ""; return; }
    if (STATE.steps > 0){
      stageProgressLabel.textContent = STATE.won
        ? `本关 ${STATE.steps} 步 · 通关`
        : `本关 ${STATE.steps} 步`;
    } else {
      stageProgressLabel.textContent = "";
    }
  }

  /* ---------- 渲染 ---------- */
  function renderSlots(){
    slotsEl.innerHTML = "";
    for(let i=0;i<4;i++){
      const s = document.createElement("div");
      s.className = "slot";
      const slot = STATE.slots[i];

      const idx = document.createElement("span");
      idx.className = "slot-idx";
      idx.textContent = `第${i+1}位 · ${SLOT_LABELS[i]}`;
      s.appendChild(idx);

      if (slot && slot.clue){
        s.classList.add("filled");
        if (slot.status) s.classList.add("s-" + slot.status);
        const txt = document.createElement("div");
        txt.textContent = slot.clue;
        s.appendChild(txt);
        const clueVal = slot.clue;
        bindDraggable(s, () => ({ type: "slot", idx: i, clue: clueVal }));
      } else {
        const ph = document.createElement("div");
        ph.textContent = "—";
        ph.style.color = "var(--muted)";
        s.appendChild(ph);
      }
      slotsEl.appendChild(s);
    }
  }

  function renderGrid(){
    gridEl.innerHTML = "";
    const inst = STATE.instance;
    if (!inst) return;
    for (const clue of inst.poolOrder){
      const c = document.createElement("div");
      c.className = "clue";
      c.textContent = clue;

      const st = STATE.poolStatus[clue];
      const inSlot = STATE.slots.some(x => x && x.clue === clue);

      if (st === "absent") c.classList.add("hint-absent");
      else if (st === "correct") c.classList.add("hint-correct");
      else if (st === "present") c.classList.add("hint-present");

      if (inSlot) c.classList.add("used");

      if (!c.classList.contains("hint-absent") && !c.classList.contains("used")){
        bindDraggable(c, () => ({ type: "grid", clue: clue }));
      }
      gridEl.appendChild(c);
    }
  }

  /* ---------- 点击/拖拽逻辑 ---------- */
  function onTapClue(clue){
    if (STATE.won) return;
    if (STATE.poolStatus[clue] === "absent") return;
    if (STATE.slots.some(x => x && x.clue === clue)) return;
    const i = STATE.slots.findIndex(x => x === null);
    if (i === -1){ toast("4 个槽位已满，先点击/拖出某个槽位"); return; }
    STATE.slots[i] = { clue, status: null };
    clearSlotColors();
    renderSlots(); renderGrid(); updateSubmitButton();
    gameTip.textContent = ""; gameTip.className = "tip";
  }
  function onTapSlot(i){
    if (STATE.won) return;
    if (!STATE.slots[i]) return;
    STATE.slots[i] = null;
    clearSlotColors();
    renderSlots(); renderGrid(); updateSubmitButton();
  }
  function clearSlotColors(){
    for (const s of STATE.slots) if (s) s.status = null;
  }
  function updateSubmitButton(){
    const filled = STATE.slots.every(x => x && x.clue);
    $("#btn-submit").disabled = !filled || STATE.won;
  }

  /* ---------- 拖拽 ---------- */
  const DRAG_THRESHOLD = 8;
  function bindDraggable(el, getSource){
    el.addEventListener("pointerdown", e => {
      if (STATE.won) return;
      const source = getSource();
      if (!source || !source.clue) return;
      if (source.type === "grid" && STATE.poolStatus[source.clue] === "absent") return;

      e.preventDefault();
      const pid = e.pointerId;
      try { el.setPointerCapture(pid); } catch {}

      const startX = e.clientX, startY = e.clientY;
      let dragStarted = false;
      let lastOver = null;

      function onMove(ev){
        if (ev.pointerId !== pid) return;
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!dragStarted){
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          dragStarted = true;
          startDrag(source, ev.clientX, ev.clientY);
        }
        const g = STATE.drag && STATE.drag.ghost;
        if (g){ g.style.left = ev.clientX + "px"; g.style.top = ev.clientY + "px"; }
        const overEl = document.elementFromPoint(ev.clientX, ev.clientY);
        let overSlot = overEl ? overEl.closest(".slot") : null;
        if (overSlot && !slotsEl.contains(overSlot)) overSlot = null;
        if (overSlot !== lastOver){
          if (lastOver) lastOver.classList.remove("drag-over");
          if (overSlot) overSlot.classList.add("drag-over");
          lastOver = overSlot;
        }
      }
      function onUp(ev){
        if (ev.pointerId !== pid) return;
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        try { el.releasePointerCapture(pid); } catch {}

        if (ev.type === "pointercancel"){ endDrag(); return; }
        if (!dragStarted){
          if (source.type === "grid") onTapClue(source.clue);
          else onTapSlot(source.idx);
          return;
        }
        const dropEl = document.elementFromPoint(ev.clientX, ev.clientY);
        let slotEl = dropEl ? dropEl.closest(".slot") : null;
        if (slotEl && !slotsEl.contains(slotEl)) slotEl = null;
        const targetIdx = slotEl ? Array.from(slotsEl.children).indexOf(slotEl) : -1;
        if (targetIdx >= 0){
          dropOnSlot(source, targetIdx);
        } else if (source.type === "slot"){
          STATE.slots[source.idx] = null;
          clearSlotColors();
          renderSlots(); renderGrid(); updateSubmitButton();
          gameTip.textContent = ""; gameTip.className = "tip";
        }
        endDrag();
      }
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    });
  }
  function startDrag(source, x, y){
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = source.clue;
    ghost.style.left = x + "px";
    ghost.style.top = y + "px";
    document.body.appendChild(ghost);
    STATE.drag = { source, ghost };
    if (source.type === "grid"){
      const idx = STATE.instance.poolOrder.indexOf(source.clue);
      const cell = gridEl.children[idx];
      if (cell) cell.classList.add("dragging-source");
    } else {
      const cell = slotsEl.children[source.idx];
      if (cell) cell.classList.add("dragging-source");
    }
  }
  function endDrag(){
    if (STATE.drag){
      if (STATE.drag.ghost) STATE.drag.ghost.remove();
      STATE.drag = null;
    }
    $$(".slot.drag-over").forEach(s => s.classList.remove("drag-over"));
    $$(".dragging-source").forEach(s => s.classList.remove("dragging-source"));
  }
  function dropOnSlot(source, targetIdx){
    clearSlotColors();
    if (source.type === "grid"){
      STATE.slots[targetIdx] = { clue: source.clue, status: null };
    } else {
      const fromIdx = source.idx;
      if (fromIdx === targetIdx){
        renderSlots(); renderGrid(); updateSubmitButton();
        return;
      }
      const tmp = STATE.slots[fromIdx];
      STATE.slots[fromIdx] = STATE.slots[targetIdx];
      STATE.slots[targetIdx] = tmp;
    }
    renderSlots(); renderGrid(); updateSubmitButton();
    gameTip.textContent = ""; gameTip.className = "tip";
  }

  /* ---------- 提交 & 判定 ---------- */
  function onSubmit(){
    if (STATE.won) return;
    if (!STATE.slots.every(x => x && x.clue)){
      gameTip.textContent = "还没填满 4 个槽位";
      gameTip.className = "tip error";
      shakeSlots();
      return;
    }
    STATE.steps += 1;
    updateStepLabel();
    const answer = STATE.instance.correctClues;
    const guess  = STATE.slots.map(s => s.clue);
    const result = judgeArray(answer, guess);

    flipSlots(result, () => {
      const rank = { correct:3, present:2, absent:1 };
      for (let i = 0; i < 4; i++){
        const clue = guess[i];
        const st = result[i];
        const cur = STATE.poolStatus[clue];
        if (!cur || rank[st] > rank[cur]) STATE.poolStatus[clue] = st;
      }
      renderGrid();

      const allGreen = result.every(r => r === "correct");
      if (allGreen){
        STATE.won = true;
        STATE.lastStars = computeStars(STATE.steps);
        STATE.lastNewRecord = recordIdiomScore(STATE.stageId, STATE.instance.idiom, STATE.lastStars);
        markIdiomCompleted(STATE.stageId, STATE.instance.idiom);
        updateTopSubInGame();
        updateStepLabel();
        gameTip.textContent = "四线索皆中，密押已解";
        gameTip.className = "tip ok";
        bounceSlots();
        setTimeout(openVictory, 700);
      } else {
        const greens = result.filter(r => r === "correct").length;
        const yellows = result.filter(r => r === "present").length;
        gameTip.textContent = `${greens} 绿 · ${yellows} 黄，继续推理`;
        gameTip.className = "tip";
      }
    });
  }

  function judgeArray(answer, guess){
    const n = answer.length;
    const result = new Array(n).fill("absent");
    const used = new Array(n).fill(false);
    for (let i = 0; i < n; i++){
      if (guess[i] === answer[i]){ result[i] = "correct"; used[i] = true; }
    }
    for (let i = 0; i < n; i++){
      if (result[i] === "correct") continue;
      for (let j = 0; j < n; j++){
        if (!used[j] && guess[i] === answer[j]){
          result[i] = "present"; used[j] = true; break;
        }
      }
    }
    return result;
  }

  function flipSlots(result, done){
    const cells = slotsEl.querySelectorAll(".slot");
    cells.forEach((c, i) => {
      setTimeout(() => {
        c.classList.add("flip");
        setTimeout(() => {
          c.classList.remove("s-correct","s-present","s-absent");
          c.classList.add("s-" + result[i]);
          STATE.slots[i].status = result[i];
        }, 270);
        setTimeout(() => c.classList.remove("flip"), 600);
      }, i * 180);
    });
    setTimeout(() => done && done(), cells.length * 180 + 350);
  }
  function shakeSlots(){
    slotsEl.querySelectorAll(".slot").forEach(c => {
      c.classList.add("shake");
      setTimeout(() => c.classList.remove("shake"), 380);
    });
  }
  function bounceSlots(){
    slotsEl.querySelectorAll(".slot").forEach((c, i) => {
      setTimeout(() => {
        c.animate(
          [{transform:"translateY(0)"},{transform:"translateY(-8px)"},{transform:"translateY(0)"}],
          {duration:380, easing:"ease"}
        );
      }, i * 90);
    });
  }

  /* ---------- 胜利覆盖层 ---------- */
  // 把故事文本里出现的线索词包成 <span>。activeClues 高亮（金底），其它线索仅弱化标记。
  function renderStoryHTML(story, allClues, activeClues){
    if (!story) return "";
    const active = new Set(activeClues);
    // 先做出现位置探测，按"长字符串优先"避免子串先被替换
    const sortedActive = [...activeClues].sort((a, b) => b.length - a.length);
    const sortedOther  = allClues.filter(c => !active.has(c)).sort((a, b) => b.length - a.length);

    let text = story;
    const subs = [];
    let counter = 0;
    function placeholder(){ return `\u0001CL${counter++}\u0001`; }

    for (const c of sortedActive){
      if (text.indexOf(c) >= 0){
        const ph = placeholder();
        text = text.split(c).join(ph);
        subs.push({ ph, html: `<span class="story-clue active">${escapeHtml(c)}</span>` });
      }
    }
    for (const c of sortedOther){
      if (text.indexOf(c) >= 0){
        const ph = placeholder();
        text = text.split(c).join(ph);
        subs.push({ ph, html: `<span class="story-clue">${escapeHtml(c)}</span>` });
      }
    }
    // 转义剩余文本
    text = escapeHtml(text);
    // 占位符是 \u0001 包围的 ASCII，不会被 escapeHtml 处理
    for (const s of subs){ text = text.split(s.ph).join(s.html); }
    return text;
  }
  function escapeHtml(s){
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function openVictory(){
    const overlay = $("#overlay");
    overlay.classList.add("show");

    const cells     = overlay.querySelectorAll(".v-tianzige .tz");
    const meaning   = $("#v-meaning");
    const sourceEl  = $("#v-source");
    const storyEl   = $("#v-story");
    const starsEl   = $("#v-stars");
    const stepsTagEl= $("#v-steps-tag");
    const stamp     = $("#v-stamp");
    const actions   = $("#v-actions");

    cells.forEach(c => c.classList.remove("show"));
    meaning.classList.remove("show");
    sourceEl.classList.remove("show");
    storyEl.classList.remove("show");
    starsEl.classList.remove("show");
    stepsTagEl.classList.remove("show");
    stamp.classList.remove("show");
    actions.classList.remove("show");

    // 田字格字符
    const chars = Array.from(STATE.instance.idiom);
    cells.forEach((c, i) => { c.querySelector("span").textContent = chars[i] || ""; });
    meaning.textContent = STATE.instance.meaning || "";

    // 出处 + 故事（如果该成语有 source/story 字段则展示，否则隐藏）
    const hasSource = !!STATE.instance.source;
    const hasStory  = !!STATE.instance.story;
    sourceEl.hidden = !hasSource;
    storyEl.hidden  = !hasStory;
    if (hasSource) sourceEl.textContent = `典故出处：${STATE.instance.source}`;
    if (hasStory)  storyEl.innerHTML = renderStoryHTML(
        STATE.instance.story,
        STATE.instance.cluePool || [],
        STATE.instance.correctClues || []
      );

    // 评星
    const stars = STATE.lastStars || computeStars(STATE.steps || 999);
    starsEl.innerHTML = "";
    for (let i = 0; i < 3; i++){
      const s = document.createElement("span");
      s.className = "star " + (i < stars ? "filled" : "empty");
      s.textContent = i < stars ? "★" : "☆";
      s.style.animationDelay = (0.05 + i * 0.18) + "s";
      starsEl.appendChild(s);
    }
    // 步数标语
    const tagMap = { 3: "巅峰破译", 2: "稳健过关", 1: "九死一生" };
    stepsTagEl.innerHTML = "";
    const stepsSpan = document.createElement("span");
    stepsSpan.textContent = `${STATE.steps} 步通关 · ${tagMap[stars] || ""}`;
    stepsTagEl.appendChild(stepsSpan);
    if (STATE.lastNewRecord){
      const badge = document.createElement("span");
      badge.className = "new-record";
      badge.textContent = "新纪录";
      stepsTagEl.appendChild(badge);
    }

    // "下一题" 按钮
    const stage = getStage(STATE.stageId);
    const hasMore = stage && stage.idioms.length > 0;
    const nextBtn = $("#v-next");
    nextBtn.style.display = hasMore ? "" : "none";
    const allDone = stage && getStageCompleted(stage.id).size >= stage.idioms.length;
    nextBtn.textContent = allDone ? "随机复习" : "下一题";

    // 时序：田字格 → 含义 →（出处 → 故事）→ 星星 → 步数标语 → 印章 → 按钮
    let t = 220;
    cells.forEach((c, i) => { setTimeout(() => c.classList.add("show"), t + i * 320); });
    t += cells.length * 320 + 120;
    setTimeout(() => meaning.classList.add("show"), t);
    if (hasSource){
      t += 180;
      setTimeout(() => sourceEl.classList.add("show"), t);
    }
    if (hasStory){
      t += 240;
      setTimeout(() => storyEl.classList.add("show"), t);
    }
    t += 320;
    setTimeout(() => starsEl.classList.add("show"), t);
    t += 680;   // 等三颗星依次弹完
    setTimeout(() => stepsTagEl.classList.add("show"), t);
    t += 260;
    setTimeout(() => stamp.classList.add("show"), t);
    t += 520;
    setTimeout(() => actions.classList.add("show"), t);
  }
  function closeVictory(){ $("#overlay").classList.remove("show"); }

  /* ---------- 事件绑定 ---------- */
  function bindGlobal(){
    btnBack.addEventListener("click", () => {
      if (STATE.view === "game"){ closeVictory(); renderMenu(); }
    });
    $("#btn-help").addEventListener("click", () => $("#dlg-help").showModal());
    document.querySelectorAll("[data-close]").forEach(b => {
      b.addEventListener("click", e => {
        const dlg = e.target.closest("dialog");
        if (dlg) dlg.close();
      });
    });
    $("#btn-submit").addEventListener("click", onSubmit);
    $("#btn-clear").addEventListener("click", () => {
      if (STATE.won) return;
      STATE.slots = [null,null,null,null];
      renderSlots(); renderGrid(); updateSubmitButton();
      gameTip.textContent = ""; gameTip.className = "tip";
    });

    $("#v-next").addEventListener("click", () => {
      closeVictory();
      startNewRound();
    });
    $("#v-replay").addEventListener("click", () => {
      // 用同一个成语再来一遍（但线索会再次随机抽取）
      const sameIdiom = STATE.instance && STATE.instance.idiom;
      if (!sameIdiom){ closeVictory(); startNewRound(); return; }
      const stage = getStage(STATE.stageId);
      const idiomData = stage && stage.idioms.find(it => it.idiom === sameIdiom);
      if (!idiomData){ closeVictory(); startNewRound(); return; }
      closeVictory();
      STATE.instance = buildLevelInstance(STATE.stageId, idiomData);
      STATE.poolStatus = {};
      STATE.slots = [null,null,null,null];
      STATE.won = false;
      STATE.steps = 0;
      STATE.lastStars = 0;
      STATE.lastNewRecord = false;
      gameTip.textContent = ""; gameTip.className = "tip";
      updateStepLabel();
      renderSlots(); renderGrid(); updateSubmitButton();
    });
    $("#v-menu").addEventListener("click", () => { closeVictory(); renderMenu(); });

    window.addEventListener("keydown", e => {
      if (e.key === "Escape" && STATE.view === "game"){ closeVictory(); renderMenu(); }
    });
  }

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg){
    let t = document.getElementById("__toast");
    if (!t){
      t = document.createElement("div");
      t.id = "__toast";
      Object.assign(t.style, {
        position:"fixed", left:"50%", bottom:"40px", transform:"translateX(-50%)",
        background:"rgba(30,24,16,.95)", color:"#f4ecd6",
        padding:"12px 18px", borderRadius:"8px",
        border:"1px solid #4a3c2a", fontSize:"15px",
        letterSpacing:"2px", zIndex:9999,
        boxShadow:"0 6px 16px rgba(0,0,0,.4)",
        opacity:"0", transition:"opacity .2s ease",
        pointerEvents:"none",
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => { t.style.opacity = "1"; });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = "0"; }, 1700);
  }

  /* ---------- 启动 ---------- */
  function boot(){
    bindGlobal();
    renderMenu();
    if (!getSeenHelp()){
      $("#dlg-help").showModal();
      setSeenHelp();
    }
  }
  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
