(function(){
  "use strict";

  /* =========================================================
     SUBJECTS & QUESTIONS — now served by the Flask + SQLite
     backend (app.py) instead of being hard-coded here. This
     is exactly the change the instructor's feedback called
     for: a teacher can add or remove questions through the
     /admin page without ever touching this file.

     SAMPLE_SCORES below is unrelated flavour data: Alex Tan's
     mock grade per subject for the Dashboard panel. It has
     nothing to do with the question bank, so a brand-new
     subject a teacher adds will simply show without a grade.
     ========================================================= */
  const SAMPLE_SCORES = {
    'Mathematics':42, 'Physics':45, 'Chemistry':39, 'Biology':51, 'English':55,
    'Geography':47, 'History':53, 'Economics':44, 'Business Studies':58,
    'Mother Tongue (Chinese)':50
  };

  let SUBJECTS_LIVE = []; // [{subject, count}], populated from /api/subjects
  function subjectName(s){ return s; } // subjects are plain names end-to-end now

  async function fetchSubjects(){
    const res = await fetch('/api/subjects');
    if(!res.ok) throw new Error('subjects request failed');
    SUBJECTS_LIVE = await res.json();
    return SUBJECTS_LIVE;
  }

  async function fetchMission(subjects, count){
    const qs = 'subjects=' + encodeURIComponent(subjects.join(',')) + '&count=' + encodeURIComponent(count);
    const res = await fetch('/api/mission?' + qs);
    if(!res.ok){
      const body = await res.json().catch(function(){ return {}; });
      throw new Error(body.error || 'mission request failed');
    }
    return res.json();
  }


  /* =========================================================
     DIFFICULTIES — adapted from ULTRAKILL's 6-tier difficulty
     select screen. Each preset only scales existing numbers
     (time budget, style decay speed, P payout) — question
     content itself never changes, so there's no hidden
     adaptive logic, just a fixed multiplier per choice.
     ========================================================= */
  const DIFFICULTIES = [
    { key:'harmless', name:'HARMLESS', cat:'ACCESSIBLE', tag:'Absurdly generous. A slow, stress-free pace to practice at.', timeMul:1.6, decayMul:0.6, payoutMul:0.75 },
    { key:'lenient',  name:'LENIENT',  cat:'ACCESSIBLE', tag:'A gentler pace with extra room to think it through.',       timeMul:1.3, decayMul:0.8, payoutMul:0.9 },
    { key:'standard', name:'STANDARD', cat:'HARD',       tag:'The intended experience. Balanced pace, balanced reward.',  timeMul:1.0, decayMul:1.0, payoutMul:1.0 },
    { key:'violent',  name:'VIOLENT',  cat:'HARD',       tag:'Faster pace, tighter timing, bigger payout for it.',       timeMul:0.75,decayMul:1.3, payoutMul:1.25 },
    { key:'brutal',   name:'BRUTAL',   cat:'VERY HARD',  tag:'Ruthless timing windows. Only for the fully warmed up.',   timeMul:0.55,decayMul:1.6, payoutMul:1.5 },
    { key:'ukmd',     name:'ULTRAKILL MUST DIE', cat:'VERY HARD', tag:'Still in development.', locked:true },
  ];
  function getDifficulty(key){ return DIFFICULTIES.find(function(d){return d.key===key;}) || DIFFICULTIES[2]; }

  /* =========================================================
     RANK TABLES — adapted from ULTRAKILL's Time / Kills / Style
     end-of-level ranking system (D-C-B-A-S, with a Perfect
     "P" rank for an all-S, zero-redo clear).
     One style-rank name was softened for a school-safe demo
     (SSShitstorm -> SSStorm); all others match the game.
     ========================================================= */
  const RANK_POINT  = { D:1, C:2, B:3, A:4, S:5 };
  const RANK_COLOR  = { D:'#3aa0ff', C:'#39ff77', B:'#ffe066', A:'#ff9f1c', S:'#ff1f2b', P:'#ffd700' };
  const RANK_ORDER  = ['D','C','B','A','S','P'];
  const AGG_PAYOUT  = { D:200, C:500, B:1000, A:2000, S:3500, P:6000 };
  const PAYOUT_BASELINE_QUESTIONS = 3; // the length the P values above were originally tuned for

  const STYLE_TIERS = [
    { key:'D',   name:'DESTRUCTIVE', min:0,    color:'#3aa0ff' },
    { key:'C',   name:'CHAOTIC',     min:80,   color:'#39ff77' },
    { key:'B',   name:'BRUTAL',      min:180,  color:'#ffe066' },
    { key:'A',   name:'ANARCHIC',    min:320,  color:'#ff9f1c' },
    { key:'S',   name:'SUPREME',     min:480,  color:'#ff1f2b' },
    { key:'SS',  name:'SSAVAGE',     min:650,  color:'#ff3b3b' },
    { key:'SSS', name:'SSSTORM',     min:850,  color:'#ff5c5c' },
    { key:'UK',  name:'ULTRAKILL',   min:1080, color:'#ffd700' },
  ];

  const POWERUPS = {
    scan: { id:'scan', name:'Intel Scan',  cost:800,  desc:'Removes two wrong options from your next question.' },
    clk:  { id:'clk',  name:'Overclock',   cost:600,  desc:'Freezes the mission clock for your next question.' },
    snd:  { id:'snd',  name:'Second Wind', cost:1200, desc:'Forgives your next wrong answer. Keeps Accuracy & Questions ranks intact — a Flawless run still needs zero mistakes.' },
  };

  /* =========================================================
     PERSISTENT PLAYER STATE (browser localStorage only)
     ========================================================= */
  const STORAGE_KEY = 'v1training_player_v3';
  const DEFAULT_PLAYER = {
    screen:'dashboard',
    xp:0, p:0, bestRank:null, sessions:0, streak:0,
    inventory:{ scan:0, clk:0, snd:0 },
    lastSetup:{ difficulty:'standard', subjects: [], count:10 } // subjects filled once /api/subjects loads
  };

  function loadPlayer(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return JSON.parse(JSON.stringify(DEFAULT_PLAYER));
      const parsed = JSON.parse(raw);
      const merged = Object.assign({}, DEFAULT_PLAYER, parsed);
      merged.inventory = Object.assign({}, DEFAULT_PLAYER.inventory, parsed.inventory || {});
      merged.lastSetup = Object.assign({}, DEFAULT_PLAYER.lastSetup, parsed.lastSetup || {});
      if(!Array.isArray(merged.lastSetup.subjects)){ merged.lastSetup.subjects = []; }
      // Never resume mid-mission on reload — land on a safe static screen.
      if(merged.screen === 'practice' || merged.screen === 'overview') merged.screen = 'dashboard';
      return merged;
    }catch(e){ return JSON.parse(JSON.stringify(DEFAULT_PLAYER)); }
  }
  function savePlayer(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(player)); }catch(e){} }

  let player = loadPlayer();

  /* =========================================================
     TRANSIENT MISSION STATE — in-memory only, fresh per run
     ========================================================= */
  let mission = null;
  let styleDecayTimer = null;
  let clockTimer = null;

  function shuffleArr(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=a[i]; a[i]=a[j]; a[j]=t; } }

  function newMission(order, difficultyKey){
    return {
      order: order,
      difficulty: difficultyKey,
      index: 0,
      attemptsThisQ: 0,
      eliminatedThisQ: [],
      overclockThisQ: false,
      secondWindThisQ: false,
      scanUsedThisQ: false,
      status: 'live', // live | correct | wrong
      results: [],     // per-question outcome records
      styleScore: 0,
      combo: 0,
      accumMs: 0,      // banked solving time (ms) across resolved questions
      qStartTs: 0,
    };
  }

  /* =========================================================
     SCREEN NAVIGATION
     ========================================================= */
  function showScreen(name){
    player.screen = name;
    document.querySelectorAll('.screen').forEach(function(el){
      el.classList.toggle('active', el.id === 'screen-' + name);
    });
    savePlayer();
  }

  /* =========================================================
     DASHBOARD RENDER
     ========================================================= */
  function levelClass(score){
    if(score < 50) return 'level-low';
    if(score < 70) return 'level-mid';
    return 'level-high';
  }

  function renderSubjectList(){
    const wrap = document.getElementById('subject-list');
    wrap.innerHTML = '';
    if(SUBJECTS_LIVE.length === 0){
      wrap.innerHTML = '<p class="inline-msg" style="color:var(--grey);">No subjects in the database yet — add some via the /admin page.</p>';
      return;
    }
    SUBJECTS_LIVE.forEach(function(s){
      const score = SAMPLE_SCORES[s.subject];
      const div = document.createElement('div');
      if(typeof score === 'number'){
        div.className = 'panel chamfer-sm subject ' + levelClass(score);
        div.innerHTML =
          '<div class="row"><span class="name">'+s.subject+'</span><span class="pct">'+score+'%</span></div>'+
          '<div class="bar"><div class="fill" style="width:'+score+'%"></div></div>';
      } else {
        div.className = 'panel chamfer-sm subject';
        div.innerHTML =
          '<div class="row"><span class="name">'+s.subject+'</span><span class="pct" style="color:var(--grey);">NEW</span></div>'+
          '<div class="profile-meta" style="margin-top:2px;">'+s.count+' question'+(s.count===1?'':'s')+' in bank — no grade data yet</div>';
      }
      wrap.appendChild(div);
    });
  }

  function renderDashboard(){
    document.getElementById('stat-xp').textContent = player.xp;
    document.getElementById('stat-p').textContent = player.p;
    document.getElementById('stat-streak').textContent = player.streak;
    document.getElementById('stat-sessions').textContent = player.sessions;
    document.getElementById('shop-btn-p').textContent = player.p;
    document.getElementById('hud-rank').textContent = player.bestRank || '—';

    document.getElementById('best-rank-label').textContent =
      player.bestRank ? (player.bestRank + ' — ' + (player.bestRank === 'P' ? 'PERFECT' : styleRankFullName(player.bestRank))) : 'No runs yet';

    document.querySelectorAll('#rank-track .seg').forEach(function(seg){
      const r = seg.getAttribute('data-rank');
      const active = player.bestRank && RANK_ORDER.indexOf(r) <= RANK_ORDER.indexOf(player.bestRank);
      seg.classList.toggle('active', !!active);
      seg.style.background = active ? RANK_COLOR[r] : '';
      seg.style.color = active ? '#07070a' : '';
    });
  }
  function styleRankFullName(letter){
    const map = { D:'Destructive', C:'Chaotic', B:'Brutal', A:'Anarchic', S:'Supreme' };
    return map[letter] || letter;
  }

  /* =========================================================
     MISSION SETUP
     ========================================================= */
  let setupState = null;

  function openSetup(){
    const defaultSubjects = player.lastSetup.subjects.length > 0
      ? player.lastSetup.subjects.slice()
      : SUBJECTS_LIVE.map(function(s){return s.subject;});
    setupState = {
      difficulty: player.lastSetup.difficulty,
      subjects: defaultSubjects,
      count: player.lastSetup.count
    };
    renderSetup();
    showScreen('setup');
  }

  function renderSetup(){
    const diffList = document.getElementById('difficulty-list');
    diffList.innerHTML = '';
    DIFFICULTIES.forEach(function(d){
      const div = document.createElement('div');
      div.className = 'panel chamfer-sm diff-item' + (d.key===setupState.difficulty ? ' selected':'') + (d.locked ? ' locked':'');
      div.innerHTML =
        '<div class="row"><span class="name">'+d.name+'</span><span class="cat">'+d.cat+'</span></div>'+
        '<div class="tag">'+d.tag+'</div>';
      if(!d.locked){
        div.addEventListener('click', function(){ setupState.difficulty = d.key; renderSetup(); });
      }
      diffList.appendChild(div);
    });

    const subjGrid = document.getElementById('subject-grid');
    subjGrid.innerHTML = '';
    if(SUBJECTS_LIVE.length === 0){
      subjGrid.innerHTML = '<p class="inline-msg" style="color:var(--grey);">No subjects available — add questions via the /admin page first.</p>';
    }
    SUBJECTS_LIVE.forEach(function(s){
      const selected = setupState.subjects.indexOf(s.subject) >= 0;
      const div = document.createElement('div');
      div.className = 'panel chamfer-sm subj-chip' + (selected ? ' selected':'');
      div.innerHTML = '<div class="name">'+s.subject+'</div><div class="score">'+s.count+' question'+(s.count===1?'':'s')+'</div>';
      div.addEventListener('click', function(){
        const idx = setupState.subjects.indexOf(s.subject);
        if(idx>=0){ setupState.subjects.splice(idx,1); } else { setupState.subjects.push(s.subject); }
        renderSetup();
      });
      subjGrid.appendChild(div);
    });

    document.getElementById('qcount-slider').value = setupState.count;
    document.getElementById('qcount-label').textContent = setupState.count;
  }

  document.getElementById('qcount-slider').addEventListener('input', function(e){
    setupState.count = parseInt(e.target.value, 10);
    document.getElementById('qcount-label').textContent = setupState.count;
  });

  document.getElementById('btn-deploy').addEventListener('click', async function(){
    if(setupState.subjects.length === 0){
      document.getElementById('setup-msg').textContent = 'Select at least one subject to deploy.';
      return;
    }
    document.getElementById('setup-msg').textContent = '';
    showScreen('loading');
    try{
      await startPractice(setupState);
      player.lastSetup = { difficulty:setupState.difficulty, subjects:setupState.subjects.slice(), count:setupState.count };
      savePlayer();
    }catch(err){
      showScreen('setup');
      document.getElementById('setup-msg').textContent = err.message || 'Could not start the mission. Is the server running?';
    }
  });

  document.getElementById('btn-setup-back').addEventListener('click', function(){ showScreen('dashboard'); });

  /* =========================================================
     PRACTICE — question flow
     ========================================================= */
  async function startPractice(config){
    const order = await fetchMission(config.subjects, config.count);
    mission = newMission(order, config.difficulty);
    document.getElementById('q-diff-pill').textContent = getDifficulty(config.difficulty).name;
    renderLoadout();
    renderQuestion();
    startClock();
    startStyleDecay();
    showScreen('practice');
  }

  function currentQuestion(){ return mission.order[mission.index]; }

  function startClock(){
    stopClock();
    clockTimer = setInterval(function(){
      if(mission.status !== 'live'){ return; } // pause display during feedback / redo choice
      const liveMs = Date.now() - mission.qStartTs;
      renderClock(mission.accumMs + (mission.overclockThisQ ? 0 : liveMs));
    }, 200);
  }
  function stopClock(){ if(clockTimer){ clearInterval(clockTimer); clockTimer = null; } }
  function renderClock(ms){
    const el = document.getElementById('mission-time');
    const totalSec = Math.floor(ms/1000);
    const mm = String(Math.floor(totalSec/60)).padStart(2,'0');
    const ss = String(totalSec%60).padStart(2,'0');
    el.textContent = 'TIME ' + mm + ':' + ss;
    el.classList.toggle('frozen', !!mission.overclockThisQ);
  }

  function startStyleDecay(){
    stopStyleDecay();
    styleDecayTimer = setInterval(function(){
      if(!mission || mission.status !== 'live') return;
      const decayMul = getDifficulty(mission.difficulty).decayMul;
      mission.styleScore = Math.max(0, Math.floor(mission.styleScore * (1 - 0.08*decayMul)) - Math.round(5*decayMul));
      renderLiveStyle();
    }, 1000);
  }
  function stopStyleDecay(){ if(styleDecayTimer){ clearInterval(styleDecayTimer); styleDecayTimer = null; } }

  function styleTierIndex(score){
    let idx = 0;
    for(let i=0;i<STYLE_TIERS.length;i++){ if(score >= STYLE_TIERS[i].min) idx = i; }
    return idx;
  }

  function renderLiveStyle(){
    const idx = styleTierIndex(mission.styleScore);
    const tier = STYLE_TIERS[idx];
    document.getElementById('live-style-name').textContent = tier.name;
    document.getElementById('live-style-name').style.color = tier.color;
    document.getElementById('live-style-score').textContent = mission.styleScore;
    const mult = Math.min(3, 1 + mission.combo * 0.4).toFixed(1);
    document.getElementById('live-combo').textContent = 'x' + mult;

    const track = document.getElementById('live-style-track');
    track.innerHTML = '';
    STYLE_TIERS.forEach(function(t,i){
      const seg = document.createElement('div');
      seg.className = 'seg' + (i<=idx ? ' active':'');
      if(i<=idx){ seg.style.background = t.color; seg.style.color = t.color; seg.style.borderColor = t.color; }
      track.appendChild(seg);
    });
  }

  function renderLoadout(){
    const bar = document.getElementById('loadout-bar');
    bar.innerHTML = '';
    Object.values(POWERUPS).forEach(function(pu){
      const owned = player.inventory[pu.id] || 0;
      const armedFlag = (pu.id==='scan' && mission.scanUsedThisQ) ||
                         (pu.id==='clk'  && mission.overclockThisQ) ||
                         (pu.id==='snd'  && mission.secondWindThisQ);
      const btn = document.createElement('button');
      btn.className = 'pu' + (armedFlag ? ' armed':'');
      btn.disabled = owned <= 0 || armedFlag || mission.status !== 'live';
      btn.innerHTML = '<b>'+pu.name.toUpperCase()+'</b>x'+owned;
      btn.addEventListener('click', function(){ activatePowerup(pu.id); });
      bar.appendChild(btn);
    });
  }

  function activatePowerup(id){
    if((player.inventory[id]||0) <= 0) return;
    if(id === 'scan'){
      const q = currentQuestion();
      const wrongIdx = q.options.map(function(_,i){return i;}).filter(function(i){return i!==q.answer;});
      shuffleArr(wrongIdx);
      mission.eliminatedThisQ = wrongIdx.slice(0,2);
      mission.scanUsedThisQ = true;
      player.inventory.scan -= 1;
      renderOptions();
    } else if(id === 'clk'){
      mission.overclockThisQ = true;
      player.inventory.clk -= 1;
    } else if(id === 'snd'){
      mission.secondWindThisQ = true;
      player.inventory.snd -= 1;
    }
    savePlayer();
    renderLoadout();
  }

  function renderQuestion(){
    mission.status = 'live';
    mission.attemptsThisQ = 0;
    mission.eliminatedThisQ = [];
    mission.overclockThisQ = false;
    mission.secondWindThisQ = false;
    mission.scanUsedThisQ = false;
    mission.qStartTs = Date.now();

    const q = currentQuestion();
    document.getElementById('q-progress').textContent = 'QUESTION ' + (mission.index+1) + '/' + mission.order.length;
    document.getElementById('q-subject').textContent = subjectName(q.subject).toUpperCase();
    document.getElementById('q-ai-pill').style.display = q.ai_generated ? 'inline-block' : 'none';
    document.getElementById('q-text').textContent = q.question;
    renderOptions();
    renderLiveStyle();
    renderLoadout();
    renderClock(mission.accumMs);
  }

  function renderOptions(){
    const q = currentQuestion();
    const wrap = document.getElementById('q-options');
    wrap.innerHTML = '';
    const letters = ['A','B','C','D'];
    q.options.forEach(function(opt,i){
      const b = document.createElement('button');
      b.className = 'option' + (mission.eliminatedThisQ.indexOf(i)>=0 ? ' eliminated':'');
      b.disabled = mission.status !== 'live' || mission.eliminatedThisQ.indexOf(i)>=0;
      b.innerHTML = '<span class="k">'+letters[i]+'</span><span>'+opt+'</span>';
      b.addEventListener('click', function(){ submitAnswer(i); });
      wrap.appendChild(b);
    });
  }

  function submitAnswer(i){
    if(mission.status !== 'live') return;
    const q = currentQuestion();
    const elapsedMs = Date.now() - mission.qStartTs;
    mission.attemptsThisQ += 1;

    if(!mission.overclockThisQ){ mission.accumMs += elapsedMs; }
    renderClock(mission.accumMs);

    if(i === q.answer){
      handleCorrect(elapsedMs);
    } else {
      handleWrong(i);
    }
  }

  function handleCorrect(elapsedMs){
    const speed = Math.max(40, Math.round(320 - (elapsedMs/1000)*18));
    const mult = Math.min(3, 1 + mission.combo*0.4);
    const gain = Math.round(speed*mult);
    mission.styleScore += gain;
    mission.combo += 1;

    const firstTry = mission.attemptsThisQ === 1;
    const outcome = firstTry ? 'FIRST_TRY_CORRECT' : 'REDONE_THEN_CORRECT';
    mission.results.push({ outcome:outcome, attempts:mission.attemptsThisQ });

    player.xp += 100;
    player.streak += 1;
    savePlayer();

    mission.status = 'correct';
    renderLiveStyle();
    renderLoadout();

    const wrap = document.getElementById('q-options');
    wrap.innerHTML =
      '<div class="feedback-panel">'+
        '<span class="feedback-tag ok">✓ CORRECT</span>'+
        '<div class="feedback-gains">+100 <span>XP</span>  ·  +'+gain+' <span>STYLE</span></div>'+
        '<button class="btn btn-primary chamfer" id="btn-continue">Continue</button>'+
      '</div>';
    document.getElementById('btn-continue').addEventListener('click', advanceMission);
  }

  function handleWrong(i){
    const q = currentQuestion();

    if(mission.secondWindThisQ){
      mission.secondWindThisQ = false;
      mission.combo = 0;
      mission.results.push({ outcome:'SECOND_WIND_SAVED', attempts:mission.attemptsThisQ });
      player.xp += 100;
      player.streak += 1;
      savePlayer();
      mission.status = 'correct';
      renderLoadout();
      const wrap = document.getElementById('q-options');
      wrap.innerHTML =
        '<div class="feedback-panel">'+
          '<span class="feedback-tag sw">⚡ SECOND WIND</span>'+
          '<div class="feedback-explain">Mistake forgiven. The correct answer was: <b>'+q.options[q.answer]+'</b>. '+q.explanation+'</div>'+
          '<button class="btn btn-primary chamfer" id="btn-continue">Continue</button>'+
        '</div>';
      document.getElementById('btn-continue').addEventListener('click', advanceMission);
      return;
    }

    mission.styleScore = Math.max(0, Math.floor(mission.styleScore*0.5));
    mission.combo = 0;
    player.streak = 0;
    savePlayer();
    renderLiveStyle();

    mission.status = 'wrong';
    const wrap = document.getElementById('q-options');
    wrap.innerHTML =
      '<div class="feedback-panel">'+
        '<span class="feedback-tag bad">✗ INCORRECT</span>'+
        '<div class="feedback-explain">The correct answer was: <b>'+q.options[q.answer]+'</b>. '+q.explanation+'</div>'+
        '<div class="choice-row">'+
          '<button class="btn btn-ghost chamfer" id="btn-retry" style="flex:1;">Retry Question</button>'+
          '<button class="btn btn-primary chamfer" id="btn-accept" style="flex:1;">Accept · +500P</button>'+
        '</div>'+
      '</div>';
    document.getElementById('btn-retry').addEventListener('click', retryQuestion);
    document.getElementById('btn-accept').addEventListener('click', acceptAndContinue);
  }

  function retryQuestion(){
    mission.status = 'live';
    mission.qStartTs = Date.now();
    renderOptions();
    renderLoadout();
  }

  function acceptAndContinue(){
    mission.results.push({ outcome:'ACCEPTED_WRONG', attempts:mission.attemptsThisQ });
    mission.status = 'correct';
    advanceMission();
  }

  function advanceMission(){
    if(mission.index < mission.order.length-1){
      mission.index += 1;
      renderQuestion();
    } else {
      finishMission();
    }
  }

  /* =========================================================
     MISSION COMPLETE — rank + P payout calculation
     ========================================================= */
  function rankFromTime(ms, numQuestions, timeMul){
    const s = ms/1000;
    const S = 7*numQuestions*timeMul, A = 12*numQuestions*timeMul, B = 18*numQuestions*timeMul, C = 26*numQuestions*timeMul;
    if(s<=S) return 'S';
    if(s<=A) return 'A';
    if(s<=B) return 'B';
    if(s<=C) return 'C';
    return 'D';
  }
  // Shared by QUESTIONS (clean-of-total) and ACCURACY (correct-of-total).
  function rankFromRatio(count, total){
    if(count>=total) return 'S';
    const ratio = count/total;
    if(ratio>=0.85) return 'A';
    if(ratio>=0.6)  return 'B';
    if(ratio>=0.35) return 'C';
    return 'D';
  }
  function aggregateRank(t,c,a,redoneQuestions){
    if(t==='S' && c==='S' && a==='S' && redoneQuestions===0) return 'P';
    const sum = RANK_POINT[t]+RANK_POINT[c]+RANK_POINT[a];
    if(sum>=14) return 'S';
    if(sum>=11) return 'A';
    if(sum>=8)  return 'B';
    if(sum>=5)  return 'C';
    return 'D';
  }

  function finishMission(){
    stopClock(); stopStyleDecay();
    player.sessions += 1;

    const total = mission.order.length;
    let redoneQuestions = 0, accCount = 0, noRedoCount = 0, flawless = true;
    mission.results.forEach(function(r){
      if(r.outcome === 'FIRST_TRY_CORRECT'){ accCount++; }
      else if(r.outcome === 'REDONE_THEN_CORRECT'){ redoneQuestions++; flawless=false; }
      else if(r.outcome === 'ACCEPTED_WRONG'){ noRedoCount++; flawless=false; }
      else if(r.outcome === 'SECOND_WIND_SAVED'){ accCount++; flawless=false; }
    });
    const cleanCount = total - redoneQuestions;

    const diff = getDifficulty(mission.difficulty);
    const timeRank = rankFromTime(mission.accumMs, total, diff.timeMul);
    const qRank = rankFromRatio(cleanCount, total);
    const accRank = rankFromRatio(accCount, total);
    const agg = aggregateRank(timeRank, qRank, accRank, redoneQuestions);

    const lengthScale = total / PAYOUT_BASELINE_QUESTIONS;
    const basePayout = Math.round(AGG_PAYOUT[agg] * diff.payoutMul * lengthScale);
    const noRedoPayout = noRedoCount*500;
    const flawlessPayout = flawless ? 5000 : 0;
    const stylePayout = Math.round(mission.styleScore*0.5);
    const totalP = basePayout + noRedoPayout + flawlessPayout + stylePayout;
    const xpEarned = mission.results.filter(function(r){return r.outcome!=='ACCEPTED_WRONG';}).length*100;

    player.p += totalP;
    if(!player.bestRank || RANK_ORDER.indexOf(agg) > RANK_ORDER.indexOf(player.bestRank)){
      player.bestRank = agg;
    }
    savePlayer();

    showScreen('overview');
    playOverviewSequence({
      agg:agg, timeRank:timeRank, qRank:qRank, accRank:accRank, total:total,
      timeMs:mission.accumMs, cleanCount:cleanCount, accCount:accCount,
      basePayout:basePayout, noRedoPayout:noRedoPayout, flawlessPayout:flawlessPayout,
      stylePayout:stylePayout, totalP:totalP, xpEarned:xpEarned, flawless:flawless
    });
  }

  const OVERVIEW_MSGS = {
    P:'"Perfect clear. That’s a flawless run, V1 — textbook."',
    S:'"Supreme work. You’re outpacing where you started."',
    A:'"Strong drill. Keep stacking reps like that."',
    B:'"Solid clear. A little more speed and it’s an A."',
    C:'"You got through it. Next run, aim to retry less."',
    D:'"Rough one — but you finished the mission. That’s the part that counts."'
  };

  /* ---- animation helpers ---- */
  function sleep(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }

  // Animates a number from `from` to `to`, writing through formatFn each frame.
  function countUp(el, from, to, duration, formatFn){
    return new Promise(function(resolve){
      if(duration<=0 || from===to){ el.textContent = formatFn(to); resolve(); return; }
      const start = performance.now();
      function tick(now){
        const t = Math.min(1, (now-start)/duration);
        const eased = 1 - Math.pow(1-t, 3);
        el.textContent = formatFn(from + (to-from)*eased);
        if(t<1){ requestAnimationFrame(tick); } else { resolve(); }
      }
      requestAnimationFrame(tick);
    });
  }

  // White flash -> tween into the rank's real color, then the letter appears.
  function revealRank(el, rank){
    return new Promise(function(resolve){
      el.style.transition = 'none';
      el.style.background = '#ffffff';
      el.style.color = '#ffffff';
      el.textContent = '';
      void el.offsetWidth; // force reflow so the flash actually paints before tweening
      setTimeout(function(){
        el.style.transition = 'background-color .4s ease, color .4s ease';
        el.style.background = RANK_COLOR[rank];
        el.style.color = '#07070a';
        el.textContent = rank;
        setTimeout(resolve, 420);
      }, 140);
    });
  }

  function resetOverviewUI(total){
    ['badge-time','badge-q','badge-acc'].forEach(function(id){
      const el = document.getElementById(id);
      el.style.transition = 'none';
      el.style.background = 'var(--bg2)';
      el.style.color = 'var(--grey)';
      el.textContent = '–';
    });
    const stamp = document.getElementById('agg-rank-stamp');
    stamp.style.transition = 'none';
    stamp.style.animation = 'none';
    stamp.style.background = 'transparent';
    stamp.style.color = 'var(--line)';
    stamp.textContent = '–';
    document.getElementById('val-time').textContent = '00:00';
    document.getElementById('val-q').textContent = '0/'+total;
    document.getElementById('val-acc').textContent = '0/'+total;
    document.getElementById('progress-msg').textContent = '';
    ['p-base','p-style','p-noredo','p-flawless'].forEach(function(id){
      const el = document.getElementById(id);
      el.textContent = '+0 P';
      el.closest('.p-line').style.opacity = 0;
    });
    document.getElementById('p-total').textContent = '+0 P';
    document.getElementById('xp-earned').textContent = '+0 XP';
  }

  function renderOverviewInstant(r){
    // Reduced-motion / fallback path: same end state, no sequencing.
    resetOverviewUI(r.total);
    document.getElementById('badge-time').style.background = RANK_COLOR[r.timeRank];
    document.getElementById('badge-time').style.color = '#07070a';
    document.getElementById('badge-time').textContent = r.timeRank;
    document.getElementById('badge-q').style.background = RANK_COLOR[r.qRank];
    document.getElementById('badge-q').style.color = '#07070a';
    document.getElementById('badge-q').textContent = r.qRank;
    document.getElementById('badge-acc').style.background = RANK_COLOR[r.accRank];
    document.getElementById('badge-acc').style.color = '#07070a';
    document.getElementById('badge-acc').textContent = r.accRank;
    const stamp = document.getElementById('agg-rank-stamp');
    stamp.style.background = RANK_COLOR[r.agg];
    stamp.style.color = '#07070a';
    stamp.textContent = r.agg;

    const totalSec = Math.floor(r.timeMs/1000);
    document.getElementById('val-time').textContent = String(Math.floor(totalSec/60)).padStart(2,'0')+':'+String(totalSec%60).padStart(2,'0');
    document.getElementById('val-q').textContent = r.cleanCount+'/'+r.total;
    document.getElementById('val-acc').textContent = r.accCount+'/'+r.total;
    document.getElementById('p-base').textContent = '+'+r.basePayout+' P';
    document.getElementById('p-style').textContent = '+'+r.stylePayout+' P';
    document.getElementById('p-noredo').textContent = '+'+r.noRedoPayout+' P';
    document.getElementById('p-flawless').textContent = '+'+r.flawlessPayout+' P';
    document.querySelectorAll('.p-line').forEach(function(el){ el.style.opacity = 1; });
    document.getElementById('p-total').textContent = '+'+r.totalP+' P';
    document.getElementById('xp-earned').textContent = '+'+r.xpEarned+' XP';
    document.getElementById('progress-msg').textContent = OVERVIEW_MSGS[r.agg] || OVERVIEW_MSGS.D;
  }

  // The full ULTRAKILL-style end-of-level sequence: each category counts up,
  // then flashes white and tweens into its rank color, one after another —
  // finishing with the aggregate rank, then the P bonuses ticking the total up.
  async function playOverviewSequence(r){
    resetOverviewUI(r.total);
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      renderOverviewInstant(r);
      return;
    }

    const totalSec = Math.floor(r.timeMs/1000);
    const timeEl = document.getElementById('val-time');
    await countUp(timeEl, 0, totalSec, 700, function(v){
      const s = Math.floor(v);
      return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
    });
    await sleep(120);
    await revealRank(document.getElementById('badge-time'), r.timeRank);
    await sleep(350);

    const qEl = document.getElementById('val-q');
    await countUp(qEl, 0, r.cleanCount, 500, function(v){ return Math.round(v)+'/'+r.total; });
    await sleep(120);
    await revealRank(document.getElementById('badge-q'), r.qRank);
    await sleep(350);

    const accEl = document.getElementById('val-acc');
    await countUp(accEl, 0, r.accCount, 500, function(v){ return Math.round(v)+'/'+r.total; });
    await sleep(120);
    await revealRank(document.getElementById('badge-acc'), r.accRank);
    await sleep(500);

    const stamp = document.getElementById('agg-rank-stamp');
    await revealRank(stamp, r.agg);
    void stamp.offsetWidth;
    stamp.style.animation = '';
    document.getElementById('progress-msg').textContent = OVERVIEW_MSGS[r.agg] || OVERVIEW_MSGS.D;
    await sleep(650);

    const totalEl = document.getElementById('p-total');
    let running = 0;
    const lines = [
      { id:'p-base', amount:r.basePayout },
      { id:'p-style', amount:r.stylePayout },
      { id:'p-noredo', amount:r.noRedoPayout },
      { id:'p-flawless', amount:r.flawlessPayout }
    ];
    for(const line of lines){
      const rowEl = document.getElementById(line.id).closest('.p-line');
      document.getElementById(line.id).textContent = '+'+line.amount+' P';
      rowEl.style.transition = 'opacity .25s ease';
      rowEl.style.opacity = line.amount>0 ? 1 : 0.35;
      if(line.amount>0){
        const before = running;
        running += line.amount;
        await countUp(totalEl, before, running, 450, function(v){ return '+'+Math.round(v)+' P'; });
        await sleep(260);
      } else {
        await sleep(120);
      }
    }
    totalEl.textContent = '+'+r.totalP+' P';
    document.getElementById('xp-earned').textContent = '+'+r.xpEarned+' XP';
  }

  /* =========================================================
     SHOP / TERMINAL
     ========================================================= */
  function renderShop(msg){
    document.getElementById('shop-p-balance').textContent = player.p;
    document.getElementById('shop-msg').textContent = msg || '';
    const list = document.getElementById('shop-list');
    list.innerHTML = '';
    Object.values(POWERUPS).forEach(function(pu){
      const owned = player.inventory[pu.id] || 0;
      const canAfford = player.p >= pu.cost;
      const div = document.createElement('div');
      div.className = 'panel chamfer-sm shop-item';
      div.innerHTML =
        '<div class="row"><span class="name">'+pu.name+'</span><span class="cost">'+pu.cost+' P</span></div>'+
        '<div class="desc">'+pu.desc+'</div>'+
        '<div class="row"><span class="owned">OWNED × '+owned+'</span></div>'+
        '<button class="btn '+(canAfford?'btn-primary':'btn-ghost')+' chamfer" data-id="'+pu.id+'" '+(canAfford?'':'disabled')+'>Buy</button>';
      list.appendChild(div);
    });
    list.querySelectorAll('button[data-id]').forEach(function(btn){
      btn.addEventListener('click', function(){ buyPowerup(btn.getAttribute('data-id')); });
    });
  }
  function buyPowerup(id){
    const pu = POWERUPS[id];
    if(player.p < pu.cost){ renderShop('Not enough P for '+pu.name+'.'); return; }
    player.p -= pu.cost;
    player.inventory[id] = (player.inventory[id]||0) + 1;
    savePlayer();
    renderShop(pu.name+' acquired.');
  }

  /* =========================================================
     WIRE UP NAVIGATION
     ========================================================= */
  document.getElementById('btn-start-practice').addEventListener('click', openSetup);
  document.getElementById('btn-open-shop').addEventListener('click', function(){ renderShop(); showScreen('shop'); });
  document.getElementById('btn-quit-practice').addEventListener('click', function(){
    if(confirm('Abort this mission? Progress on this run will be lost.')){
      stopClock(); stopStyleDecay();
      renderDashboard();
      showScreen('dashboard');
    }
  });
  document.getElementById('btn-practice-again').addEventListener('click', openSetup);
  document.getElementById('btn-goto-shop').addEventListener('click', function(){ renderShop(); showScreen('shop'); });
  document.getElementById('btn-back-base').addEventListener('click', function(){ renderDashboard(); showScreen('dashboard'); });
  document.getElementById('btn-shop-back').addEventListener('click', function(){ renderDashboard(); showScreen('dashboard'); });

  /* =========================================================
     BOOT
     ========================================================= */
  async function boot(){
    showScreen('dashboard'); // safe default while we connect
    document.getElementById('subject-list').innerHTML =
      '<div class="loading-block"><div class="loading-spinner"></div><div class="label">Connecting</div></div>';
    try{
      await fetchSubjects();
    }catch(err){
      document.getElementById('subject-list').innerHTML =
        '<p class="inline-msg">Could not reach the local server. Make sure "python app.py" is running, then reload this page.</p>';
    }
    renderSubjectList();
    renderDashboard();
    const savedScreen = player.screen || 'dashboard';
    if(savedScreen === 'shop'){ renderShop(); showScreen('shop'); }
    else if(savedScreen === 'setup'){ openSetup(); }
  }
  boot();

})();