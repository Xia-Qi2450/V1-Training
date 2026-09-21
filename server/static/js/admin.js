(function(){
  "use strict";

  const NEW_SUBJECT_VALUE = '__new__';

  async function apiGetSubjects(){
    const res = await fetch('/api/subjects');
    if(!res.ok) throw new Error('Could not load subjects.');
    return res.json();
  }

  async function apiGetQuestions(params){
    params = params || {};
    const qs = Object.keys(params)
      .filter(function(k){ return params[k] !== undefined && params[k] !== ''; })
      .map(function(k){ return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
    const res = await fetch('/api/questions' + (qs ? ('?' + qs) : ''));
    if(!res.ok) throw new Error('Could not load questions.');
    return res.json();
  }

  async function apiCreateQuestion(payload){
    const res = await fetch('/api/questions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(function(){ return {}; });
    if(!res.ok) throw new Error(body.error || 'Could not add question.');
    return body;
  }

  async function apiDeleteQuestion(id){
    const res = await fetch('/api/questions/' + id, { method:'DELETE' });
    const body = await res.json().catch(function(){ return {}; });
    if(!res.ok) throw new Error(body.error || 'Could not delete question.');
    return body;
  }

  function escapeHtml(str){
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  /* =========================================================
     AI-Assisted Generation
     The teacher builds a prompt here, runs it in whatever AI
     chatbot they already use, and pastes the JSON reply back
     in. Nothing calls an AI API directly — there's no key, no
     cost, and every question is shown for review before it's
     ever written to the database.
     ========================================================= */

  function buildAIPrompt(subject, topic, level, count){
    const topicClause = topic ? (' focused on "' + topic + '"') : '';
    const levelClause = level ? (' at a ' + level + ' level') : '';
    return 'You are helping a teacher write multiple-choice practice questions for a students’ revision app.\n\n' +
      'Generate exactly ' + count + ' multiple-choice questions for the subject "' + subject + '"' + topicClause + levelClause + '.\n\n' +
      'Return ONLY a valid JSON array — no markdown code fences, no commentary, no text before or after it. ' +
      'Each item in the array must be an object with exactly these keys:\n' +
      '- "subject": string, exactly "' + subject + '"\n' +
      '- "question": string, the question text\n' +
      '- "options": an array of exactly 4 strings (the answer choices)\n' +
      '- "answer": an integer from 0 to 3, the index into "options" of the correct answer\n' +
      '- "explanation": a short 1-2 sentence explanation of why the correct answer is correct\n\n' +
      'Requirements:\n' +
      '- Double-check every fact, date, formula, name and spelling before including it — accuracy matters more than difficulty.\n' +
      '- Make the 3 incorrect options plausible, not obviously wrong.\n' +
      '- Keep each question and option concise.\n' +
      '- Do not repeat the same question twice.\n' +
      '- Output must be valid JSON, parseable directly by JSON.parse().';
  }

  document.getElementById('btn-build-prompt').addEventListener('click', function(){
    const subject = document.getElementById('ai-subject').value.trim();
    const topic = document.getElementById('ai-topic').value.trim();
    const level = document.getElementById('ai-level').value.trim();
    let count = parseInt(document.getElementById('ai-count').value, 10);
    if(!count || count < 1) count = 5;
    if(count > 20) count = 20;
    document.getElementById('ai-count').value = count;

    if(!subject){
      alert('Enter a subject first.');
      return;
    }
    document.getElementById('ai-prompt-output').value = buildAIPrompt(subject, topic, level, count);
    document.getElementById('ai-prompt-wrap').style.display = 'block';
    document.getElementById('ai-preview-list').innerHTML = '';
    document.getElementById('btn-import-ai').style.display = 'none';
    document.getElementById('ai-parse-msg').textContent = '';
  });

  document.getElementById('btn-copy-prompt').addEventListener('click', async function(){
    const msg = document.getElementById('copy-msg');
    const text = document.getElementById('ai-prompt-output').value;
    try{
      await navigator.clipboard.writeText(text);
      msg.textContent = 'Copied to clipboard.';
      msg.className = 'inline-msg ok';
    }catch(e){
      document.getElementById('ai-prompt-output').select();
      msg.textContent = 'Could not auto-copy — text is selected, press Ctrl/Cmd+C.';
      msg.className = 'inline-msg err';
    }
  });

  // Strips common wrapping (like ```json fences) some chatbots add
  // despite instructions, then parses and validates each question.
  function parseAndValidateAIJson(text){
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    let data;
    try{
      data = JSON.parse(cleaned);
    }catch(e){
      throw new Error('That doesn’t look like valid JSON. Make sure you pasted the AI’s full reply, with nothing extra before or after it.');
    }
    if(!Array.isArray(data)){
      throw new Error('Expected a JSON array of questions (the AI may have wrapped it in an object instead).');
    }

    const valid = [];
    const invalid = [];
    data.forEach(function(item, idx){
      const reasons = [];
      const subject = item && typeof item.subject === 'string' ? item.subject.trim() : '';
      const question = item && typeof item.question === 'string' ? item.question.trim() : '';
      const options = item && Array.isArray(item.options) ? item.options.map(function(o){ return String(o).trim(); }) : [];
      const answer = item ? item.answer : undefined;
      const explanation = item && typeof item.explanation === 'string' ? item.explanation.trim() : '';

      if(!subject) reasons.push('missing subject');
      if(!question) reasons.push('missing question text');
      if(options.length !== 4 || options.some(function(o){return !o;})) reasons.push('needs exactly 4 non-empty options');
      if(!(Number.isInteger(answer) && answer>=0 && answer<=3)) reasons.push('answer must be 0-3');
      if(!explanation) reasons.push('missing explanation');

      if(reasons.length){
        invalid.push({ index:idx, reasons:reasons, raw:item });
      }else{
        valid.push({ subject:subject, question:question, options:options, answer:answer, explanation:explanation });
      }
    });
    return { valid:valid, invalid:invalid };
  }

  document.getElementById('btn-parse-ai').addEventListener('click', function(){
    const msg = document.getElementById('ai-parse-msg');
    const previewWrap = document.getElementById('ai-preview-list');
    const importBtn = document.getElementById('btn-import-ai');
    previewWrap.innerHTML = '';
    importBtn.style.display = 'none';

    const raw = document.getElementById('ai-json-input').value;
    if(!raw.trim()){
      msg.textContent = 'Paste the AI’s JSON reply first.';
      msg.className = 'inline-msg err';
      return;
    }

    let result;
    try{
      result = parseAndValidateAIJson(raw);
    }catch(err){
      msg.textContent = err.message;
      msg.className = 'inline-msg err';
      return;
    }

    if(result.invalid.length){
      const errBlock = document.createElement('p');
      errBlock.className = 'inline-msg err';
      errBlock.textContent = result.invalid.length + ' item(s) skipped (invalid): ' +
        result.invalid.map(function(x){ return '#'+(x.index+1)+' — '+x.reasons.join(', '); }).join('; ');
      previewWrap.appendChild(errBlock);
    }

    if(result.valid.length === 0){
      msg.textContent = 'No valid questions found in that reply.';
      msg.className = 'inline-msg err';
      return;
    }

    msg.textContent = result.valid.length + ' question(s) ready to review below.';
    msg.className = 'inline-msg ok';

    const letters = ['A','B','C','D'];
    result.valid.forEach(function(q, i){
      const card = document.createElement('div');
      card.className = 'panel chamfer-sm qcard';
      const optsHtml = q.options.map(function(opt,oi){
        return '<div class="' + (oi===q.answer ? 'correct' : '') + '">' + letters[oi] + '. ' + escapeHtml(opt) + (oi===q.answer ? ' ✓' : '') + '</div>';
      }).join('');
      card.innerHTML =
        '<div class="top">' +
          '<div style="flex:1;">' +
            '<span class="subj">' + escapeHtml(q.subject) + '</span>' +
            '<span class="ai-badge">⚠ AI GENERATED</span>' +
            '<div class="qtext">' + escapeHtml(q.question) + '</div>' +
            '<div class="opts">' + optsHtml + '</div>' +
            '<div class="explain">' + escapeHtml(q.explanation) + '</div>' +
          '</div>' +
          '<label style="display:flex; align-items:center; gap:6px; font-family:var(--font-mono); font-size:11px; color:var(--grey);">' +
            '<input type="checkbox" class="ai-include" data-idx="' + i + '" checked style="width:16px; height:16px; accent-color:var(--green);"> Import' +
          '</label>' +
        '</div>';
      previewWrap.appendChild(card);
    });

    importBtn.style.display = 'block';
    importBtn.dataset.pending = JSON.stringify(result.valid);
  });

  document.getElementById('btn-import-ai').addEventListener('click', async function(){
    const btn = this;
    const msg = document.getElementById('ai-parse-msg');
    const pending = JSON.parse(btn.dataset.pending || '[]');
    const checks = document.querySelectorAll('.ai-include');
    const toImport = pending.filter(function(_, i){
      const box = document.querySelector('.ai-include[data-idx="'+i+'"]');
      return box ? box.checked : true;
    });

    if(toImport.length === 0){
      msg.textContent = 'Nothing checked to import.';
      msg.className = 'inline-msg err';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Importing…';
    let ok = 0, failed = 0;
    for(const q of toImport){
      try{
        await apiCreateQuestion({
          subject:q.subject, question:q.question, options:q.options,
          answer:q.answer, explanation:q.explanation, ai_generated:true
        });
        ok++;
      }catch(e){ failed++; }
    }
    btn.disabled = false;
    btn.textContent = 'Import Reviewed Questions';

    msg.textContent = ok + ' question(s) imported' + (failed ? (', ' + failed + ' failed') : '') + '.';
    msg.className = failed ? 'inline-msg err' : 'inline-msg ok';

    document.getElementById('ai-json-input').value = '';
    document.getElementById('ai-preview-list').innerHTML = '';
    btn.style.display = 'none';
    currentPage = 1;
    await refreshSubjectDropdowns();
    await renderQuestionList();
  });

  async function refreshSubjectDropdowns(){
    let subjects = [];
    try{ subjects = await apiGetSubjects(); }catch(e){ /* server may just have no data yet */ }

    const addSelect = document.getElementById('f-subject-select');
    const filterSelect = document.getElementById('filter-subject');
    const prevFilter = filterSelect.value;
    const prevAdd = addSelect.value;

    addSelect.innerHTML = '';
    subjects.forEach(function(s){
      const opt = document.createElement('option');
      opt.value = s.subject; opt.textContent = s.subject + ' (' + s.count + ')';
      addSelect.appendChild(opt);
    });
    const newOpt = document.createElement('option');
    newOpt.value = NEW_SUBJECT_VALUE; newOpt.textContent = '+ New subject…';
    addSelect.appendChild(newOpt);
    if(subjects.some(function(s){return s.subject===prevAdd;})) addSelect.value = prevAdd;

    filterSelect.innerHTML = '<option value="">All subjects</option>';
    subjects.forEach(function(s){
      const opt = document.createElement('option');
      opt.value = s.subject; opt.textContent = s.subject + ' (' + s.count + ')';
      filterSelect.appendChild(opt);
    });
    if(subjects.some(function(s){return s.subject===prevFilter;})) filterSelect.value = prevFilter;
  }

  document.getElementById('f-subject-select').addEventListener('change', function(e){
    document.getElementById('f-subject-new').style.display = e.target.value === NEW_SUBJECT_VALUE ? 'block' : 'none';
  });

  const PAGE_SIZE = 10;
  let currentPage = 1;
  let searchDebounce = null;

  function showListLoading(){
    document.getElementById('question-list').innerHTML =
      '<div class="loading-block">' +
        '<div class="loading-spinner"></div>' +
        '<div class="label">Loading questions</div>' +
        '<div class="sub">Slow connection? This can take a moment.</div>' +
      '</div>';
    document.getElementById('pagination-controls').innerHTML = '';
  }

  async function renderQuestionList(){
    const listMsg = document.getElementById('list-msg');
    const wrap = document.getElementById('question-list');
    const pager = document.getElementById('pagination-controls');
    const subject = document.getElementById('filter-subject').value;
    const search = document.getElementById('search-questions').value.trim();
    listMsg.textContent = '';
    listMsg.className = 'inline-msg';
    showListLoading();

    let data;
    try{
      data = await apiGetQuestions({ subject: subject || undefined, search: search || undefined, page: currentPage, per_page: PAGE_SIZE });
    }catch(err){
      listMsg.textContent = err.message + ' Make sure "python app.py" is running.';
      listMsg.className = 'inline-msg err';
      wrap.innerHTML = '';
      pager.innerHTML = '';
      document.getElementById('q-count').textContent = '—';
      return;
    }

    currentPage = data.page; // server clamps out-of-range pages, stay in sync
    document.getElementById('q-count').textContent = data.total + ' question' + (data.total===1?'':'s');
    wrap.innerHTML = '';
    if(data.items.length === 0){
      wrap.innerHTML = '<p class="empty-note">' + (search || subject ? 'No questions match this search/filter.' : 'No questions here yet. Add one above.') + '</p>';
      pager.innerHTML = '';
      return;
    }
    const letters = ['A','B','C','D'];
    data.items.forEach(function(q){
      const card = document.createElement('div');
      card.className = 'panel chamfer-sm qcard';
      const optsHtml = q.options.map(function(opt,i){
        return '<div class="' + (i===q.answer ? 'correct' : '') + '">' + letters[i] + '. ' + escapeHtml(opt) + (i===q.answer ? ' \u2713' : '') + '</div>';
      }).join('');
      card.innerHTML =
        '<div class="top">' +
          '<div style="flex:1;">' +
            '<span class="subj">' + escapeHtml(q.subject) + '</span>' +
            (q.ai_generated ? '<span class="ai-badge">\u26A0 AI GENERATED</span>' : '') +
            '<div class="qtext">' + escapeHtml(q.question) + '</div>' +
            '<div class="opts">' + optsHtml + '</div>' +
            '<div class="explain">' + escapeHtml(q.explanation) + '</div>' +
          '</div>' +
          '<button class="btn-danger" data-id="' + q.id + '">Delete</button>' +
        '</div>';
      wrap.appendChild(card);
    });
    wrap.querySelectorAll('button[data-id]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        if(!confirm('Delete this question? This cannot be undone.')) return;
        btn.disabled = true;
        try{
          await apiDeleteQuestion(parseInt(btn.getAttribute('data-id'), 10));
          await refreshSubjectDropdowns();
          await renderQuestionList();
        }catch(err){
          listMsg.textContent = err.message;
          listMsg.className = 'inline-msg err';
          btn.disabled = false;
        }
      });
    });

    renderPagination(data);
  }

  function renderPagination(data){
    const pager = document.getElementById('pagination-controls');
    if(data.total_pages <= 1){ pager.innerHTML = ''; return; }
    pager.innerHTML =
      '<button id="page-prev" ' + (data.page<=1 ? 'disabled':'') + '>\u2190 Prev</button>' +
      '<span class="page-indicator">Page ' + data.page + ' / ' + data.total_pages + '</span>' +
      '<button id="page-next" ' + (data.page>=data.total_pages ? 'disabled':'') + '>Next \u2192</button>';
    const prevBtn = document.getElementById('page-prev');
    const nextBtn = document.getElementById('page-next');
    if(prevBtn) prevBtn.addEventListener('click', function(){ currentPage = Math.max(1, currentPage-1); renderQuestionList(); });
    if(nextBtn) nextBtn.addEventListener('click', function(){ currentPage = currentPage+1; renderQuestionList(); });
  }

  document.getElementById('filter-subject').addEventListener('change', function(){
    currentPage = 1;
    renderQuestionList();
  });

  document.getElementById('search-questions').addEventListener('input', function(){
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function(){
      currentPage = 1;
      renderQuestionList();
    }, 350);
  });

  document.getElementById('btn-add').addEventListener('click', async function(){
    const msg = document.getElementById('form-msg');
    const select = document.getElementById('f-subject-select');
    const subject = select.value === NEW_SUBJECT_VALUE
      ? document.getElementById('f-subject-new').value.trim()
      : select.value;
    const question = document.getElementById('f-question').value.trim();
    const options = [0,1,2,3].map(function(i){ return document.getElementById('f-opt-'+i).value.trim(); });
    const correctRadio = document.querySelector('input[name="f-correct"]:checked');
    const answer = correctRadio ? parseInt(correctRadio.value, 10) : 0;
    const explanation = document.getElementById('f-explain').value.trim();

    msg.className = 'inline-msg';
    if(!subject){ msg.textContent = 'Choose or type a subject.'; msg.className = 'inline-msg err'; return; }
    if(!question){ msg.textContent = 'Question text is required.'; msg.className = 'inline-msg err'; return; }
    if(options.some(function(o){return !o;})){ msg.textContent = 'All four options are required.'; msg.className = 'inline-msg err'; return; }
    if(!explanation){ msg.textContent = 'An explanation is required.'; msg.className = 'inline-msg err'; return; }

    const btn = document.getElementById('btn-add');
    btn.disabled = true;
    try{
      await apiCreateQuestion({ subject:subject, question:question, options:options, answer:answer, explanation:explanation });
      msg.textContent = 'Question added.';
      msg.className = 'inline-msg ok';
      document.getElementById('f-question').value = '';
      [0,1,2,3].forEach(function(i){ document.getElementById('f-opt-'+i).value = ''; });
      document.getElementById('f-explain').value = '';
      document.getElementById('f-subject-new').value = '';
      document.getElementById('f-subject-new').style.display = 'none';
      currentPage = 1;
      await refreshSubjectDropdowns();
      select.value = subject;
      await renderQuestionList();
    }catch(err){
      msg.textContent = err.message;
      msg.className = 'inline-msg err';
    }finally{
      btn.disabled = false;
    }
  });

  (async function boot(){
    await refreshSubjectDropdowns();
    await renderQuestionList();
  })();

})();