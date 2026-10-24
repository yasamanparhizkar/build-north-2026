// Styles scoped inside the extension's closed Shadow DOM (never touch the page).
export const OVERLAY_CSS = `
  :host { all: initial; }
  .layer {
    position: fixed; inset: 0; pointer-events: none;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  }

  /* ---- Spotlight (spotlight/renderer.js) ---- */
  .sh-spot {
    position: fixed; inset: 0; width: 100%; height: 100%;
    pointer-events: none; overflow: visible;
    opacity: 0; transition: opacity 300ms ease-out;
  }
  .sh-spot.sh-on { opacity: 1; }

  /* ---- Instruction text (spotlight/typography.js): no box, just light text ---- */
  .sh-text {
    position: fixed; left: 0; top: 0; box-sizing: border-box;
    display: flex; align-items: flex-start; gap: 10px;
    color: #FFFFFF; font-size: 20px; font-weight: 600; line-height: 1.35; letter-spacing: 0.1px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55), 0 0 18px rgba(0, 0, 0, 0.45);
    pointer-events: none;
    opacity: 0; transform: translateY(4px);
    transition: opacity 260ms ease-out, transform 260ms ease-out;
  }
  .sh-text.sh-on { opacity: 1; transform: none; }
  .sh-text-message { overflow-wrap: anywhere; }
  .sh-text-close {
    all: unset; pointer-events: auto; cursor: pointer; flex: none;
    width: 28px; height: 28px; margin-top: -1px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: 400; line-height: 1;
    color: rgba(255, 255, 255, 0.62); text-shadow: none;
    transition: color 160ms ease, background-color 160ms ease;
  }
  .sh-text-close:hover { color: #FFFFFF; background: rgba(255, 255, 255, 0.12); }
  .sh-text-close:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.85); outline-offset: 2px; }
  .sh-text:not(.sh-on) .sh-text-close { pointer-events: none; }

  .sh-marker {
    position: fixed; width: 30px; height: 30px; box-sizing: border-box;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; border: 1.5px solid rgba(255, 255, 255, 0.85);
    color: #FFFFFF; font-size: 16px; font-weight: 600;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    background: rgba(0, 0, 0, 0.25);
    pointer-events: none; opacity: 0; transition: opacity 260ms ease-out;
  }
  .sh-marker.sh-on { opacity: 1; }

  .sh-hidden { display: none !important; }
  .hidden { display: none !important; }

  /* ---- Status badge + listening indicator (badge.js) ---- */
  .badge { position: fixed; z-index: 5; bottom: 20px; right: 20px; max-width: 420px; background: rgba(60,60,67,.6); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); color: #fff; padding: 8px 14px; border-radius: 22px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; font-size: 13px; font-weight: 500; letter-spacing: -0.01em; pointer-events: none; }
  .indicator { position: fixed; z-index: 6; top: 12px; right: 12px; display: flex; align-items: center; gap: 12px; background: rgba(60,60,67,.6); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); color: #fff; padding: 6px 6px 6px 14px; border-radius: 22px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; font-size: 13px; font-weight: 500; letter-spacing: -0.01em; pointer-events: auto; }
  .indicator button { all: unset; cursor: pointer; box-sizing: border-box; color: #fff; border: 1px solid #34B36F; border-radius: 14px; padding: 4px 12px; font-size: 12px; font-weight: 600; }
  .indicator button:focus-visible { outline: 2px solid #34B36F; outline-offset: 2px; }

  @media (prefers-reduced-motion: reduce) {
    .sh-spot, .sh-text, .sh-marker, .sh-text-close { transition: none; }
    .sh-text { transform: none; }
  }
`;
