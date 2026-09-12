// Runs before React and its styles are available, in both dev and packaged builds.
export function installStartupScreen() {
  const style = document.createElement('style');
  style.id = 'app-loading-style';
  style.textContent = `
    .aigc-startup { position:fixed; inset:0; z-index:2147483646; display:grid;
      place-items:center; overflow:hidden; background:#0a0a0f; color:#eeeae0;
      font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif;
      -webkit-font-smoothing:antialiased; transition:opacity 200ms ease; }
    .aigc-startup *, .aigc-startup *::before, .aigc-startup *::after { box-sizing:border-box; }
    .aigc-startup::before { content:""; position:absolute; inset:0; pointer-events:none;
      background:radial-gradient(ellipse 40% 45% at 50% 42%,rgba(212,175,55,.07),transparent 80%); }
    .aigc-startup::after { content:""; position:absolute; inset:0; pointer-events:none;
      background-image:radial-gradient(rgba(212,175,55,.14) .7px,transparent .7px);
      background-size:28px 28px; mask-image:radial-gradient(ellipse 38% 50% at center,#000,transparent); }
    .aigc-startup__drag { position:absolute; inset:0 0 auto; height:40px; -webkit-app-region:drag; }
    .aigc-startup__content { position:relative; z-index:1; text-align:center;
      width:min(440px,calc(100% - 48px)); padding:32px 0; transform:translateY(-12px); }
    .aigc-startup__icon { display:block; width:96px; height:96px; margin:0 auto 26px; }
    .aigc-startup__name { margin:0; font-size:26px; font-weight:600; letter-spacing:5px;
      line-height:1.4; padding-left:5px; color:#f0ece2; }
    .aigc-startup__tagline { margin:14px 0 0; font-size:13px; letter-spacing:3px; color:#989386; }
    .aigc-startup__loading { margin:42px auto 0; }
    .aigc-startup__track { position:relative; width:156px; height:2px; margin:0 auto;
      overflow:hidden; background:rgba(212,175,55,.12); border-radius:2px; }
    .aigc-startup__track::after { content:""; position:absolute; inset:0 auto 0 0; width:60%;
      background:linear-gradient(90deg,transparent,#d4af37,transparent);
      animation:aigc-startup-progress 1.8s ease-in-out infinite; }
    .aigc-startup__status { margin:17px 0 0; font-size:12px; color:#a49c89; letter-spacing:1px; }
    .aigc-startup__retry { margin-top:16px; padding:7px 16px; border:1px solid #66562d;
      border-radius:6px; background:#19170f; color:#e8c766; font:inherit; font-size:12px;
      cursor:pointer; -webkit-app-region:no-drag; }
    .aigc-startup__retry:hover { background:#292315; }
    .aigc-startup__retry:focus-visible { outline:2px solid #e8c766; outline-offset:4px; }
    .aigc-startup__footer { position:absolute; bottom:36px; left:24px; right:24px;
      display:flex; align-items:center; justify-content:center; gap:16px;
      font-size:10px; color:#746e60; letter-spacing:3px; }
    .aigc-startup__footer::before,.aigc-startup__footer::after { content:"";
      width:32px; height:1px; background:rgba(212,175,55,.18); }
    .aigc-startup--leaving { opacity:0; pointer-events:none; }
    @keyframes aigc-startup-progress { from { transform:translateX(-100%); } to { transform:translateX(270%); } }
    @media (max-height:480px) {
      .aigc-startup__content { transform:none; padding:16px 0; }
      .aigc-startup__icon { width:64px; height:64px; margin-bottom:16px; }
      .aigc-startup__loading { margin-top:24px; }
      .aigc-startup__footer { bottom:14px; }
    }
    @media (prefers-reduced-motion:reduce) {
      .aigc-startup { transition:none; }
      .aigc-startup__track::after { animation:none; left:20%; }
    }
  `;
  const overlay = document.createElement('div');
  overlay.className = 'aigc-startup';
  overlay.setAttribute('aria-label', 'AIGC CANVAS 启动');
  overlay.innerHTML = `
    <div class="aigc-startup__drag" aria-hidden="true"></div>
    <div class="aigc-startup__content">
      <img class="aigc-startup__icon" alt="" width="96" height="96" />
      <p class="aigc-startup__name">AIGC CANVAS</p>
      <p class="aigc-startup__tagline">让灵感，成为画面。</p>
      <div class="aigc-startup__loading" role="status" aria-live="polite">
        <div class="aigc-startup__track" aria-hidden="true"></div>
        <p class="aigc-startup__status">正在启动创作空间</p>
      </div>
      <button class="aigc-startup__retry" type="button" hidden>重新加载</button>
    </div>
    <div class="aigc-startup__footer" aria-hidden="true">AI 影像创作工作台</div>
  `;
  const status = overlay.querySelector<HTMLElement>('.aigc-startup__status')!;
  const retry = overlay.querySelector<HTMLButtonElement>('button')!;
  retry.addEventListener('click', () => window.location.reload());

  let finished = false;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  const append = () => {
    if (finished || document.readyState === 'loading') return;
    document.removeEventListener('readystatechange', append);
    overlay.querySelector('img')!.src = new URL('app-icon.png', document.baseURI).href;
    document.head.append(style);
    document.body.append(overlay);
    slowTimer = setTimeout(() => {
      status.textContent = '启动时间较长，请稍候或重新加载';
      retry.hidden = false;
    }, 15000);
  };
  const onReady = (event: MessageEvent) => {
    if (event.source !== window || event.data?.payload !== 'removeLoading' || finished) return;
    finished = true;
    clearTimeout(slowTimer);
    document.removeEventListener('readystatechange', append);
    window.removeEventListener('message', onReady);
    overlay.classList.add('aigc-startup--leaving');
    // Timer also cleans up when the window is hidden and transitionend does not fire.
    setTimeout(() => { overlay.remove(); style.remove(); },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
  };
  window.addEventListener('message', onReady);
  document.addEventListener('readystatechange', append);
  append();
}
