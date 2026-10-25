// Handle browser prefixing (Chrome/Safari require webkit)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  const recognition = new SpeechRecognition();

  // Settings for speed and flow
  recognition.continuous = true;       // Keep listening even if the user pauses
  recognition.interimResults = true;   // Stream fast, unfinalized text in real-time
  recognition.lang = 'en-US';          // Set target language

  // Capture real-time text streams
  recognition.onresult = (event) => {
    let finalTranscript = '';
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    console.log('Final:', finalTranscript);
    console.log('Live Typing:', interimTranscript); // This gives you the fastest visual feedback
  };

  // Start listening (Triggers native browser mic permission prompt)
  recognition.start();
} else {
  console.error("This browser does not support the Web Speech API.");
}
