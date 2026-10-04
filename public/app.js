const $ = s => document.querySelector(s);
const currentProfile = () => typeof assistantProfile === 'undefined' ? { name: 'Carol' } : assistantProfile;
const companionName = () => currentProfile().name;
let pc = null;
let micStream = null;
let remoteAudio = null;
let connectionTimer = null;
let attempt = 0;
const resumeAudio = document.createElement('button');
resumeAudio.className = 'secondary';
resumeAudio.textContent = 'Retomar áudio';
resumeAudio.hidden = true;
$('#stop').after(resumeAudio);

async function playRemoteAudio() {
  if (!conversationActive || !remoteAudio?.srcObject) return;
  try {
    await remoteAudio.play();
    resumeAudio.hidden = true;
  } catch {
    resumeAudio.hidden = false;
    $('#hint').textContent = 'Toque em Retomar áudio para voltar a ouvir ' + companionName() + '.';
  }
}
resumeAudio.addEventListener('click', () => {
  voiceAvatar.prepareAudio();
  updateConversationHint();
  playRemoteAudio();
});

function connectionChanged() {
  clearTimeout(connectionTimer);
  if (!conversationActive || !pc) return;
  if (pc.connectionState === 'connected') {
    setStatus(companionName() + ' está ouvindo', true);
    updateConversationHint();
    playRemoteAudio();
  } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
    connectionLost();
  } else if (pc.connectionState === 'disconnected') {
    setStatus('Conexão interrompida');
    $('#hint').textContent = 'Tentando recuperar a conexão…';
    connectionTimer = setTimeout(() => {
      if (conversationActive && pc?.connectionState === 'disconnected') connectionLost();
    }, 10000);
  }
}
function connectionLost() {
  stopConversation();
  setStatus('A conversa foi desconectada');
  $('#hint').textContent = 'Confira sua internet e toque em Iniciar conversa para reconectar.';
}

let conversationActive = false;
let screenLock = null;
let screenLockPending = false;

function updateConversationHint() {
  if (!conversationActive || !pc || pc.connectionState !== 'connected') return;
  const screenHint = screenLock && !screenLock.released
    ? 'A tela ficará ligada durante a conversa.'
    : 'Mantenha a tela ligada para continuar ouvindo e falando.';
  $('#hint').textContent = 'Pode falar normalmente e me interromper. ' + screenHint;
}

async function keepScreenAwake() {
  if (!conversationActive || document.visibilityState !== 'visible' ||
      !navigator.wakeLock || screenLockPending ||
      (screenLock && !screenLock.released)) return;
  screenLockPending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!conversationActive || document.visibilityState !== 'visible') {
      await lock.release();
      return;
    }
    screenLock = lock;
    lock.addEventListener('release', () => {
      if (screenLock === lock) screenLock = null;
      updateConversationHint();
    });
    updateConversationHint();
  } catch {
    updateConversationHint();
  } finally {
    screenLockPending = false;
  }
}

function releaseScreenLock() {
  const lock = screenLock;
  screenLock = null;
  if (lock) lock.release().catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && conversationActive) {
    keepScreenAwake();
    voiceAvatar.prepareAudio();
    playRemoteAudio();
  }
});

function setStatus(text, active = false) {
  $('#status').textContent = text;
  $('#orb').classList.toggle('active', active);
}

async function startConversation() {
  if (conversationActive) return;
  const currentAttempt = ++attempt;
  $('#start').disabled = true;
  conversationActive = true;
  voiceAvatar.prepareAudio();
  keepScreenAwake();
  setStatus('Conectando…', true);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (currentAttempt !== attempt) { stream.getTracks().forEach(t => t.stop()); return; }
    micStream = stream;

    const tokenResponse = await fetch('/api/realtime/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...currentProfile(), ...(window.conversationMemory?.sessionOptions() || {}) }) });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (currentAttempt !== attempt) return;
    if (!tokenResponse.ok) {
      const detail = tokenData?.error?.message || tokenData?.error || `Erro ${tokenResponse.status}`;
      throw new Error(detail);
    }
    const ephemeralKey = tokenData.value;
    if (!ephemeralKey) throw new Error('O servidor não retornou a credencial temporária.');

    pc = new RTCPeerConnection();
    remoteAudio = document.createElement('audio');
    remoteAudio.autoplay = true;
    remoteAudio.playsInline = true;
    pc.onconnectionstatechange = connectionChanged;
    pc.ontrack = e => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      remoteAudio.srcObject = stream;
      voiceAvatar.attach(stream);
      playRemoteAudio();
    };
    micStream.getTracks().forEach(track => pc.addTrack(track, micStream));

    const memoryEpoch = window.conversationMemory?.epoch();
    const dc = pc.createDataChannel('oai-events');
    dc.onopen = () => {
      setStatus(companionName() + ' está ouvindo', true);
      updateConversationHint();
      $('#start').hidden = true;
      $('#stop').hidden = false;
      if ($('#profile-form')) dc.send(JSON.stringify({ type: 'response.create' }));
    };
    dc.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'input_audio_buffer.speech_started') setStatus('Ouvindo…', true);
        if (msg.type === 'output_audio_buffer.started') setStatus(companionName() + ' está falando', true);
        if (msg.type === 'output_audio_buffer.stopped' || msg.type === 'output_audio_buffer.cleared') setStatus(companionName() + ' está ouvindo', true);
        if (msg.type === 'response.done' && msg.response?.status === 'completed') {
          let called = false;
          for (const item of msg.response.output || []) {
            if (item.type !== 'function_call' || item.name !== 'save_memory') continue;
            let saved = false;
            try { saved = window.conversationMemory?.save(JSON.parse(item.arguments).summary, memoryEpoch) === true; } catch {}
            dc.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ saved }) } }));
            called = true;
          }
          if (called && dc.readyState === 'open') dc.send(JSON.stringify({ type: 'response.create' }));
        }
        if (msg.type === 'error') console.error('Realtime API:', msg.error);
      } catch {}
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        'Content-Type': 'application/sdp'
      }
    });
    const answerSdp = await sdpResponse.text();
    if (currentAttempt !== attempt) return;
    if (!sdpResponse.ok) throw new Error(answerSdp || `Erro ${sdpResponse.status} ao conectar áudio.`);
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  } catch (error) {
    if (currentAttempt !== attempt) return;
    console.error(error);
    const message = String(error?.message || error || 'Erro desconhecido');
    stopConversation();
    setStatus('Não foi possível iniciar');
    $('#hint').textContent = message.includes('Permission') || message.includes('NotAllowed')
      ? 'Permita o uso do microfone no navegador e tente novamente.'
      : `Falha na conexão: ${message.slice(0, 160)}`;
    $('#start').disabled = false;
  }
}

function stopConversation() {
  conversationActive = false;
  ++attempt;
  clearTimeout(connectionTimer);
  connectionTimer = null;
  resumeAudio.hidden = true;
  releaseScreenLock();
  voiceAvatar.stop();
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (remoteAudio) { remoteAudio.pause(); remoteAudio.srcObject = null; }
  if (pc) { pc.onconnectionstatechange = null; pc.close(); }
  pc = null;
  micStream = null;
  remoteAudio = null;
  $('#start').hidden = false;
  $('#start').disabled = false;
  $('#stop').hidden = true;
  setStatus(companionName() + ' está pronto para conversar');
  $('#hint').textContent = 'Toque em iniciar uma vez. Depois, converse naturalmente.';
}

$('#start').addEventListener('click', startConversation);
$('#stop').addEventListener('click', stopConversation);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
