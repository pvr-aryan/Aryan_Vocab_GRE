(function () {
  "use strict";

  var STORAGE_KEY = "wordboard_progress_v1";
  var SCORE_KEY = "wordboard_score_v2";
  var LEVEL_KEY = "wordboard_level_v1";
  var LEVEL_SIZE = 100;
  var MASTER_THRESHOLD = 2; // consecutive correct answers needed to "master" a word (affects how often a word repeats)

  var els = {
    word: document.getElementById("word"),
    pos: document.getElementById("pos"),
    options: document.getElementById("options"),
    card: document.getElementById("quizCard"),
    reveal: document.getElementById("reveal"),
    revealMeaning: document.getElementById("revealMeaning"),
    revealSentence: document.getElementById("revealSentence"),
    revealForm: document.getElementById("revealForm"),
    nextBtn: document.getElementById("nextBtn"),
    scoreCorrect: document.getElementById("scoreCorrect"),
    scoreTotal: document.getElementById("scoreTotal"),
    highScore: document.getElementById("highScore"),
    resetBtn: document.getElementById("resetBtn"),
    wordBankNote: document.getElementById("wordBankNote"),
    levelBar: document.getElementById("levelBar"),
  };

  // ---- Levels: split the word bank into chunks of 100 ----
  var LEVELS = [];
  (function buildLevels() {
    for (var start = 0; start < WORDS.length; start += LEVEL_SIZE) {
      var end = Math.min(start + LEVEL_SIZE, WORDS.length);
      var indices = [];
      for (var i = start; i < end; i++) indices.push(i);
      LEVELS.push({ label: "L" + (LEVELS.length + 1), start: start, end: end, indices: indices });
    }
  })();

  var progress = loadProgress();
  var score = loadScore(); // { session: {correct,total}, lifetime: {correct,total} }
  var currentLevel = loadLevel();
  var currentIndex = -1;
  var lastIndex = -1;
  var answered = false;

  function loadScore() {
    var fallback = { session: { correct: 0, total: 0 }, lifetime: { correct: 0, total: 0 } };
    try {
      var raw = localStorage.getItem(SCORE_KEY);
      if (!raw) return fallback;
      var s = JSON.parse(raw);
      if (!s || !s.session || !s.lifetime) return fallback;
      return s;
    } catch (e) {
      return fallback;
    }
  }

  function saveScore() {
    try {
      localStorage.setItem(SCORE_KEY, JSON.stringify(score));
    } catch (e) { /* storage unavailable, continue silently */ }
  }

  function loadLevel() {
    try {
      var raw = localStorage.getItem(LEVEL_KEY);
      var n = raw ? parseInt(raw, 10) : 0;
      if (isNaN(n) || n < 0 || n >= LEVELS.length) n = 0;
      return n;
    } catch (e) {
      return 0;
    }
  }

  function saveLevel() {
    try {
      localStorage.setItem(LEVEL_KEY, String(currentLevel));
    } catch (e) { /* storage unavailable, continue silently */ }
  }

  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) { /* storage unavailable, continue silently */ }
  }

  function statFor(word) {
    if (!progress[word]) {
      progress[word] = { consecutive: 0, seen: 0, mastered: false };
    }
    return progress[word];
  }

  function refreshHeader() {
    els.scoreCorrect.textContent = score.session.correct;
    els.scoreTotal.textContent = score.session.total;
    els.highScore.textContent = score.lifetime.correct + "/" + score.lifetime.total;
  }

  function renderLevelBar() {
    els.levelBar.innerHTML = "";
    LEVELS.forEach(function (lvl, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "levelPill" + (i === currentLevel ? " active" : "");
      btn.textContent = lvl.label + " \u00B7 " + (lvl.start + 1) + "\u2013" + lvl.end;
      btn.addEventListener("click", function () {
        if (currentLevel === i) return;
        currentLevel = i;
        saveLevel();
        renderLevelBar();
        updateWordBankNote();
        lastIndex = -1;
        renderWord();
      });
      els.levelBar.appendChild(btn);
    });
  }

  function updateWordBankNote() {
    var lvl = LEVELS[currentLevel];
    els.wordBankNote.textContent = lvl.indices.length + " words in this level";
  }

  function weightFor(word) {
    var s = statFor(word);
    if (s.mastered) return 1;
    if (s.consecutive === 1) return 3;
    return 6; // unseen or currently wrong
  }

  function pickNextIndex() {
    var pool = LEVELS[currentLevel].indices;
    var weights = [];
    var total = 0;
    for (var i = 0; i < pool.length; i++) {
      var globalIdx = pool[i];
      var w = weightFor(WORDS[globalIdx].w);
      if (globalIdx === lastIndex && pool.length > 1) w = Math.max(1, Math.floor(w / 4));
      weights.push(w);
      total += w;
    }
    var r = Math.random() * total;
    for (var j = 0; j < weights.length; j++) {
      r -= weights[j];
      if (r <= 0) return pool[j];
    }
    return pool[pool.length - 1];
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function buildOptions(correctIdx) {
    // distractors are drawn from the whole bank so options stay varied even in small levels
    var pool = [];
    for (var i = 0; i < WORDS.length; i++) {
      if (i !== correctIdx) pool.push(i);
    }
    shuffle(pool);
    var distractors = pool.slice(0, 3);
    var optionIdxs = shuffle([correctIdx].concat(distractors));
    return optionIdxs;
  }

  function renderWord() {
    answered = false;
    els.reveal.hidden = true;
    els.card.classList.remove("flash-good", "flash-bad");

    currentIndex = pickNextIndex();
    lastIndex = currentIndex;
    var entry = WORDS[currentIndex];

    els.word.textContent = entry.w;
    els.pos.textContent = entry.p ? entry.p : "";

    var optionIdxs = buildOptions(currentIndex);
    els.options.innerHTML = "";
    optionIdxs.forEach(function (idx) {
      var btn = document.createElement("button");
      btn.className = "optionBtn";
      btn.type = "button";
      btn.textContent = WORDS[idx].m;
      btn.addEventListener("click", function () { onAnswer(idx, btn); });
      els.options.appendChild(btn);
    });
  }

  function onAnswer(chosenIdx, chosenBtn) {
    if (answered) return;
    answered = true;

    var correct = chosenIdx === currentIndex;
    var entry = WORDS[currentIndex];
    var s = statFor(entry.w);
    s.seen++;

    var buttons = els.options.querySelectorAll(".optionBtn");
    buttons.forEach(function (b) { b.disabled = true; });

    score.session.total++;
    score.lifetime.total++;

    if (correct) {
      chosenBtn.classList.add("correct");
      els.card.classList.add("flash-good");
      s.consecutive++;
      if (s.consecutive >= MASTER_THRESHOLD) s.mastered = true;
      score.session.correct++;
      score.lifetime.correct++;
    } else {
      chosenBtn.classList.add("incorrect");
      buttons.forEach(function (b) {
        var idx = optionIndexOfButton(b);
        if (idx === currentIndex) b.classList.add("correct");
        else if (b !== chosenBtn) b.classList.add("dim");
      });
      els.card.classList.add("flash-bad");
      s.consecutive = 0;
      s.mastered = false;
    }

    saveProgress();
    saveScore();
    refreshHeader();
    showReveal(entry); // always shown, even on a correct answer, so a lucky guess still teaches the word
  }

  function optionIndexOfButton(btn) {
    var text = btn.textContent;
    for (var i = 0; i < WORDS.length; i++) {
      if (WORDS[i].m === text) return i;
    }
    return -1;
  }

  function showReveal(entry) {
    els.revealMeaning.textContent = entry.w + " — " + entry.m;
    els.revealSentence.textContent = entry.s ? "\u201C" + entry.s + "\u201D" : "";
    els.revealForm.textContent = entry.f ? "Related form: " + entry.f : "";
    els.reveal.hidden = false;
  }

  els.nextBtn.addEventListener("click", renderWord);

  els.resetBtn.addEventListener("click", function () {
    if (!confirm("Reset progress? Your score goes back to 0/0 (your lifetime best keeps growing, it never resets).")) return;
    progress = {};
    score.session.correct = 0;
    score.session.total = 0;
    saveProgress();
    saveScore();
    refreshHeader();
    renderWord();
  });

  // Register service worker for offline use (ignored gracefully if unsupported)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function () {});
    });
  }

  renderLevelBar();
  updateWordBankNote();
  refreshHeader();
  renderWord();
})();
