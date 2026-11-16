// Кольцо карточек вокруг портрета на первом экране.
// Сцена повторяет референс: изогнутые стеклянные карточки с цветной иконкой и ч/б фото на приплюснутом кольце.
// Портрет рисуется в той же WebGL-сцене в плоскости z = 0: задняя половина кольца уходит за голову,
// передняя проходит перед лицом. Стекло матовое по-настоящему: под ним размытая копия того, что за ним.
// Дальние карточки размываются, развёрнутые к голове показывают оборот из матового стекла.
// Без WebGL2 работает CSS-кольцо из плоских карточек (его же видно без скриптов).
(() => {
  const root = document.documentElement;
  const stage = document.querySelector('[data-stage]');
  const scene = document.querySelector('[data-scene]');
  const ringEl = document.querySelector('[data-ring]');
  const hero = document.getElementById('top');
  const portrait = scene?.querySelector('.portrait');
  if (!stage || !scene || !ringEl || !portrait) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Геометрия в долях высоты сцены H. Те же числа задают CSS-кольцо в styles.css.
  const G = {
    ringY: 0.38, k: 0.45, tiltX: -8, tiltZ: -2, persp: 3.2, perspY: 0.3, curve: 0.45, wire: 1.5,
    ui: { r: 0.54, w: 0.38, h: 0.185, rad: 0.034 },
    photo: { r: 0.5, w: 0.27, h: 0.24, rad: 0.028 },
  };
  // Кольцо не крутится по кругу, а мягко покачивается вокруг композиции референса и доворачивается при прокрутке:
  // так первый экран всегда похож на скрин, а фото не закрывают лицо.
  const SWAY = 14; // градусов в каждую сторону
  const PERIOD = 18; // секунд на полный цикл
  const SCROLL = 0.05; // градусов на пиксель прокрутки
  const DEG = Math.PI / 180;

  let angle = 0;
  let tiltX = 0;
  let tiltY = 0;
  let targetX = 0;
  let targetY = 0;
  let clock = 0;
  let last = 0;
  let frame = 0;
  let visible = false;
  let draw = null;

  const tick = (now) => {
    clock += Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    angle = -SWAY * Math.sin((clock / PERIOD) * Math.PI * 2) - scrollY * SCROLL;
    tiltX += (targetX - tiltX) * 0.06;
    tiltY += (targetY - tiltY) * 0.06;
    scene.style.transform = `rotateY(${tiltX.toFixed(2)}deg) rotateX(${tiltY.toFixed(2)}deg)`;
    if (draw) draw(angle);
    else ringEl.style.setProperty('--a', `${angle.toFixed(2)}deg`);
    frame = requestAnimationFrame(tick);
  };

  const start = () => {
    cancelAnimationFrame(frame);
    if (still || !visible) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
    else cancelAnimationFrame(frame);
  }).observe(stage);

  if (!still && matchMedia('(hover: hover)').matches) {
    hero.addEventListener('pointermove', (event) => {
      const box = hero.getBoundingClientRect();
      targetX = ((event.clientX - box.left) / box.width - 0.5) * 7;
      targetY = ((event.clientY - box.top) / box.height - 0.5) * -3;
    }, { passive: true });
  }

  const fallback = () => {
    draw = null;
    root.classList.remove('gl');
    root.classList.add('no-gl');
  };

  setup().then((render) => {
    if (!render) return fallback();
    draw = render;
    render(angle);
    root.classList.add('gl');
    root.classList.remove('no-gl');
  }).catch((error) => {
    console.warn('Кольцо WebGL не собралось, остаётся CSS-версия:', error);
    fallback();
  });

  // ---------- WebGL ----------

  async function setup() {
    const canvas = document.createElement('canvas');
    canvas.className = 'ring-gl';
    canvas.setAttribute('aria-hidden', 'true');
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) return null;

    const cards = [...ringEl.querySelectorAll('.card')].map((el) => {
      const style = el.style;
      const photo = el.classList.contains('card--photo');
      return {
        photo,
        g: photo ? G.photo : G.ui,
        t: parseFloat(style.getPropertyValue('--t')) || 0,
        y: parseFloat(style.getPropertyValue('--y')) || 0,
        img: /url\(["']?([^"')]+)/.exec(style.getPropertyValue('--img'))?.[1],
        chip: /chip-(\w+)/.exec(style.getPropertyValue('--chip'))?.[1],
        title: el.querySelector('b')?.textContent ?? '',
        sub: el.querySelector('small')?.textContent ?? '',
        icon: el.querySelector('path')?.getAttribute('d') ?? '',
      };
    });

    const loadImage = (src) => new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
    const photoSrcs = [...new Set(cards.filter((c) => c.photo).map((c) => c.img))];
    const [photos] = await Promise.all([
      Promise.all(photoSrcs.map(loadImage)),
      portrait.complete && portrait.naturalWidth ? portrait.decode().catch(() => {}) : new Promise((r) => portrait.addEventListener('load', r, { once: true })),
      document.fonts.load('650 40px Manrope', 'Автоматизация').catch(() => {}),
      document.fonts.load('500 24px Manrope', 'Рутина').catch(() => {}),
    ]);
    const photoBySrc = new Map(photoSrcs.map((src, i) => [src, photos[i]]));

    // --- шейдеры ---
    const PROJECT = `
      uniform vec4 uCanvas; // x, y, ширина, высота холста в координатах сцены
      uniform vec3 uPersp;  // точка схода x, y и расстояние перспективы, как CSS perspective
      vec4 project(vec3 p) {
        float w = (uPersp.z - p.z) / uPersp.z;
        vec2 s = uPersp.xy + (p.xy - uPersp.xy) / w;
        vec2 c = vec2((s.x - uCanvas.x) / uCanvas.z * 2.0 - 1.0, 1.0 - (s.y - uCanvas.y) / uCanvas.w * 2.0);
        return vec4(c * w, 0.0, w);
      }`;

    const CARD_VS = `#version 300 es
      in vec2 aUV;
      uniform mat4 uModel;
      uniform vec2 uSize;
      uniform float uRc;
      out vec2 vUV;
      out vec3 vP;
      out vec3 vN;
      ${PROJECT}
      void main() {
        float x = (aUV.x - 0.5) * uSize.x;
        float phi = x / uRc;
        vec3 p = vec3(uRc * sin(phi), (aUV.y - 0.5) * uSize.y, uRc * cos(phi) - uRc);
        vec4 wp = uModel * vec4(p, 1.0);
        vUV = aUV;
        vP = wp.xyz;
        vN = mat3(uModel) * vec3(sin(phi), 0.0, cos(phi));
        gl_Position = project(wp.xyz);
      }`;

    const CARD_FS = `#version 300 es
      precision highp float;
      in vec2 vUV;
      in vec3 vP;
      in vec3 vN;
      uniform sampler2D uTex;
      uniform sampler2D uBack;
      uniform vec2 uSize;
      uniform vec2 uView;
      uniform vec3 uPersp;
      uniform float uRad;
      uniform float uSide;
      uniform float uC;
      uniform float uPhoto;
      uniform float uPass;
      out vec4 o;
      float box(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }
      vec2 cover(vec2 uv) {
        float a = uSize.x / uSize.y;
        return a > 1.0 ? vec2(uv.x, 0.5 + (uv.y - 0.5) / a) : vec2(0.5 + (uv.x - 0.5) * a, uv.y);
      }
      void main() {
        if (uSide > 0.0 ? vP.z < 0.0 : vP.z >= 0.0) discard;
        vec2 p = (vUV - 0.5) * uSize;
        float d = box(p, uSize * 0.5, uRad);
        float aa = max(fwidth(d), 0.001);
        float inside = 1.0 - smoothstep(-0.5 * aa, 0.5 * aa, d);
        bool front = dot(vN, uPersp - vP) > 0.0;
        float far = clamp(0.45 - uC, 0.0, 1.0);
        vec2 uv = clamp(vUV, 0.0, 1.0);

        if (uPass < 0.5) {
          // подложка для стекла: лица фото-карточек
          if (uPhoto < 0.5 || !front || inside <= 0.0) discard;
          o = vec4(texture(uTex, cover(uv)).rgb, 1.0) * inside;
          return;
        }

        if (inside <= 0.0) {
          // мягкая тень под лицевой стороной
          if (!front) discard;
          float ds = box(p - vec2(0.0, uSize.y * 0.2), uSize * vec2(0.42, 0.36), uRad);
          float a = 0.15 * (1.0 - smoothstep(-uSize.y * 0.12, uSize.y * 0.42, ds)) * clamp(uC * 2.0, 0.0, 1.0);
          if (a < 0.003) discard;
          o = vec4(vec3(0.09, 0.08, 0.07) * a, a);
          return;
        }

        float edge = 1.0 - smoothstep(0.4 * aa, 1.6 * aa, abs(d + 1.1 * aa));
        vec3 bd = texture(uBack, gl_FragCoord.xy / uView).rgb;
        vec4 col;
        if (!front) {
          // оборот: светлое матовое стекло без содержимого
          vec3 c = mix(bd, vec3(1.0), uPhoto > 0.5 ? 0.42 : 0.55);
          c = mix(c, vec3(1.0), edge * 0.6);
          col = vec4(c, 1.0) * 0.8;
        } else if (uPhoto > 0.5) {
          vec3 c = texture(uTex, cover(uv), far * 3.0).rgb;
          c = mix(c, vec3(0.93), far * 0.4);
          c = mix(c, vec3(1.0), edge * 0.3);
          col = vec4(c, 1.0) * clamp(uC * 3.0 + 0.8, 0.0, 1.0);
        } else {
          float a = mix(0.86, 0.62, uv.y) - uv.x * 0.06;
          vec3 c = mix(bd, vec3(1.0, 1.0, 0.996), a);
          c += (1.0 - uv.y) * 0.025;
          c = mix(c, vec3(1.0), edge * 0.9);
          vec4 t = texture(uTex, uv, far * 3.0);
          c = c * (1.0 - t.a) + t.rgb;
          col = vec4(c, 1.0) * clamp(uC * 3.0 + 0.8, 0.0, 1.0);
        }
        o = col * inside;
      }`;

    const PORTRAIT_VS = `#version 300 es
      in vec2 aUV;
      uniform vec4 uRect;
      out vec2 vUV;
      ${PROJECT}
      void main() {
        vUV = aUV;
        gl_Position = project(vec3(uRect.xy + aUV * uRect.zw, 0.0));
      }`;

    const PORTRAIT_FS = `#version 300 es
      precision highp float;
      in vec2 vUV;
      uniform sampler2D uTex;
      out vec4 o;
      void main() { o = texture(uTex, vUV); }`;

    const WIRE_VS = `#version 300 es
      in float aS;
      uniform mat4 uModel;
      uniform float uR;
      uniform float uK;
      out vec3 vP;
      ${PROJECT}
      void main() {
        vec4 wp = uModel * vec4(uR * sin(aS), 0.0, uR * uK * cos(aS), 1.0);
        vP = wp.xyz;
        gl_Position = project(wp.xyz);
      }`;

    const WIRE_FS = `#version 300 es
      precision highp float;
      in vec3 vP;
      uniform vec4 uColor;
      out vec4 o;
      void main() {
        if (vP.z >= 0.0) discard;
        o = uColor;
      }`;

    const BLUR_VS = `#version 300 es
      out vec2 vUV;
      void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        vUV = p;
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
      }`;

    const BLUR_FS = `#version 300 es
      precision highp float;
      in vec2 vUV;
      uniform sampler2D uSrc;
      uniform vec2 uDir;
      out vec4 o;
      void main() {
        vec4 c = texture(uSrc, vUV) * 0.2270270270;
        c += texture(uSrc, vUV + uDir * 1.3846153846) * 0.3162162162;
        c += texture(uSrc, vUV - uDir * 1.3846153846) * 0.3162162162;
        c += texture(uSrc, vUV + uDir * 3.2307692308) * 0.0702702703;
        c += texture(uSrc, vUV - uDir * 3.2307692308) * 0.0702702703;
        o = c;
      }`;

    const compile = (vs, fs) => {
      const program = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      const u = {};
      const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i += 1) {
        const name = gl.getActiveUniform(program, i).name;
        u[name] = gl.getUniformLocation(program, name);
      }
      return { program, u };
    };

    const P = {
      card: compile(CARD_VS, CARD_FS),
      portrait: compile(PORTRAIT_VS, PORTRAIT_FS),
      wire: compile(WIRE_VS, WIRE_FS),
      blur: compile(BLUR_VS, BLUR_FS),
    };

    // --- геометрия ---
    // Сетка карточки с полями под тень: по ширине много сегментов, чтобы изгиб был гладким.
    const SEG = 48;
    const MX = 0.12;
    const MT = 0.12;
    const MB = 0.7;
    const cardVerts = [];
    for (let i = 0; i <= SEG; i += 1) {
      const u = -MX + (1 + 2 * MX) * (i / SEG);
      cardVerts.push(u, -MT, u, 1 + MB);
    }
    const cardVAO = gl.createVertexArray();
    gl.bindVertexArray(cardVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cardVerts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (const p of [P.card, P.portrait]) gl.bindAttribLocation(p.program, 0, 'aUV');

    const quadVAO = gl.createVertexArray();
    gl.bindVertexArray(quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const WIRE_N = 256;
    const wireVAO = gl.createVertexArray();
    gl.bindVertexArray(wireVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Array.from({ length: WIRE_N + 1 }, (_, i) => (i / WIRE_N) * Math.PI * 2)), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // aUV должен быть атрибутом 0 во всех программах: перелинковать после bindAttribLocation
    for (const p of [P.card, P.portrait]) gl.linkProgram(p.program);
    gl.bindAttribLocation(P.wire.program, 0, 'aS');
    gl.linkProgram(P.wire.program);
    for (const key of ['card', 'portrait', 'wire']) {
      const p = P[key];
      if (!gl.getProgramParameter(p.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p.program));
      p.u = {};
      const n = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i += 1) {
        const name = gl.getActiveUniform(p.program, i).name;
        p.u[name] = gl.getUniformLocation(p.program, name);
      }
    }

    // --- текстуры ---
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const texture = (source, mip = true) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      if (mip && aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      return t;
    };

    const CHIPS = {
      lime: ['#d3f07c', '#a9d93f'],
      violet: ['#bdb2fa', '#917ff0'],
      orange: ['#ffb27e', '#fb8743'],
      blue: ['#a6cbfb', '#5e9cf0'],
    };
    const roundRect = (x, rx, ry, w, h, r) => {
      x.beginPath();
      x.roundRect(rx, ry, w, h, r);
    };
    // Лицо стеклянной карточки: иконка и две строки на прозрачном фоне. Стекло дорисовывает шейдер.
    const uiTexture = (c) => {
      const W = 768;
      const H = Math.round((W * G.ui.h) / G.ui.w);
      const unit = W / G.ui.w;
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const x = cv.getContext('2d');
      const pad = 0.026 * unit;
      const cs = 0.05 * unit;
      const gap = 0.02 * unit;
      const tSize = 0.031 * unit;
      const sSize = 0.0195 * unit;
      const rowGap = 0.01 * unit;
      const tH = tSize * 1.15;
      const sH = sSize * 1.3;
      const top = (H - Math.max(cs, tH + rowGap + sH)) / 2;
      const [light, base] = CHIPS[c.chip] ?? CHIPS.violet;
      x.save();
      x.shadowColor = 'rgba(40, 30, 20, 0.22)';
      x.shadowBlur = cs * 0.22;
      x.shadowOffsetY = cs * 0.06;
      const grad = x.createLinearGradient(0, top, 0, top + cs);
      grad.addColorStop(0, light);
      grad.addColorStop(1, base);
      x.fillStyle = grad;
      roundRect(x, pad, top, cs, cs, cs * 0.3);
      x.fill();
      x.restore();
      x.save();
      roundRect(x, pad, top, cs, cs, cs * 0.3);
      x.clip();
      x.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      x.lineWidth = cs * 0.05;
      x.beginPath();
      x.moveTo(pad, top + x.lineWidth / 2);
      x.lineTo(pad + cs, top + x.lineWidth / 2);
      x.stroke();
      x.restore();
      if (c.icon) {
        x.save();
        x.translate(pad + cs * 0.21, top + cs * 0.21);
        x.scale((cs * 0.58) / 24, (cs * 0.58) / 24);
        x.fillStyle = '#fff';
        x.fill(new Path2D(c.icon), 'evenodd');
        x.restore();
      }
      const tx = pad + cs + gap;
      x.textBaseline = 'top';
      x.fillStyle = '#151311';
      x.font = `650 ${tSize}px Manrope, system-ui, sans-serif`;
      if ('letterSpacing' in x) x.letterSpacing = `${(-0.012 * tSize).toFixed(2)}px`;
      x.fillText(c.title, tx, top + (tH - tSize) / 2);
      x.fillStyle = '#76716b';
      x.font = `500 ${sSize}px Manrope, system-ui, sans-serif`;
      if ('letterSpacing' in x) x.letterSpacing = '0px';
      x.fillText(c.sub, tx, top + tH + rowGap + (sH - sSize) / 2);
      return texture(cv);
    };

    const photoTex = new Map();
    for (const [src, image] of photoBySrc) photoTex.set(src, texture(image));
    for (const c of cards) c.tex = c.photo ? photoTex.get(c.img) : uiTexture(c);
    const portraitTex = texture(portrait);

    // --- кадры подложки для матового стекла ---
    const target = () => {
      const t = gl.createTexture();
      const fb = gl.createFramebuffer();
      return { t, fb, w: 0, h: 0 };
    };
    const targets = [target(), target(), target()];
    const sizeTarget = (rt, w, h) => {
      rt.w = w;
      rt.h = h;
      gl.bindTexture(gl.TEXTURE_2D, rt.t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt.t, 0);
    };

    // --- раскладка ---
    const L = {};
    const paper = (() => {
      const m = /(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/.exec(getComputedStyle(document.body).backgroundColor);
      return m ? [m[1] / 255, m[2] / 255, m[3] / 255] : [0.969, 0.961, 0.941];
    })();

    const layout = () => {
      const W = stage.clientWidth;
      const H = stage.clientHeight;
      const cw = Math.min(W, H * 2.6);
      const ch = H * 1.42;
      Object.assign(L, { W, H, cx0: (W - cw) / 2, cy0: -H * 0.42, cw, ch });
      canvas.style.left = `${L.cx0}px`;
      canvas.style.top = `${L.cy0}px`;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(cw * dpr));
      canvas.height = Math.max(1, Math.round(ch * dpr));
      const sw = Math.max(1, Math.round(canvas.width / 4));
      const sh = Math.max(1, Math.round(canvas.height / 4));
      for (const rt of targets) sizeTarget(rt, sw, sh);
      const m = new DOMMatrixReadOnly(getComputedStyle(portrait).transform === 'none' ? undefined : getComputedStyle(portrait).transform);
      L.portrait = [portrait.offsetLeft + m.m41, portrait.offsetTop + m.m42, portrait.offsetWidth, portrait.offsetHeight];
    };

    // --- матрицы (как CSS transform: ось y вниз, z к зрителю) ---
    const mul = (a, b) => {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c += 1) {
        for (let r = 0; r < 4; r += 1) {
          o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
      }
      return o;
    };
    const T = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
    const RX = (a) => { const c = Math.cos(a); const s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
    const RY = (a) => { const c = Math.cos(a); const s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
    const RZ = (a) => { const c = Math.cos(a); const s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); };

    const common = (p) => {
      gl.uniform4f(p.u.uCanvas, L.cx0, L.cy0, L.cw, L.ch);
      gl.uniform3f(p.u.uPersp, L.W / 2, L.H * G.perspY, L.H * G.persp);
    };

    const drawCards = (list, side, pass) => {
      const p = P.card;
      gl.useProgram(p.program);
      common(p);
      gl.bindVertexArray(cardVAO);
      gl.uniform1f(p.u.uSide, side);
      gl.uniform1f(p.u.uPass, pass);
      gl.uniform2f(p.u.uView, pass ? canvas.width : targets[0].w, pass ? canvas.height : targets[0].h);
      gl.uniform1i(p.u.uTex, 0);
      gl.uniform1i(p.u.uBack, 1);
      gl.uniform1f(p.u.uRc, L.H * G.curve);
      for (const c of list) {
        if (pass === 0 && !c.photo) continue;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, c.tex);
        gl.uniformMatrix4fv(p.u.uModel, false, c.M);
        gl.uniform2f(p.u.uSize, L.H * c.g.w, L.H * c.g.h);
        gl.uniform1f(p.u.uRad, L.H * c.g.rad);
        gl.uniform1f(p.u.uC, c.C);
        gl.uniform1f(p.u.uPhoto, c.photo ? 1 : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2);
      }
    };

    const drawPortrait = () => {
      const p = P.portrait;
      gl.useProgram(p.program);
      common(p);
      gl.bindVertexArray(quadVAO);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, portraitTex);
      gl.uniform1i(p.u.uTex, 0);
      gl.uniform4f(p.u.uRect, ...L.portrait);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const drawWire = (ringM) => {
      const p = P.wire;
      gl.useProgram(p.program);
      common(p);
      gl.bindVertexArray(wireVAO);
      gl.uniformMatrix4fv(p.u.uModel, false, ringM);
      gl.uniform1f(p.u.uR, L.H * G.wire);
      gl.uniform1f(p.u.uK, G.k);
      const a = 0.32;
      gl.uniform4f(p.u.uColor, 0.19 * a, 0.18 * a, 0.17 * a, a);
      gl.drawArrays(gl.LINE_STRIP, 0, WIRE_N + 1);
    };

    const blur = () => {
      const p = P.blur;
      gl.useProgram(p.program);
      gl.bindVertexArray(null);
      gl.uniform1i(p.u.uSrc, 0);
      gl.activeTexture(gl.TEXTURE0);
      const [a, b, c] = targets;
      gl.viewport(0, 0, a.w, a.h);
      const passes = [[a, b, 1, 0], [b, c, 0, 1], [c, b, 2, 0], [b, c, 0, 2]];
      for (const [src, dst, dx, dy] of passes) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.bindTexture(gl.TEXTURE_2D, src.t);
        gl.uniform2f(p.u.uDir, dx / src.w, dy / src.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      return c;
    };

    const render = (a) => {
      if (!L.H) return;
      const H = L.H;
      const ringM = mul(mul(T(L.W / 2, H * G.ringY, 0), RZ(G.tiltZ * DEG)), RX(G.tiltX * DEG));
      for (const c of cards) {
        const tt = (c.t + a) * DEG;
        const r = H * c.g.r;
        const turn = Math.atan2(G.k * Math.sin(tt), Math.cos(tt));
        c.M = mul(mul(ringM, T(r * Math.sin(tt), H * c.y, r * G.k * Math.cos(tt))), RY(turn));
        c.Z = c.M[14];
        c.C = Math.cos(tt);
      }
      const order = [...cards].sort((p, q) => p.Z - q.Z);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      // 1. подложка: бумага, фото-карточки и портрет в четверть разрешения
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[0].fb);
      gl.viewport(0, 0, targets[0].w, targets[0].h);
      gl.clearColor(paper[0], paper[1], paper[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawCards(order, -1, 0);
      drawPortrait();
      drawCards(order, 1, 0);

      // 2. размытие подложки
      const back = blur();

      // 3. кадр: задняя половина кольца, портрет, передняя половина
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, back.t);
      drawWire(ringM);
      drawCards(order, -1, 1);
      drawPortrait();
      drawCards(order, 1, 1);
    };

    scene.append(canvas);
    layout();
    let lastAngle = angle;
    const paint = (a) => { lastAngle = a; render(a); };
    new ResizeObserver(() => { layout(); render(lastAngle); }).observe(stage);
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      canvas.remove();
      fallback();
    });
    return paint;
  }
})();
