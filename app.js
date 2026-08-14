(() => {
  "use strict";

  const sounds = Array.isArray(window.SOUNDBOARD_SOUNDS) ? window.SOUNDBOARD_SOUNDS : [];
  const PLAYER_STATES = {
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5,
  };

  const elements = {
    grid: document.querySelector("#sound-grid"),
    count: document.querySelector("#sound-count"),
    loading: document.querySelector("#player-loading"),
    nowPlaying: document.querySelector("#now-playing-name"),
    status: document.querySelector("#player-status"),
    statusLight: document.querySelector("#status-light"),
    restart: document.querySelector("#restart-button"),
    play: document.querySelector("#play-button"),
    playLabel: document.querySelector("#play-label"),
    stop: document.querySelector("#stop-button"),
    loop: document.querySelector("#loop-button"),
    loopState: document.querySelector("#loop-state"),
    volume: document.querySelector("#volume-control"),
    volumeOutput: document.querySelector("#volume-output"),
    error: document.querySelector("#player-error"),
    errorMessage: document.querySelector("#player-error-message"),
    errorLink: document.querySelector("#error-youtube-link"),
    dismissError: document.querySelector("#dismiss-error"),
  };

  let player = null;
  let playerReady = false;
  let activeSound = null;
  let pendingSound = null;
  let isPlaying = false;
  let loopEnabled = readLoopPreference();

  function readLoopPreference() {
    try {
      return window.localStorage.getItem("soundboard-loop") === "true";
    } catch {
      return false;
    }
  }

  function storeLoopPreference() {
    try {
      window.localStorage.setItem("soundboard-loop", String(loopEnabled));
    } catch {
      // Playback still works if storage is unavailable.
    }
  }

  function formatDuration(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderSoundGrid() {
    elements.count.textContent = String(sounds.length);
    elements.grid.innerHTML = sounds
      .map(
        (sound, index) => `
          <button
            class="sound-card"
            type="button"
            data-sound-id="${escapeHtml(sound.id)}"
            aria-label="Play ${escapeHtml(sound.name)}"
            title="YouTube source: ${escapeHtml(sound.youtubeTitle)}"
          >
            <span class="sound-card__number">${String(index + 1).padStart(2, "0")}</span>
            <span class="sound-card__label">${escapeHtml(sound.name)}</span>
            <span class="sound-card__duration">${formatDuration(sound.duration)}</span>
          </button>
        `,
      )
      .join("");

    elements.grid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-sound-id]");
      if (!card) return;

      const sound = sounds.find((item) => item.id === card.dataset.soundId);
      if (!sound) return;

      if (activeSound?.id === sound.id && playerReady) {
        if (isPlaying) {
          player.pauseVideo();
        } else {
          player.playVideo();
        }
        return;
      }

      playSound(sound);
    });
  }

  function loadYouTubeApi() {
    if (!sounds.length) {
      showError("No sounds have been added to this soundboard yet.");
      elements.loading.textContent = "No sounds available";
      return;
    }

    if (window.location.protocol === "file:") {
      elements.loading.textContent = "A web server is required";
      setStatus("Open this page through GitHub Pages or a local web server.");
      showError(
        "YouTube cannot identify pages opened directly from disk. Use GitHub Pages or run a local web server.",
      );
      return;
    }

    window.onYouTubeIframeAPIReady = createPlayer;
    createPlayerIframe();
    const apiScript = document.createElement("script");
    apiScript.src = "https://www.youtube.com/iframe_api";
    apiScript.async = true;
    apiScript.addEventListener("error", () => {
      elements.loading.textContent = "YouTube could not be reached";
      setStatus("Check the internet connection, then reload this page.");
      showError("The YouTube player could not be loaded. Check the internet connection and try again.");
    });
    document.head.append(apiScript);
  }

  function createPlayerIframe() {
    const pageUrl = window.location.href.split("#")[0];
    const embedUrl = new URL(`https://www.youtube.com/embed/${sounds[0].id}`);
    embedUrl.searchParams.set("enablejsapi", "1");
    embedUrl.searchParams.set("controls", "1");
    embedUrl.searchParams.set("playsinline", "1");
    embedUrl.searchParams.set("rel", "0");
    embedUrl.searchParams.set("origin", window.location.origin);
    embedUrl.searchParams.set("widget_referrer", pageUrl);

    const iframe = document.createElement("iframe");
    iframe.id = "youtube-player";
    iframe.src = embedUrl.toString();
    iframe.title = "YouTube video player";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    document.querySelector("#youtube-player").replaceWith(iframe);
  }

  function createPlayer() {
    player = new window.YT.Player(document.querySelector("#youtube-player"), {
      events: {
        onReady: handlePlayerReady,
        onStateChange: handlePlayerStateChange,
        onError: handlePlayerError,
        onAutoplayBlocked: handleAutoplayBlocked,
      },
    });
  }

  function handlePlayerReady() {
    playerReady = true;
    elements.loading?.remove();
    setControlsDisabled(false);
    player.setVolume(Number(elements.volume.value));
    updateLoopControl();
    setStatus("Ready — choose a sound.");

    if (pendingSound) {
      const sound = pendingSound;
      pendingSound = null;
      playSound(sound);
    }
  }

  function handlePlayerStateChange(event) {
    switch (event.data) {
      case PLAYER_STATES.ENDED:
        setPlayingState(false);
        if (loopEnabled && activeSound) {
          setStatus(`Looping ${activeSound.name}…`);
          player.seekTo(0, true);
          player.playVideo();
        } else {
          setStatus(activeSound ? `${activeSound.name} finished.` : "Playback finished.");
        }
        break;
      case PLAYER_STATES.PLAYING:
        setPlayingState(true);
        hideError();
        setStatus("Playing from YouTube");
        break;
      case PLAYER_STATES.PAUSED:
        setPlayingState(false);
        setStatus("Paused");
        break;
      case PLAYER_STATES.BUFFERING:
        setStatus("Buffering…");
        break;
      case PLAYER_STATES.CUED:
        setPlayingState(false);
        setStatus("Ready to play");
        break;
      default:
        break;
    }
  }

  function handlePlayerError(event) {
    setPlayingState(false);
    const errorMessages = {
      2: "YouTube rejected this video ID.",
      5: "This video cannot be played in the HTML5 player.",
      100: "This video was removed or made private.",
      101: "The owner does not allow this video to be embedded.",
      150: "The owner does not allow this video to be embedded.",
      153: "YouTube could not verify this site for playback.",
    };
    const message = errorMessages[event.data] || "YouTube could not play this sound.";
    setStatus("Playback unavailable");
    showError(message, activeSound);
  }

  function handleAutoplayBlocked() {
    setPlayingState(false);
    setStatus("Press Play to start this sound.");
    showError("Your browser blocked automatic playback. Press Play to continue.", activeSound);
  }

  function playSound(sound) {
    activeSound = sound;
    updateActiveSound();
    hideError();
    setStatus(`Loading ${sound.name}…`);

    if (!playerReady) {
      pendingSound = sound;
      setStatus("The player is still loading. Your sound is queued.");
      return;
    }

    player.loadVideoById({ videoId: sound.id, startSeconds: 0 });
  }

  function setPlayingState(playing) {
    isPlaying = playing;
    elements.play.classList.toggle("is-playing", playing);
    elements.playLabel.textContent = playing ? "Pause" : "Play";
    elements.play.setAttribute("aria-label", playing ? "Pause" : "Play");
    elements.statusLight.classList.toggle("is-on", playing);
    updateActiveSound();
  }

  function updateActiveSound() {
    elements.nowPlaying.textContent = activeSound?.name || "Select a sound";
    document.querySelectorAll("[data-sound-id]").forEach((card) => {
      const selected = card.dataset.soundId === activeSound?.id;
      card.classList.toggle("is-active", selected);
      card.classList.toggle("is-playing", selected && isPlaying);
      card.setAttribute(
        "aria-label",
        selected && isPlaying
          ? `Pause ${activeSound.name}`
          : `Play ${sounds.find((sound) => sound.id === card.dataset.soundId)?.name || "sound"}`,
      );
    });
  }

  function setControlsDisabled(disabled) {
    [elements.restart, elements.play, elements.stop, elements.loop, elements.volume].forEach(
      (control) => {
        control.disabled = disabled;
      },
    );
  }

  function setStatus(message) {
    elements.status.textContent = message;
  }

  function updateLoopControl() {
    elements.loop.setAttribute("aria-pressed", String(loopEnabled));
    elements.loopState.textContent = loopEnabled ? "On" : "Off";
    elements.loop.setAttribute("aria-label", `Loop ${loopEnabled ? "on" : "off"}`);
  }

  function showError(message, sound = null) {
    elements.errorMessage.textContent = message;
    elements.errorLink.href = sound
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(sound.id)}`
      : "https://www.youtube.com/";
    elements.error.hidden = false;
  }

  function hideError() {
    elements.error.hidden = true;
  }

  elements.play.addEventListener("click", () => {
    if (!playerReady) return;
    if (!activeSound) {
      playSound(sounds[0]);
      return;
    }

    if (isPlaying) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  });

  elements.restart.addEventListener("click", () => {
    if (!playerReady) return;
    if (!activeSound) activeSound = sounds[0];
    updateActiveSound();
    player.seekTo(0, true);
    player.playVideo();
  });

  elements.stop.addEventListener("click", () => {
    if (!playerReady) return;
    player.stopVideo();
    setPlayingState(false);
    setStatus(activeSound ? `${activeSound.name} stopped.` : "Stopped");
  });

  elements.loop.addEventListener("click", () => {
    loopEnabled = !loopEnabled;
    updateLoopControl();
    storeLoopPreference();
    setStatus(`Loop is ${loopEnabled ? "on" : "off"}.`);
  });

  elements.volume.addEventListener("input", () => {
    const volume = Number(elements.volume.value);
    elements.volumeOutput.textContent = `${volume}%`;
    if (playerReady) player.setVolume(volume);
  });

  elements.dismissError.addEventListener("click", hideError);

  renderSoundGrid();
  updateLoopControl();
  loadYouTubeApi();
})();
