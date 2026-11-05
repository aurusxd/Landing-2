// Галерея проектов: обычная горизонтальная лента. Колесо мыши листает страницу, как обычно,
// а проекты переключаются стрелками, кружками, клавишами ← → и свайпом.
// Без скриптов лента просто листается свайпом и трекпадом.
(() => {
  const section = document.querySelector('[data-projects]');
  if (!section) return;

  const track = section.querySelector('[data-track]');
  const slides = [...section.querySelectorAll('[data-slide]')];
  const prev = section.querySelector('[data-prev]');
  const next = section.querySelector('[data-next]');
  const dots = [...section.querySelectorAll('[data-dot]')];
  const last = slides.length - 1;
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  let active = -1;
  let target = null; // проект, к которому лента едет после клика
  let frame = 0;

  const offsetOf = (slide) => slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2;

  // Состояние меняется сразу по клику, а лента доезжает следом.
  function goTo(i) {
    const index = Math.min(last, Math.max(0, i));
    target = index;
    setActive(index);
    track.scrollTo({ left: offsetOf(slides[index]), behavior: still.matches ? 'auto' : 'smooth' });
  }

  function setActive(i) {
    if (i === active) return;
    active = i;
    dots.forEach((dot, n) => {
      if (n === i) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    slides.forEach((slide, n) => {
      slide.querySelector('.slide__links').toggleAttribute('data-off', n !== i);
    });

    // Стрелка на краю неактивна, фокус переходит на вторую, чтобы не потеряться.
    const lock = (button, off, other) => {
      if (off && document.activeElement === button) other.focus({ preventScroll: true });
      button.disabled = off;
    };
    lock(prev, i === 0, next);
    lock(next, i === last, prev);
  }

  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));

  // Свайп или жест трекпада отменяют поездку: дальше лента слушается руки.
  track.addEventListener('pointerdown', () => { target = null; }, { passive: true });
  track.addEventListener('touchstart', () => { target = null; }, { passive: true });
  track.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) target = null;
  }, { passive: true });

  // Активный проект крупнее, у соседних приглушена подпись.
  function paint() {
    frame = 0;
    const width = slides[0].offsetWidth || 1;
    let nearest = 0;
    let best = Infinity;
    slides.forEach((slide, i) => {
      const distance = Math.abs(offsetOf(slide) - track.scrollLeft);
      if (distance < best) { best = distance; nearest = i; }
      const d = Math.min(1, distance / width);
      if (!still.matches) slide.firstElementChild.style.transform = `scale(${(1 - d * 0.06).toFixed(4)})`;
      slide.lastElementChild.style.opacity = String(Math.max(0, 1 - d * 1.8).toFixed(3));
    });
    if (target === nearest && best < 2) target = null;
    setActive(target === null ? nearest : target);
  }

  const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };

  track.addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });

  prev.addEventListener('click', () => goTo(active - 1));
  next.addEventListener('click', () => goTo(active + 1));
  // Если лента так и не доехала, например окно изменилось, держать цель незачем.
  track.addEventListener('scrollend', () => { target = null; schedule(); });

  // Клик по краю соседнего проекта листает к нему, а не открывает ссылку.
  track.addEventListener('click', (event) => {
    const index = slides.findIndex((slide) => slide.contains(event.target));
    if (index > -1 && index !== active) {
      event.preventDefault();
      goTo(index);
    }
  }, true);

  // Стрелки на клавиатуре, пока секция в середине экрана.
  addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const box = section.getBoundingClientRect();
    if (box.top > innerHeight * 0.5 || box.bottom < innerHeight * 0.5) return;
    event.preventDefault();
    goTo(active + (event.key === 'ArrowRight' ? 1 : -1));
  });

  // Снимки декодируются заранее, чтобы рамка не мигала пустой при первом показе.
  section.querySelectorAll('img').forEach((image) => image.decode?.().catch(() => {}));

  paint();
})();
