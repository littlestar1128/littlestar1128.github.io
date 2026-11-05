(() => {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const played = new WeakSet();
  const animations = new Set();
  const cards = '#recent-posts .recent-post-item:not(.ads-wrap), #aside-content .card-widget';
  const zoomImages = '#article-container img.medium-zoom-image';
  let observer;

  function watchCards() {
    observer?.disconnect();
    if (motion.matches || !('IntersectionObserver' in window) || !Element.prototype.animate) return;

    observer = new IntersectionObserver(entries => {
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;

        observer.unobserve(target);
        played.add(target);
        if (motion.matches || target.contains(document.activeElement)) continue;

        // Cards stay visible by default. There is no hidden state to restore.
        const animation = target.animate(
          [
            { opacity: 0.25, translate: '0 10px' },
            { opacity: 1, translate: '0 0' }
          ],
          { duration: 340, easing: 'ease-out' }
        );
        animations.add(animation);
        const forget = () => animations.delete(animation);
        animation.addEventListener('finish', forget, { once: true });
        animation.addEventListener('cancel', forget, { once: true });
      }
    }, { rootMargin: '0px 0px -16px 0px' });

    document.querySelectorAll(cards).forEach(card => {
      // Skip cards already visible when opening the page or a deep link.
      if (!played.has(card) && card.getBoundingClientRect().top >= window.innerHeight) {
        observer.observe(card);
      }
    });
  }

  function labelZoomImages() {
    document.querySelectorAll(zoomImages).forEach(img => {
      if (img.closest('a') || img.hasAttribute('tabindex')) return;
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', img.alt ? `放大图片：${img.alt}` : '放大图片');
    });
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!(event.target instanceof HTMLImageElement) ||
        !event.target.matches(`${zoomImages}[role="button"]`)) return;

    event.preventDefault();
    event.target.click();
  });

  motion.addEventListener?.('change', () => {
    animations.forEach(animation => animation.cancel());
    animations.clear();
    watchCards();
  });

  function init() {
    labelZoomImages();
    watchCards();
  }

  document.addEventListener('DOMContentLoaded', init, { once: true });
  document.addEventListener('pjax:complete', init);
})();
