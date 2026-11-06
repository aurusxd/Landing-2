// Поэтапное появление первого экрана. Класс intro ставит скрипт в <head>.
(() => {
  const root = document.documentElement;
  clearTimeout(window.__introSafety);
  if (!root.classList.contains('intro')) return;
  void document.body.offsetHeight; // скрытое состояние должно примениться до старта переходов
  root.classList.add('intro-go');
  setTimeout(() => root.classList.remove('intro', 'intro-go'), 2800);
})();

// Кольцо карточек вокруг портрета, навигация и одно появление при прокрутке.
// Без скриптов и при reduced motion страница полностью видна, кольцо стоит на месте.
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = document.querySelector('[data-stage]');
  const scene = document.querySelector('[data-scene]');
  const ring = document.querySelector('[data-ring]');
  const nav = document.querySelector('[data-nav]');
  const hero = document.getElementById('top');

  if (ring && !still) {
    const SPEED = 6.5; // градусов в секунду
    let angle = -32;
    let last = 0;
    let frame = 0;
    let lastScroll = scrollY;
    let targetX = 0;
    let targetY = 0;
    let tiltX = 0;
    let tiltY = 0;

    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      const scrolled = scrollY - lastScroll;
      lastScroll = scrollY;
      angle -= SPEED * dt + scrolled * 0.12;
      ring.style.transform = `rotateZ(-4deg) rotateX(-7deg) rotateY(${angle.toFixed(2)}deg)`;
      tiltX += (targetX - tiltX) * 0.06;
      tiltY += (targetY - tiltY) * 0.06;
      scene.style.transform = `rotateY(${tiltX.toFixed(2)}deg) rotateX(${tiltY.toFixed(2)}deg)`;
      frame = requestAnimationFrame(tick);
    };

    new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(frame);
      if (entry.isIntersecting) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    }).observe(stage);

    if (matchMedia('(hover: hover)').matches) {
      hero.addEventListener('pointermove', (event) => {
        const box = hero.getBoundingClientRect();
        targetX = ((event.clientX - box.left) / box.width - 0.5) * 7;
        targetY = ((event.clientY - box.top) / box.height - 0.5) * -3;
      }, { passive: true });
    }
  }

  // Знак в навигации получает стекло, как только страница ушла с первого экрана.
  new IntersectionObserver(([entry]) => nav.classList.toggle('is-stuck', !entry.isIntersecting), { rootMargin: '-120px 0px 0px' }).observe(document.querySelector('.hero__copy'));

  // Текущий раздел в капсуле навигации.
  const links = new Map([...document.querySelectorAll('.nav__links a')].map((a) => [a.getAttribute('href').slice(1), a]));
  const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const a of links.values()) a.removeAttribute('aria-current');
      links.get(entry.target.id)?.setAttribute('aria-current', 'true');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  for (const id of links.keys()) spy.observe(document.getElementById(id));
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) for (const a of links.values()) a.removeAttribute('aria-current');
  }, { rootMargin: '-45% 0px -50% 0px' }).observe(hero);

  // Меню на телефоне закрывается после выбора раздела.
  const menu = document.querySelector('.nav__menu');
  menu.addEventListener('click', (event) => { if (event.target.closest('a')) menu.open = false; });

  // Появление при прокрутке.
  const items = document.querySelectorAll('[data-reveal]');
  if (still || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
  } else {
    const reveal = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        reveal.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach((el) => reveal.observe(el));
  }
})();
