// Injected CSS for the pointer and the status badge.
export const OVERLAY_CSS = `
  @keyframes seniorPulse {
    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 0, 0, 0.8); }
    70% { transform: scale(1.05); box-shadow: 0 0 0 20px rgba(255, 0, 0, 0); }
    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 0, 0, 0); }
  }
  #senior-helper-pointer {
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
    border: 5px solid #ff0000;
    border-radius: 12px;
    background: rgba(255, 255, 0, 0.25);
    animation: seniorPulse 1.5s infinite;
  }
  #senior-helper-label {
    position: absolute;
    bottom: 110%;
    left: 50%;
    transform: translateX(-50%);
    background: #d93025;
    color: white;
    font-size: 20px;
    font-weight: bold;
    padding: 8px 14px;
    border-radius: 8px;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    font-family: Arial, sans-serif;
  }
  #senior-voice-badge {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 2147483647;
    background: #202124;
    color: white;
    padding: 12px 18px;
    border-radius: 30px;
    font-family: Arial, sans-serif;
    font-size: 15px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    display: none;
  }
`;
