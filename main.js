// Поэтапное появление первого экрана. Класс intro ставит скрипт в <head>.
(() => {
  const root = document.documentElement;
  clearTimeout(window.__introSafety);
  if (!root.classList.contains('intro')) return;
  void document.body.offsetHeight; // скрытое состояние должно примениться до старта переходов
  root.classList.add('intro-go');
  setTimeout(() => root.classList.remove('intro', 'intro-go'), 2800);
})();

// Навигация и одно появление при прокрутке. Кольцо карточек вокруг портрета ведёт ring.js.
// Без скриптов и при reduced motion страница полностью видна.
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.querySelector('[data-nav]');
  const hero = document.getElementById('top');

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
