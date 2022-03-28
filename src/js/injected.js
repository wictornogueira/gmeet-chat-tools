(async function(){
  class EventDispatcher {
    constructor () {
      this.handlers = new Map();
    }

    on (event, handler) {
      if (!this.handlers.has(event))
        this.handlers.set(event, new Set());

      this.handlers.get(event).add(handler);
    }

    off (event, handler) {
      this.handlers.get(event)?.delete(handler);
    }

    dispatch (event, ...args) {
      this.handlers.get(event)?.forEach(handler => {
        if (handler.once)
          this.off(event, handler);

        handler(...args);
      });
    }

    once (event, handler) {
      handler.once = true;
      this.on(event, handler);
    }
  }

  class Config extends EventDispatcher {
    static instance = new Config();

    static getInstance () {
      return Config.instance;
    }

    constructor () {
      super();

      this._shouldObserve = false;
      this._ttsEnabled = false;
      this._pipEnabled = false;
      this.ttsPrefix = '';

      this.init();
    }

    
    set shouldObserve (value) {
      if (value !== this._shouldObserve) {
        this._shouldObserve = value;
        this.dispatch('shouldObserveChanged', value);
      }
    }
    
    set ttsEnabled (value) {
      if (value !== this._ttsEnabled) {
        this._ttsEnabled = value;
        this.shouldObserve = this._ttsEnabled || this._pipEnabled;
        this.dispatch('ttsEnabledChanged', value);
      }
    }

    set pipEnabled (value) {
      if (value !== this._pipEnabled) {
        this._pipEnabled = value;
        this.shouldObserve = this._ttsEnabled || this._pipEnabled;
        this.dispatch('pipEnabledChanged', value);
      }
    }

    get shouldObserve () {
      return this._shouldObserve;
    }

    get ttsEnabled () {
      return this._ttsEnabled;
    }

    get pipEnabled () {
      return this._pipEnabled;
    }

    init () {
      // Init values

      chrome.storage.local.get(['tts_prefix', 'tts_enabled'], values => {
        const { tts_prefix, tts_enabled } = values;

        this.ttsPrefix = tts_prefix ?? '';
        this.ttsEnabled = !!tts_enabled;

        this.dispatch('ready', this);
      });

      // Observe changes

      chrome.storage.onChanged.addListener(changes => {
        if (changes.tts_prefix)
          this.ttsPrefix = changes.tts_prefix.newValue;

        if (changes.tts_enabled)
          this.ttsEnabled = !!changes.tts_enabled.newValue;
      });

      chrome.runtime.onMessage.addListener((msg, _, res) => {
        switch (msg.op) {
          case 'getPiPEnabled':
            return res({ pipEnabled: this._pipEnabled });
          case 'switchPiP':
            this.pipEnabled = !!msg.value;
            return res(true);
        }
      });    
    }
  }

  class ChatOberserver extends EventDispatcher {
    static instance = new ChatOberserver();
    static getInstance () {
      return ChatOberserver.instance;
    }

    constructor () {
      super();

      this.chat = null;
    }

    init () {
      console.log('Chat observer initializing...');
      this.initObserver();

      if (Config.getInstance().shouldObserve)
          this.start();

      Config.getInstance().on('shouldObserveChanged', shouldObserve => shouldObserve ? this.start() : this.stop());
    }

    initObserver () {
      this.chatObserver = new MutationObserver((mutations, _) => {
        const [node] = (mutations[1] || mutations[0]).addedNodes;

        if (!node)
          return;

        let msg, author;

        switch (node.className) {
          case 'oIy2qc':
            msg = node.innerText;
            author = node.parentElement.parentElement.getAttribute('data-sender-name');
            break;
          case 'GDhqjd':
            const fTimestamp = node.getAttribute('data-formatted-timestamp')
            if (fTimestamp) {
              [author, msg] = node.innerText.split(fTimestamp);
              if (msg.startsWith('\n'))
                msg = msg.slice(1);
              break;
            }
          default:
            return;
        }

        this.dispatch('message', { author, msg })
      });
    }

    stop () {
      console.log('Chat observer stopping...');
      this.chat = null;
      this.chatObserver.disconnect();
      this.dispatch('stop', this);
    }

    async start () {
      console.log('Chat observer starting...');
      const chat = await this.findChat();

      if (chat) {
        console.log('Chat observer found chat :D');
        this.chat = chat;
        this.chatObserver.observe(chat, { childList: true, subtree: true });
        this.dispatch('start', this);
        return;
      }

      console.log('Chat observer start up failed :(');
    }

    findChat () {
      console.log('Chat observer is looking for chat...');
      return document.getElementsByClassName('z38b6')[0] ||
        new Promise((resolve, _) => {
          const observer = new MutationObserver(function (mutations) {
            // Abort
          
            if (!Config.getInstance().shouldObserve) {
              this.disconnect();
              return resolve();
            }

            // Wait for chat to be initialized

            for (const mutation of mutations) {
              for (const node of mutation.addedNodes) {
                if (node.className === 'WUFI9b') {
                  const chat = document.getElementsByClassName('z38b6')[0];

                  if (chat) {
                    this.disconnect();
                    return resolve(chat);
                  }
                }
              }
            }
          });

          observer.observe(document.body, { childList: true, subtree: true });
        });
    }
  }

  class TTSListener {
    static init () {
      console.log('TTSListener initializing...');

      const handler = msg => {
        if (msg.msg.toLowerCase().startsWith(Config.getInstance().ttsPrefix))
          this.speak(`${msg.author} disse: ${msg.msg.substr(Config.getInstance().ttsPrefix.length)}`);
      }

      if (Config.getInstance().ttsEnabled)
        ChatOberserver.getInstance().on('message', handler);

      Config.getInstance()
        .on('ttsEnabledChanged', enabled => 
          enabled ? ChatOberserver.getInstance().on('message', handler)
                  : ChatOberserver.getInstance().off('message', handler)
        );
    }

    static speak (text) {
      const utterance = new SpeechSynthesisUtterance(text);
      return speechSynthesis.speak(utterance);
    }
  }

  class PiPListener {
    static init () {
      console.log('PiPListener initializing...');

      const video = document.createElement('video')
      video.muted = true;
      video.autoplay = true;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')
      canvas.width = 360;
      canvas.height = 563;

      video.srcObject = canvas.captureStream(1);

      ctx.fillStyle = '#FFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      video.addEventListener('leavepictureinpicture', () => {
        Config.getInstance().pipEnabled = false;
      });

      Config.getInstance()
        .on('pipEnabledChanged', async enabled => {
          if (!enabled)
            return document.exitPictureInPicture().catch(_ => {});

          // check if chat is available

          let chat = ChatOberserver.getInstance().chat;

          // if not, wait for it

          if (!chat)
            console.log('PiPListener is waiting for ChatObserver...');

            try {
              chat = await (new Promise ((resolve, reject) => {
                const startHandler = () => {
                  Config.getInstance().off('pipEnabledChanged', abortHandler);
                  resolve(ChatOberserver.getInstance().chat);
                }
                
                // Prevent user from creating 2000 unresolved promises
                const abortHandler = en => {
                  if (en)
                    return;

                  ChatOberserver.getInstance().off('start', startHandler);
                  Config.getInstance().off('pipEnabledChanged', abortHandler);
                  reject();
                }
                
                Config.getInstance().on('pipEnabledChanged', abortHandler);
                ChatOberserver.getInstance().once('start', startHandler);
              }));
            } catch { return console.log('PiPListener is waiting no more (canceled by user)'); }

          const pos = chat.getBoundingClientRect();

          canvas.width = pos.width;
          canvas.height = pos.height;

          // Clearing canvas one more time, don't mind me

          ctx.fillStyle = '#FFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const msgHandler = _ => {
            domtoimage.toSvg(chat)
              .then(domtoimage.impl.util.makeImage)
              .then(img => {
                // Clear canvas, just in case

                ctx.fillStyle = '#FFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                ctx.drawImage(img, 0, 0);
              })
              .catch(_=>{});
          }

          const pipEnabledChangedHandler = en => {
            if (en)
              return;

            Config.getInstance().off('pipEnabledChanged', pipEnabledChangedHandler);
            ChatOberserver.getInstance().off('message', msgHandler);
          }

          ChatOberserver.getInstance().on('message', msgHandler);
          Config.getInstance().on('pipEnabledChanged', pipEnabledChangedHandler);

          console.log('PiPListener is trying to go PiP...');
          video.requestPictureInPicture()
            .then(() => video.play())
            .then(() => console.log('PiPListener went PiP :D'))
            .catch(err => console.log('PiPListener failed to go PiP :(', err));
        });
    }
  }

  Config.getInstance().once('ready', () => {
    ChatOberserver.getInstance().init();
    
    TTSListener.init();
    PiPListener.init();

    // ChatOberserver.getInstance().on('message', console.log);
  });
})();
