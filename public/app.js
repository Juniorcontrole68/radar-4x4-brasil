const $ = s => document.querySelector(s);
let pc = null;
let micStream = null;
let remoteAudio = null;

function setStatus(text, active = false) {
  $('#status').textContent = text;
  $('#orb').classList.toggle('active', active);
}

function addTranscript(who, text) {
  if (!text) return;
  const p = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `${who}: `;
  p.append(strong, document.createTextNode(text));
  $('#transcript').appendChild(p);
  $('#transcript').scrollTop = $('#transcript').scrollHeight;
}

async function startConversation() {
  $('#start').disabled = true;
  setStatus('Conectando…', true);
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        if (msg.type === 'conversation.item.input_audio_transcription.completed') addTranscript('Você', msg.transcript);
        if (msg.type === 'response.output_audio_transcript.done') addTranscript('Conversa de Bar', msg.transcript);
        if (msg.type === 'input_audio_buffer.speech_started') setStatus('Ouvindo…', true);
        if (msg.type === 'response.output_audio.delta') setStatus('Conversando…', true);
        if (msg.type === 'response.done') setStatus('Estou ouvindo', true);
      } catch {}
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await fetch('/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp
    });
    if (!response.ok) throw new Error(await response.text());
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
  } catch (error) {
    console.error(error);
    stopConversation();
    setStatus('Não foi possível iniciar');
    $('#hint').textContent = 'Verifique a permissão do microfone e a configuração do servidor.';
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
