export function TitleBar() {
  return (
    <header className="app-drag relative flex h-10 shrink-0 select-none items-center gap-2.5 border-b border-[#d4af37]/15 bg-[#0a0a0f] px-3">
      <img src="/logo.svg" alt="" className="h-4 w-4" />
      <span className="font-display text-[11px] font-semibold tracking-[0.32em] text-[#e8c766]/90">
        AIGC CANVAS
      </span>
      {/* Reserve space so content stays clear of the native window controls overlay */}
      <div className="ml-auto h-full w-[150px]" />
    </header>
  );
}
