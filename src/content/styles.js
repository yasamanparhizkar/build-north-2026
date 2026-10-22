// CSS inside the overlay's shadow root.
export const OVERLAY_CSS = `
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; font-family: Arial, Helvetica, sans-serif; }

  .box {
    position: fixed;
    box-sizing: border-box;
    border: 6px solid #e0115f;
    border-radius: 12px;
    outline: 3px solid #fff;
    background: rgba(255, 235, 59, 0.18);
    pointer-events: none;
    animation: sh-pulse 0.9s ease-in-out 3;
  }
  .box.spotlight { box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.22); }

  .arrow {
    position: fixed;
    width: 56px;
    height: 56px;
    pointer-events: none;
    filter: drop-shadow(0 3px 4px rgba(0,0,0,0.45));
    animation: sh-bounce 0.9s ease-in-out 3;
  }
  .arrow svg { width: 100%; height: 100%; }

  .label {
    position: fixed;
    max-width: 320px;
    background: #e0115f;
    color: #fff;
    font-size: 22px;
    font-weight: bold;
    line-height: 1.2;
    padding: 8px 14px;
    border-radius: 10px;
    border: 2px solid #fff;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .num {
    position: fixed;
    width: 34px; height: 34px;
    border-radius: 50%;
    background: #e0115f; color: #fff;
    font-size: 20px; font-weight: bold;
    display: flex; align-items: center; justify-content: center;
    border: 2px solid #fff;
    pointer-events: none;
  }
  .hidden { display: none !important; }

  .badge {
    position: fixed;
    bottom: 20px;
    right: 20px;
    max-width: 420px;
    background: #202124;
    color: #fff;
    padding: 12px 18px;
    border-radius: 24px;
    font-size: 17px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    pointer-events: none;
  }

  .indicator {
    position: fixed;
    top: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: #d93025;
    color: #fff;
    padding: 8px 10px 8px 14px;
    border-radius: 22px;
    font-size: 15px;
    font-weight: bold;
    box-shadow: 0 3px 10px rgba(0,0,0,0.35);
    pointer-events: auto;
  }
  .indicator button {
    all: unset;
    cursor: pointer;
    background: #fff;
    color: #d93025;
    border-radius: 14px;
    padding: 4px 12px;
    font-size: 14px;
    font-weight: bold;
  }
  .indicator button:focus-visible { outline: 3px solid #fbbc04; }

  @keyframes sh-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
  @keyframes sh-bounce { 0%, 100% { translate: 0 0; } 50% { translate: 0 -10px; } }
  @media (prefers-reduced-motion: reduce) {
    .box, .arrow { animation: none; }
  }
`;
