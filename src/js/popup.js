(async function() {
  try {
    const updateElement = document.getElementById('update');

    const response = await fetch('https://raw.githubusercontent.com/wictornogueira/gmeet-chat-tools/main/src/manifest.json');
    const { version: lastestVersion } = await response.json();
    const { version: currVersion } = chrome.runtime.getManifest();

    if (lastestVersion !== currVersion) {
      const warning = document.createElement('div');
      warning.className = 'alert alert-warning';
      warning.innerText = 'Uma nova versão está disponível no github.';

      updateElement.appendChild(warning);
    }
  } catch {}
})();

(function() {
  const ttsPrefixElement = document.getElementById('tts-prefix');
  const ttsEnableElement = document.getElementById('enable-tts');
  const pipEnableElement = document.getElementById('enable-pip');
  
  chrome.storage.local.get(['tts_prefix','tts_enabled'], values => {
    const { tts_prefix, tts_enabled } = values;

    ttsEnableElement.checked = !!tts_enabled;
    ttsPrefixElement.value = tts_prefix ?? '';
    
    ttsPrefixElement.onchange = e => {
      chrome.storage.local.set({ tts_prefix: e.target.value.toLowerCase() });
    }
    
    ttsEnableElement.onchange = e => {
      chrome.storage.local.set({ tts_enabled: e.target.checked });
    }

    chrome.tabs.query({active: true, currentWindow: true}, tabs => {
      if(!tabs[0].url.includes('meet.google.com'))
        return;
      
      chrome.tabs.sendMessage(tabs[0].id, { op: 'getPiPEnabled' }, res => {
        pipEnableElement.checked = !!res?.pipEnabled;
      });

      pipEnableElement.onchange = e => {
        chrome.tabs.sendMessage(tabs[0].id, { op: 'switchPiP', value: e.target.checked });
      }
    });
  });
})();
