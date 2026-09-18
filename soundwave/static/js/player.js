/* ==========================================================================
   Cadence unified player
   Plays two kinds of tracks through one set of controls:
     - "upload"  -> native <audio> element streaming from /stream/<file>
     - "youtube" -> YouTube IFrame API player (audio+video, hidden off-screen)
   Queue is built from whatever song-list is currently visible in the DOM.
   ========================================================================== */

(function () {
  const audioEl = document.getElementById("audioEl");
  if (!audioEl) return; // not logged in / no player on this page

  const playPauseBtn = document.getElementById("playPauseBtn");
  const playIcon = document.getElementById("playIcon");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const shuffleBtn = document.getElementById("shuffleBtn");
  const repeatBtn = document.getElementById("repeatBtn");
  const seekBar = document.getElementById("seekBar");
  const volumeBar = document.getElementById("volumeBar");
  const currentTimeEl = document.getElementById("currentTime");
  const durationTimeEl = document.getElementById("durationTime");
  const playerCover = document.getElementById("playerCover");
  const playerTitle = document.getElementById("playerTitle");
  const playerArtist = document.getElementById("playerArtist");
  const playerLikeBtn = document.getElementById("playerLikeBtn");
  const sourcePill = document.getElementById("sourcePill");

  const PLAY_SVG = '<path d="M8 5v14l11-7z"/>';
  const PAUSE_SVG = '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>';

  let queue = [];         // array of track dicts, built from the current DOM list
  let currentIndex = -1;
  let isPlaying = false;
  let shuffleOn = false;
  let repeatMode = "off"; // 'off' | 'all' | 'one'
  let ytPlayer = null;
  let ytReady = false;
  let ytPollTimer = null;
  let pendingYtVideoId = null;

  // ---- YouTube IFrame API setup -----------------------------------------

  window.onYouTubeIframeAPIReady = function () {
    ytPlayer = new YT.Player("ytPlayerContainer", {
      height: "1", width: "1",
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1 },
      events: {
        onReady: () => {
          ytReady = true;
          if (pendingYtVideoId) {
            loadYouTubeTrack(pendingYtVideoId);
            pendingYtVideoId = null;
          }
        },
        onStateChange: onYtStateChange,
      },
    });
  };

  function onYtStateChange(e) {
    if (e.data === YT.PlayerState.ENDED) {
      handleTrackEnded();
    } else if (e.data === YT.PlayerState.PLAYING) {
      isPlaying = true;
      updatePlayIcon();
      startYtProgressPolling();
    } else if (e.data === YT.PlayerState.PAUSED) {
      isPlaying = false;
      updatePlayIcon();
      stopYtProgressPolling();
    }
  }

  function startYtProgressPolling() {
    stopYtProgressPolling();
    ytPollTimer = setInterval(() => {
      if (!ytPlayer || !ytPlayer.getCurrentTime) return;
      const cur = ytPlayer.getCurrentTime() || 0;
      const dur = ytPlayer.getDuration() || 0;
      updateSeekUI(cur, dur);
    }, 500);
  }
  function stopYtProgressPolling() {
    if (ytPollTimer) clearInterval(ytPollTimer);
    ytPollTimer = null;
  }

  function loadYouTubeTrack(videoId) {
    if (!ytReady) { pendingYtVideoId = videoId; return; }
    ytPlayer.loadVideoById(videoId);
  }

  // ---- Queue building -----------------------------------------------------

  function buildQueueFromList(listEl) {
    const rows = Array.from(listEl.querySelectorAll(".song-row[data-id]"));
    return rows.map((row) => ({
      id: row.dataset.id,
      title: row.dataset.title,
      artist: row.dataset.artist,
      source: row.dataset.source,
      youtubeId: row.dataset.youtubeId,
      stream: row.dataset.stream,
      cover: row.dataset.cover,
      row: row,
    }));
  }

  function attachRowHandlers() {
    document.querySelectorAll(".song-list[data-scope]").forEach((listEl) => {
      listEl.querySelectorAll(".song-row[data-id]").forEach((row) => {
        row.addEventListener("click", (e) => {
          if (e.target.closest("button") || e.target.closest("form") || e.target.closest("a")) return;
          playFromList(listEl, row);
        });
        const playBtn = row.querySelector(".row-play-btn");
        if (playBtn) {
          playBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            playFromList(listEl, row);
          });
        }
      });
    });
  }

  function playFromList(listEl, row) {
    queue = buildQueueFromList(listEl);
    const idx = queue.findIndex((t) => t.id === row.dataset.id);
    if (idx === -1) return;
    playIndex(idx);
  }

  // ---- Core playback control -----------------------------------------------

  function playIndex(index) {
    if (index < 0 || index >= queue.length) return;

    // pause whatever was playing
    audioEl.pause();
    if (ytPlayer && ytPlayer.pauseVideo) { try { ytPlayer.pauseVideo(); } catch (e) {} }
    stopYtProgressPolling();

    highlightRow(currentIndex, false);
    currentIndex = index;
    highlightRow(currentIndex, true);

    const track = queue[currentIndex];
    updateNowPlayingUI(track);

    if (track.source === "youtube") {
      sourcePill.textContent = "YouTube";
      sourcePill.className = "source-pill show youtube";
      loadYouTubeTrack(track.youtubeId);
      // give the API a beat to start, then force play
      setTimeout(() => { if (ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo(); }, 250);
      isPlaying = true;
    } else {
      sourcePill.textContent = "Upload";
      sourcePill.className = "source-pill show upload";
      audioEl.src = track.stream;
      audioEl.play().then(() => { isPlaying = true; updatePlayIcon(); }).catch(() => {});
    }
    updatePlayIcon();
    markPlayed(track.id);
    syncLikeButtonForTrack(track.id);
  }

  function highlightRow(index, on) {
    if (index < 0 || index >= queue.length) return;
    const row = queue[index].row;
    if (row) row.classList.toggle("playing", on);
  }

  function updateNowPlayingUI(track) {
    playerTitle.textContent = track.title || "Untitled";
    playerArtist.textContent = track.artist || "Unknown artist";
    if (track.cover) {
      playerCover.style.backgroundImage = `url('${track.cover}')`;
      playerCover.textContent = "";
    } else {
      playerCover.style.backgroundImage = "";
      playerCover.textContent = "♪";
    }
  }

  function togglePlayPause() {
    if (currentIndex === -1) return;
    const track = queue[currentIndex];
    if (track.source === "youtube") {
      if (!ytPlayer) return;
      if (isPlaying) { ytPlayer.pauseVideo(); } else { ytPlayer.playVideo(); }
    } else {
      if (isPlaying) { audioEl.pause(); isPlaying = false; } else { audioEl.play(); isPlaying = true; }
      updatePlayIcon();
    }
  }

  function updatePlayIcon() {
    playIcon.innerHTML = isPlaying ? PAUSE_SVG : PLAY_SVG;
  }

  function playNext(auto) {
    if (queue.length === 0) return;
    let nextIdx;
    if (shuffleOn) {
      nextIdx = Math.floor(Math.random() * queue.length);
    } else {
      nextIdx = currentIndex + 1;
      if (nextIdx >= queue.length) {
        if (repeatMode === "all") nextIdx = 0;
        else return; // end of queue
      }
    }
    playIndex(nextIdx);
  }

  function playPrev() {
    if (queue.length === 0) return;
    // if more than 3s into the track, restart it instead of going back
    const cur = getCurrentTime();
    if (cur > 3) { seekTo(0); return; }
    let prevIdx = currentIndex - 1;
    if (prevIdx < 0) prevIdx = repeatMode === "all" ? queue.length - 1 : 0;
    playIndex(prevIdx);
  }

  function handleTrackEnded() {
    if (repeatMode === "one") {
      seekTo(0);
      const track = queue[currentIndex];
      if (track.source === "youtube") { ytPlayer.playVideo(); } else { audioEl.play(); }
      return;
    }
    playNext(true);
  }

  function getCurrentTime() {
    const track = queue[currentIndex];
    if (!track) return 0;
    if (track.source === "youtube") return (ytPlayer && ytPlayer.getCurrentTime) ? ytPlayer.getCurrentTime() : 0;
    return audioEl.currentTime;
  }

  function seekTo(seconds) {
    const track = queue[currentIndex];
    if (!track) return;
    if (track.source === "youtube") {
      if (ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo(seconds, true);
    } else {
      audioEl.currentTime = seconds;
    }
  }

  function markPlayed(songId) {
    fetch(`/song/${songId}/played`, { method: "POST" }).catch(() => {});
  }

  // ---- Seek bar / time display ---------------------------------------------

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function updateSeekUI(cur, dur) {
    currentTimeEl.textContent = formatTime(cur);
    durationTimeEl.textContent = formatTime(dur);
    seekBar.max = dur || 100;
    if (!seekBar.dragging) seekBar.value = cur;
  }

  audioEl.addEventListener("timeupdate", () => {
    if (queue[currentIndex] && queue[currentIndex].source !== "youtube") {
      updateSeekUI(audioEl.currentTime, audioEl.duration);
    }
  });
  audioEl.addEventListener("ended", handleTrackEnded);
  audioEl.addEventListener("play", () => { isPlaying = true; updatePlayIcon(); });
  audioEl.addEventListener("pause", () => { isPlaying = false; updatePlayIcon(); });

  seekBar.addEventListener("mousedown", () => { seekBar.dragging = true; });
  seekBar.addEventListener("touchstart", () => { seekBar.dragging = true; });
  seekBar.addEventListener("change", () => {
    seekTo(parseFloat(seekBar.value));
    seekBar.dragging = false;
  });

  volumeBar.addEventListener("input", () => {
    const v = parseFloat(volumeBar.value);
    audioEl.volume = v;
    if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(v * 100);
  });

  // ---- Buttons --------------------------------------------------------------

  playPauseBtn.addEventListener("click", togglePlayPause);
  nextBtn.addEventListener("click", () => playNext(false));
  prevBtn.addEventListener("click", playPrev);

  shuffleBtn.addEventListener("click", () => {
    shuffleOn = !shuffleOn;
    shuffleBtn.classList.toggle("active", shuffleOn);
  });

  repeatBtn.addEventListener("click", () => {
    repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
    repeatBtn.classList.toggle("active", repeatMode !== "off");
    repeatBtn.title = repeatMode === "one" ? "Repeat one" : repeatMode === "all" ? "Repeat all" : "Repeat";
  });

  // ---- Likes ------------------------------------------------------------

  function syncLikeButtonForTrack(songId) {
    const row = document.querySelector(`.song-row[data-id="${songId}"] .like-toggle`);
    const liked = row ? row.classList.contains("liked") : false;
    playerLikeBtn.classList.toggle("liked", liked);
  }

  function toggleLike(songId) {
    fetch(`/like/${songId}`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        document.querySelectorAll(`.song-row[data-id="${songId}"] .like-toggle`).forEach((btn) => {
          btn.classList.toggle("liked", data.liked);
        });
        if (queue[currentIndex] && queue[currentIndex].id === songId) {
          playerLikeBtn.classList.toggle("liked", data.liked);
        }
      })
      .catch(() => {});
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".like-toggle");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      toggleLike(btn.dataset.songId);
    }
  });

  playerLikeBtn.addEventListener("click", () => {
    if (currentIndex === -1) return;
    toggleLike(queue[currentIndex].id);
  });

  // ---- Init ---------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", attachRowHandlers);
  if (document.readyState !== "loading") attachRowHandlers();

  audioEl.volume = parseFloat(volumeBar.value);
})();
