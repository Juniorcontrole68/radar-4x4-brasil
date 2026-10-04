const $ = s => document.querySelector(s);
let pc = null;
let micStream = null;
let remoteAudio = null;

function setStatus(text, active = false) {
  $('#status').textContent = text;
  $('#orb').classList.toggle('active', active);
}

async function startConversation() {
  $('#start').disabled = true;
  setStatus('Conectando…', true);
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const tokenResponse = await fetch('/api/realtime/session', { method: 'POST' });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      const detail = tokenData?.error?.message || tokenData?.error || `Erro ${tokenResponse.status}`;
      throw new Error(detail);
    }
    const ephemeralKey = tokenData.value;
    if (!ephemeralKey) throw new Error('O servidor não retornou a credencial temporária.');

    pc = new RTCPeerConnection();
    remoteAudio = document.createElement('audio');
    remoteAudio.autoplay = true;
    pc.ontrack = e => { remoteAudio.srcObject = e.streams[0]; };
    micStream.getTracks().forEach(track => pc.addTrack(track, micStream));

    const dc = pc.createDataChannel('oai-events');
    dc.onopen = () => {
      setStatus('Estou ouvindo', true);
      $('#hint').textContent = 'Pode falar normalmente. Você pode me interromper enquanto eu estiver falando.';
      $('#start').hidden = true;
      $('#stop').hidden = false;
    };
    dc.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'input_audio_buffer.speech_started') setStatus('Ouvindo…', true);
        if (msg.type === 'response.output_audio.delta') setStatus('Conversando…', true);
        if (msg.type === 'response.done') setStatus('Estou ouvindo', true);
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
    if (!sdpResponse.ok) throw new Error(answerSdp || `Erro ${sdpResponse.status} ao conectar áudio.`);
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  } catch (error) {
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
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (pc) pc.close();
  pc = null;
  micStream = null;
  remoteAudio = null;
  $('#start').hidden = false;
  $('#start').disabled = false;
  $('#stop').hidden = true;
  setStatus('Pronto para conversar');
  $('#hint').textContent = 'Toque em iniciar uma vez. Depois, converse naturalmente.';
}

$('#start').addEventListener('click', startConversation);
$('#stop').addEventListener('click', stopConversation);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
