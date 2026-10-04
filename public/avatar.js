// Portrait movement runs locally and follows only the assistant's received audio.
const voiceAvatar = (() => {
  const canvas = document.querySelector('#avatar');
  const frame = document.querySelector('#orb');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let render = null, animation = 0, lastFrame = 0, level = 0;
  let audioContext = null, source = null, analyser = null, silentGain = null, samples = null;
  const portrait = new Image();

  function createRenderer(image) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return null;
    const vertex = 'attribute vec2 position; varying vec2 uv; void main(){uv=vec2((position.x+1.0)*0.5,(1.0-position.y)*0.5); gl_Position=vec4(position,0.0,1.0);}';
    const fragment = `precision mediump float;
      varying vec2 uv;
      uniform sampler2D portrait;
      uniform float voice;
      void main() {
        vec2 p=uv;
        float dx=(p.x-0.5)/0.13;
        float dy=(p.y-0.696)/0.072;
        float mouth=exp(-pow(dx,4.0)-pow(dy,4.0));
        p.y=0.696+(p.y-0.696)/(1.0+voice*0.95*mouth);
        p.x=0.5+(p.x-0.5)/(1.0+voice*0.025*mouth);
        float jaw=exp(-pow((p.x-0.5)/0.23,4.0)-pow((p.y-0.81)/0.12,4.0));
        p.y-=voice*0.004*jaw;
        gl_FragColor=texture2D(portrait,p);
      }`;
    function compile(type, code) {
      const shader=gl.createShader(type);
      gl.shaderSource(shader,code); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error('Avatar shader unavailable');
      return shader;
    }
    const program=gl.createProgram();
    gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    const buffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const texture=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);
    const voice=gl.getUniformLocation(program,'voice');
    gl.viewport(0,0,canvas.width,canvas.height);
    return amplitude => {
      gl.uniform1f(voice,amplitude);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    };
  }

  function draw(time) {
    animation=0;
    if (document.visibilityState !== 'visible') return;
    if (time-lastFrame>=30) {
      lastFrame=time;
      let target=0;
      if (analyser && audioContext?.state==='running') {
        analyser.getFloatTimeDomainData(samples);
        let sum=0;
        for (const sample of samples) sum+=sample*sample;
        const rms=Math.sqrt(sum/samples.length);
        target=Math.min(1,Math.max(0,(rms-0.008)*9));
      }
      level+=(target-level)*(target>level?0.65:0.38);
      if (render) render(level);
      const live=frame.classList.contains('active');
      const tilt=reducedMotion.matches?0:Math.sin(time/2300)*(live?0.55:0.15)+level*0.35;
      frame.style.setProperty('--face-tilt',tilt+'deg');
      frame.style.setProperty('--face-scale',String(1+level*0.008));
      frame.classList.toggle('speaking',level>0.025);
    }
    animation=requestAnimationFrame(draw);
  }
  function startFrames() {
    if (!animation && document.visibilityState==='visible') animation=requestAnimationFrame(draw);
  }
  function prepareAudio() {
    try {
      const Audio=window.AudioContext||window.webkitAudioContext;
      if (!Audio) return;
      if (!audioContext || audioContext.state==='closed') audioContext=new Audio();
      audioContext.resume().catch(()=>{});
    } catch { /* Portrait stays available even when audio analysis is unsupported. */ }
  }
  function attach(stream) {
    try {
      prepareAudio();
      if (!audioContext) return;
      source?.disconnect(); analyser?.disconnect(); silentGain?.disconnect();
      source=audioContext.createMediaStreamSource(stream);
      analyser=audioContext.createAnalyser(); analyser.fftSize=512;
      samples=new Float32Array(analyser.fftSize);
      silentGain=audioContext.createGain(); silentGain.gain.value=0;
      source.connect(analyser); analyser.connect(silentGain); silentGain.connect(audioContext.destination);
      startFrames();
    } catch { /* Audio playback uses its own unchanged audio element. */ }
  }
  function stop() {
    source?.disconnect(); analyser?.disconnect(); silentGain?.disconnect();
    source=null; analyser=null; silentGain=null; samples=null;
    const oldContext=audioContext; audioContext=null;
    if (oldContext && oldContext.state!=='closed') oldContext.close().catch(()=>{});
    level=0; render?.(0); frame.classList.remove('speaking');
  }
  portrait.onload=() => {
    try { render=createRenderer(portrait); } catch { render=null; }
    if (render) { render(0); frame.classList.add('avatar-ready'); }
    startFrames();
  };
  portrait.src='/avatar-loira.jpg';
  document.addEventListener('visibilitychange',()=>{
    if (document.visibilityState==='visible') {
      if (audioContext?.state==='suspended') audioContext.resume().catch(()=>{});
      startFrames();
    } else if (animation) { cancelAnimationFrame(animation); animation=0; }
  });
  return {prepareAudio,attach,stop};
})();
