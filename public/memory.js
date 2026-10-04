(() => {
  const panel = document.querySelector('#memory-panel');
  if (!panel) return;
  const key = 'conversa-memory-v1';
  let state = { enabled: false, summary: '' };
  let privateConversation = false;
  let generation = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved) state = { enabled: saved.enabled === true, summary: typeof saved.summary === 'string' ? saved.summary.slice(0, 3000) : '' };
  } catch {}
  panel.innerHTML = `<h2>Memória</h2>
    <label class="check"><input id="remember-me" type="checkbox"> Lembrar de mim neste aparelho</label>
    <label class="check"><input id="private-chat" type="checkbox"> Conversa privada — sem consultar nem salvar memória</label>
    <p class="small">Salvamos só um resumo, sem áudio nem transcrição. A memória não é compartilhada com outros aparelhos. Desativar a memória conserva o resumo até você apagá-lo.</p>
    <button id="view-memory" type="button" class="secondary">Minha memória</button>
    <div id="memory-editor" hidden><label for="memory-summary">Resumo salvo — você pode editar ou apagar informações</label>
    <textarea id="memory-summary" rows="6" maxlength="3000" style="width:100%;box-sizing:border-box"></textarea>
    <button id="save-memory" type="button" class="secondary">Salvar alterações</button></div>
    <button id="forget-memory" type="button" class="secondary">Esquecer tudo</button>
    <p id="memory-notice" class="small" role="status"></p>`;
  const find = id => panel.querySelector('#' + id);
  find('remember-me').checked = state.enabled;
  const notify = text => { find('memory-notice').textContent = text; };
  const persist = () => {
    try { localStorage.setItem(key, JSON.stringify(state)); return true; }
    catch { notify('Não foi possível salvar a memória neste navegador.'); return false; }
  };
  const interrupt = () => {
    generation++;
    if (typeof stopConversation === 'function') stopConversation();
  };
  find('remember-me').addEventListener('change', () => {
    interrupt(); state.enabled = find('remember-me').checked;
    if (!persist()) { state.enabled = false; find('remember-me').checked = false; return; }
    notify('Preferência atualizada. Inicie uma nova conversa.');
  });
  find('private-chat').addEventListener('change', () => {
    interrupt(); privateConversation = find('private-chat').checked;
    notify('Modo atualizado. Inicie uma nova conversa.');
  });
  find('view-memory').addEventListener('click', () => {
    find('memory-editor').hidden = !find('memory-editor').hidden;
    find('memory-summary').value = state.summary;
  });
  find('save-memory').addEventListener('click', () => {
    interrupt(); state.summary = find('memory-summary').value.trim().slice(0, 3000);
    if (persist()) notify('Resumo atualizado. Inicie uma nova conversa para usar as alterações.');
  });
  find('forget-memory').addEventListener('click', () => {
    interrupt(); state = { enabled: false, summary: '' };
    find('remember-me').checked = false; find('memory-summary').value = '';
    try { localStorage.removeItem(key); notify('Toda a memória foi apagada. A opção Lembrar de mim foi desativada.'); }
    catch { notify('Não foi possível apagar a memória do navegador.'); }
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      interrupt();
      try { const saved = JSON.parse(localStorage.getItem(key) || 'null'); state = { enabled: saved?.enabled === true, summary: typeof saved?.summary === 'string' ? saved.summary.slice(0,3000) : '' }; } catch { state = { enabled: false, summary: '' }; }
      find('remember-me').checked = state.enabled; find('memory-summary').value = state.summary;
      notify('Memória alterada em outra aba. Inicie uma nova conversa.');
    }
  });
  window.conversationMemory = {
    epoch: () => generation,
    sessionOptions: () => ({ memoryEnabled: state.enabled && !privateConversation, privateConversation, memorySummary: state.enabled && !privateConversation ? state.summary : '' }),
    save: (summary, epoch) => {
      if (epoch !== generation || !state.enabled || privateConversation || typeof summary !== 'string' || !summary.trim() || summary.length > 3000) return false;
      state.summary = summary.trim();
      if (!persist()) return false;
      if (find('memory-editor').hidden) find('memory-summary').value = state.summary;
      notify('Resumo da memória atualizado.'); return true;
    }
  };
})();
