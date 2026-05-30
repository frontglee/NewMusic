// ==========================================
// 1. TOP-LEVEL CONFIG & SETUP (Must be first)
// ==========================================
const { ipcRenderer } = require('electron');

// ==========================================
// 3. DATABASE INITIALIZATION (Local Loading)
// ==========================================
function loadDatabases() {
    try {
        console.log("Loading local databases...");
        
        // Safe fallbacks: Use the database if it exists, otherwise initialize as an empty list
        window.songsDatabase = typeof songsDatabase !== 'undefined' ? songsDatabase : [];
        window.albumsDatabase = typeof albumsDatabase !== 'undefined' ? albumsDatabase : [];
        window.artistsDatabase = typeof artistsDatabase !== 'undefined' ? artistsDatabase : [];

        calculateAlbumStats();
        handleRouting(); 
        console.log("Local databases initialized safely!");
    } catch (err) {
        console.error("Critical Failure:", err);
        alert("Failed to load local music library.");
    }
}

// Custom Integrated Alert System
window.showCustomAlert = function(msg) {
    const existing = document.getElementById('custom-app-modal');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'custom-app-modal';
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:999999; display:flex; justify-content:center; align-items:center; backdrop-filter: blur(4px);";
    
    overlay.innerHTML = `
        <div class="modal-box" style="width:360px; padding: 28px; background: #181818; border: 1px solid #282828; border-radius: 12px; box-shadow: 0 20px 50px rgba(0,0,0,0.9); text-align: center;">
            <p style="color: var(--text-main); margin: 0 0 24px 0; font-size: 15px; font-weight: 500; line-height: 1.5;">${msg}</p>
            <button class="btn-primary" style="justify-content: center; width: 100%; padding: 12px;" onclick="document.getElementById('custom-app-modal').remove()">OK</button>
        </div>
    `;
    document.body.appendChild(overlay);
};
window.alert = window.showCustomAlert;

window.showCustomPrompt = function(msg) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.id = 'custom-app-modal';
        overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:999999; display:flex; justify-content:center; align-items:center; backdrop-filter: blur(4px);";
        
        overlay.innerHTML = `
            <div class="modal-box" style="width:360px; padding: 28px; background: #181818; border: 1px solid #282828; border-radius: 12px; box-shadow: 0 20px 50px rgba(0,0,0,0.9); text-align: center;">
                <p style="color: var(--text-main); margin: 0 0 24px 0; font-size: 15px;">${msg}</p>
                <input type="password" id="prompt-input" style="width:100%; padding: 10px; margin-bottom: 20px; background:#222; border:1px solid #444; color:white; border-radius:4px;">
                <button class="btn-primary" style="width: 100%; padding: 12px;" id="prompt-ok">OK</button>
            </div>
        `;
        document.body.appendChild(overlay);
        
        document.getElementById('prompt-ok').addEventListener('click', () => {
            const val = document.getElementById('prompt-input').value;
            overlay.remove();
            resolve(val); // Send the password back
        });
    });
};

// Custom Integrated Confirmation System
window.showCustomConfirm = function(msg, onConfirm) {
    const existing = document.getElementById('custom-app-modal');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'custom-app-modal';
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:999999; display:flex; justify-content:center; align-items:center; backdrop-filter: blur(4px);";
    
    overlay.innerHTML = `
        <div class="modal-box" style="width:380px; padding: 28px; background: #181818; border: 1px solid #282828; border-radius: 12px; box-shadow: 0 20px 50px rgba(0,0,0,0.9);">
            <p style="color: var(--text-main); margin: 0 0 24px 0; font-size: 15px; font-weight: 500; line-height: 1.5; text-align: center;">${msg}</p>
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button class="btn-secondary" style="padding: 10px 20px; cursor: pointer;" onclick="document.getElementById('custom-app-modal').remove()">Cancel</button>
                <button class="btn-primary" id="custom-modal-confirm-btn" style="padding: 10px 20px; cursor: pointer;">Confirm</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    document.getElementById('custom-modal-confirm-btn').addEventListener('click', () => {
        overlay.remove();
        if (onConfirm) onConfirm();
    });
};
// ==========================================
// 1. GLOBAL STATE & CORE APPLICATION ELEMENTS
// ==========================================
const contentArea = document.getElementById('content-area');
const navArtists = document.getElementById('nav-artists');
const navAlbums = document.getElementById('nav-albums'); 
const navSongs = document.getElementById('nav-songs'); 

const audioPlayer = new Audio();
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const audioSource = audioCtx.createMediaElementSource(audioPlayer);
const compressor = audioCtx.createDynamicsCompressor();
const fadeNode = audioCtx.createGain();

compressor.threshold.value = -24; 
compressor.knee.value = 30;       
compressor.ratio.value = 12;      
compressor.attack.value = 0.003;  
compressor.release.value = 0.25;  

audioSource.connect(compressor);
compressor.connect(fadeNode);
fadeNode.connect(audioCtx.destination);

audioPlayer.addEventListener('play', () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
});

let currentSong = null;
let playQueue = [];          
let originalQueue = [];      
let currentQueueIndex = 0;   
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0;          
let isSyncedLyrics = true;
let isAutoplay = true; 

// Track whether the current song grid view is "All Songs" or "Favorites"
let currentSongViewIsFavorites = false; 

// ==========================================
// 🎧 SMOOTH AUDIO FADES
// ==========================================
const FADE_OUT_TIME = 0.25; 
const SHORT_FADE_TIME = 0.05; 

function smoothPlay() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    fadeNode.gain.cancelScheduledValues(audioCtx.currentTime);
    fadeNode.gain.setValueAtTime(0, audioCtx.currentTime);
    audioPlayer.play();
    fadeNode.gain.linearRampToValueAtTime(1, audioCtx.currentTime + SHORT_FADE_TIME);
}

function smoothPause() {
    fadeNode.gain.cancelScheduledValues(audioCtx.currentTime);
    fadeNode.gain.setValueAtTime(fadeNode.gain.value, audioCtx.currentTime);
    fadeNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + FADE_OUT_TIME);
    setTimeout(() => { audioPlayer.pause(); }, FADE_OUT_TIME * 1000);
}

// ==========================================
// DYNAMIC YEAR BOUNDS CALCULATION
// ==========================================
let validAlbumYears = albumsDatabase.map(a => a.releaseDate ? parseInt(a.releaseDate.substring(0, 4)) : 0).filter(y => y > 1000);
let minAlbumYear = validAlbumYears.length > 0 ? Math.min(...validAlbumYears) : 1950;
let maxAlbumYear = validAlbumYears.length > 0 ? Math.max(...validAlbumYears) : new Date().getFullYear();

let validArtistYears = artistsDatabase.map(a => parseInt(a.startYear)).filter(y => !isNaN(y) && y > 1000);
let minArtistYear = validArtistYears.length > 0 ? Math.min(...validArtistYears) : 1950;
let maxArtistYear = validArtistYears.length > 0 ? Math.max(...validArtistYears) : new Date().getFullYear();

let artistState = { search: "", sortBy: "firstlistenYear", sortDir: "desc", yearRange: { min: minArtistYear, max: maxArtistYear }, filters: { genre: [], tag: [], country: [], startYear: [], firstlistenYear: [] } };
let albumState = { searchAlbum: "", searchArtist: "", sortBy: "firstlistenDate", sortDir: "desc", releaseType: 0, yearRange: { min: minAlbumYear, max: maxAlbumYear }, filters: { artist: [], genre: [], tag: [], year: [] } };
let songState = { search: "", sortBy: "title", sortDir: "asc", yearRange: { min: minAlbumYear, max: maxAlbumYear }, filters: { artist: [], year: [], genre: [], tag: [] } };

let currentAlbumSort = { by: 'track', dir: 'asc' }; 
window.currentGlobalSongsList = [];

// ==========================================
// DUAL SLIDER HELPERS
// ==========================================
function buildYearRangeSlider(idPrefix, minYear = 1950, maxYear = 2030) {
    return `
    <div class="dual-range-container">
        <div class="dual-range-label">Year Range: <div><span id="${idPrefix}-lbl-min">${minYear}</span> - <span id="${idPrefix}-lbl-max">${maxYear}</span></div></div>
        <div class="dual-range-track-wrapper">
            <div class="dual-range-track" id="${idPrefix}-track"></div>
            <input type="range" id="${idPrefix}-min" min="${minYear}" max="${maxYear}" value="${minYear}" class="dual-range-input">
            <input type="range" id="${idPrefix}-max" min="${minYear}" max="${maxYear}" value="${maxYear}" class="dual-range-input">
        </div>
    </div>`;
}

function attachDualSliderLogic(idPrefix, stateObj, updateCallback) {
    const minSlider = document.getElementById(`${idPrefix}-min`);
    const maxSlider = document.getElementById(`${idPrefix}-max`);
    const minLbl = document.getElementById(`${idPrefix}-lbl-min`);
    const maxLbl = document.getElementById(`${idPrefix}-lbl-max`);
    const track = document.getElementById(`${idPrefix}-track`);
    
    minSlider.value = stateObj.yearRange.min;
    maxSlider.value = stateObj.yearRange.max;

    const minLimit = parseInt(minSlider.min);
    const maxLimit = parseInt(maxSlider.max);

    function updateUI() {
        let val1 = parseInt(minSlider.value);
        let val2 = parseInt(maxSlider.value);
        if (val1 > val2) { let tmp = val1; val1 = val2; val2 = tmp; }
        
        minLbl.innerText = val1;
        maxLbl.innerText = val2;
        
        let percent1 = ((val1 - minLimit) / (maxLimit - minLimit)) * 100;
        let percent2 = ((val2 - minLimit) / (maxLimit - minLimit)) * 100;
        track.style.left = percent1 + "%";
        track.style.width = (percent2 - percent1) + "%";

        stateObj.yearRange.min = val1;
        stateObj.yearRange.max = val2;
    }

    minSlider.addEventListener('input', () => { if (parseInt(minSlider.value) >= parseInt(maxSlider.value)) minSlider.value = parseInt(maxSlider.value) - 1; updateUI(); });
    maxSlider.addEventListener('input', () => { if (parseInt(maxSlider.value) <= parseInt(minSlider.value)) maxSlider.value = parseInt(minSlider.value) + 1; updateUI(); });
    minSlider.addEventListener('change', updateCallback);
    maxSlider.addEventListener('change', updateCallback);
    updateUI(); 
}

// ==========================================
// 2. DYNAMIC HTML INJECTION (THE IMAGE MODAL)
// ==========================================
const modalContainer = document.createElement('div');
modalContainer.id = 'image-modal';
modalContainer.innerHTML = `<img id="modal-image" src="" alt="Zoomed Cover">`;
document.body.appendChild(modalContainer);

modalContainer.addEventListener('click', (e) => { if (e.target.id === 'image-modal') closeImageModal(); });
function openImageModal(imgSrc) { document.getElementById('modal-image').src = imgSrc; document.getElementById('image-modal').classList.add('visible'); }
function closeImageModal() { document.getElementById('image-modal').classList.remove('visible'); }

// ==========================================
// AUTO-CALCULATE ALBUM STATS
// ==========================================
function calculateAlbumStats() {
    albumsDatabase.forEach(album => {
        const albumSongs = songsDatabase.filter(song => song.albumID === album.albumID);
        album.trackcount = albumSongs.length;
        album.duration = albumSongs.reduce((total, song) => total + (parseInt(song.duration) || 0), 0);
    });
}

// ==========================================
// 3. THE ROUTER ENGINE 
// ==========================================
let homeClockInterval = null; 

function handleRouting() {
    if (homeClockInterval) { clearInterval(homeClockInterval); homeClockInterval = null; }

    const hash = window.location.hash;
    if (hash === '#artists') { updateSidebarActiveState('nav-artists'); renderArtistsView(); } 
    else if (hash === '#albums') { updateSidebarActiveState('nav-albums'); renderAlbumsView(); } 
    else if (hash === '#songs') { updateSidebarActiveState('nav-songs'); renderSongsView(false); } 
    else if (hash === '#favorites') { updateSidebarActiveState('nav-favorites'); renderSongsView(true); } 
    else if (hash === '#settings') { updateSidebarActiveState('nav-settings'); renderSettingsView(); } 
    else if (hash.startsWith('#album/')) { updateSidebarActiveState('nav-albums'); renderAlbumDetailView(hash.replace('#album/', '')); } 
    else if (hash.startsWith('#artist/')) { updateSidebarActiveState('nav-artists'); renderArtistDetailView(hash.replace('#artist/', '')); } 
    // Add these to your handleRouting() else if chain:
    else if (hash === '#playlists') { updateSidebarActiveState('nav-playlists'); renderPlaylistsView(); } 
    else if (hash.startsWith('#playlist/')) { updateSidebarActiveState('nav-playlists'); renderPlaylistDetailView(hash.replace('#playlist/', '')); }
    else if (hash === '#stats') { updateSidebarActiveState('nav-stats'); renderStatsView(); }
    else { updateSidebarActiveState('nav-home'); renderHomeView(); }
}
window.addEventListener('hashchange', handleRouting);

// ==========================================
// 4. UI GENERATION HELPERS
// ==========================================
function updateSidebarActiveState(clickedId) {
    document.querySelectorAll('#sidebar li a').forEach(link => link.classList.remove('active'));
    const activeLink = document.getElementById(clickedId);
    if (activeLink) activeLink.classList.add('active');
}
function buildMultiSelect(id, label, optionsSet) {
    let optionsHtml = Array.from(optionsSet).sort().map(val => `<label><input type="checkbox" value="${val}"> ${val}</label>`).join('');
    return `<div id="${id}" class="multi-select"><div class="anchor">${label} <span>▼</span></div><div class="items">${optionsHtml}</div></div>`;
}
function getArtistName(artistID) {
    const found = artistsDatabase.find(a => a.artistID === artistID);
    return found ? found.artist : "Unknown Artist";
}
function formatTime(totalSeconds) {
    if (isNaN(totalSeconds) || totalSeconds === null) return "0:00";
    let m = Math.floor(totalSeconds / 60);
    let s = Math.floor(totalSeconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ==========================================
// 5. 🎧 MASTER AUDIO & CONTROLS ENGINE
// ==========================================
async function fetchAndParseLRC(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Lyrics file not found");
        const rawText = await response.text();
        const lines = rawText.split('\n');
        const parsedLyrics = [];
        const timeRegEx = /\[(\d{2}):(\d{2}(?:\.\d+)?)\]/;
        
        let hasTimestamps = false; 

        lines.forEach(line => {
            const match = line.match(timeRegEx);
            if (match) {
                hasTimestamps = true;
                const totalSeconds = (parseInt(match[1]) * 60) + parseFloat(match[2]);
                const text = line.replace(timeRegEx, '').trim();
                parsedLyrics.push({ time: totalSeconds, text: text });
            } else if (!line.startsWith('[')) {
                parsedLyrics.push({ time: null, text: line.trim() });
            }
        });
        
        parsedLyrics.isSynced = hasTimestamps;
        return parsedLyrics;
    } catch (error) { return null; }
}

function renderLyricsToPanel(lyricsArray) {
    const lyricsPanel = document.getElementById('lyrics-panel');
    if (!lyricsPanel) return;
    
    const isStatic = lyricsArray.isSynced === false;
    if (!isSyncedLyrics || isStatic) lyricsPanel.classList.add('simple-mode'); 
    else lyricsPanel.classList.remove('simple-mode');

    lyricsPanel.innerHTML = lyricsArray.map((l, i) => {
        let text = l.text.trim();
        let clickAction = isStatic ? '' : `onclick="audioPlayer.currentTime = ${l.time}; audioPlayer.play();"`;
        
        if (text === '') return `<div class="lyric-line empty-gap" id="lyric-${i}" ${clickAction}></div>`; 
        return `<div class="lyric-line" id="lyric-${i}" ${clickAction}>${text}</div>`;
    }).join('');
}

async function updateLyricsPanel() {
    const lyricsPanel = document.getElementById('lyrics-panel');
    if (!lyricsPanel) return; 
    if (!currentSong) { lyricsPanel.innerHTML = '<p style="color: #666;">Select a track to view lyrics.</p>'; return; }
    if (currentSong.parsedLyrics) { renderLyricsToPanel(currentSong.parsedLyrics); return; }
    if (currentSong.paths && currentSong.paths.lyrics) {
        lyricsPanel.innerHTML = '<p style="color: #666;">Loading lyrics...</p>';
        const checkingSongID = currentSong.songID; 
        const lyricsData = await fetchAndParseLRC(currentSong.paths.lyrics);
        if (currentSong.songID !== checkingSongID) return; 
        if (lyricsData && lyricsData.length > 0) { currentSong.parsedLyrics = lyricsData; renderLyricsToPanel(lyricsData); } 
        else { lyricsPanel.innerHTML = '<p style="color: #666;">Failed to load lyrics.</p>'; }
    } else { lyricsPanel.innerHTML = '<p style="color: #666;">No lyrics available for this track.</p>'; }
}

function toggleLyricsMode() {
    isSyncedLyrics = !isSyncedLyrics;
    const micBtn = document.querySelector('#bottom-player .extra-controls .icon-btn:nth-child(2)');
    if(micBtn) isSyncedLyrics ? micBtn.classList.add('active-toggle') : micBtn.classList.remove('active-toggle');
    const panel = document.getElementById('lyrics-panel');
    if (panel) {
        if (isSyncedLyrics) { panel.classList.remove('simple-mode'); } 
        else { panel.classList.add('simple-mode'); document.querySelectorAll('.lyric-line').forEach(el => el.classList.remove('active')); }
    }
}

function toggleAutoplay() {
    isAutoplay = !isAutoplay;
    const autoBtn = document.getElementById('btn-autoplay');
    if(autoBtn) isAutoplay ? autoBtn.classList.add('active-toggle') : autoBtn.classList.remove('active-toggle');
}

function playSong(songID) {
    const song = songsDatabase.find(s => s.songID === songID);
    if (!song) return;

    const executePlay = () => {
        currentSong = song;
        audioPlayer.src = song.paths.audio;
        smoothPlay(); 

        const album = albumsDatabase.find(a => a.albumID === song.albumID);
        const bottomPlayer = document.getElementById('bottom-player');
        
        const coverEl = bottomPlayer.querySelector('.cover-placeholder');
        coverEl.innerHTML = `<img src="${album ? album.paths.cover : ''}" style="width:100%; height:100%; object-fit:cover; border-radius:4px;" onerror="this.style.display='none'">`;
        coverEl.onclick = () => { if (album) window.location.hash = `album/${album.albumID}`; };
        
        const titleEl = bottomPlayer.querySelector('.track-info .title');
        titleEl.innerText = song.title;
        titleEl.onclick = () => { if (album) window.location.hash = `album/${album.albumID}`; };
        
        const artistEl = bottomPlayer.querySelector('.track-info .artist');
        artistEl.innerText = getArtistName(song.artistID);
        artistEl.onclick = () => { window.location.hash = `artist/${song.artistID}`; };
        
        document.querySelectorAll('.track-item').forEach(el => el.classList.remove('active-track'));
        document.querySelectorAll(`.track-item[data-song-id="${songID}"]`).forEach(row => row.classList.add('active-track'));

        updateLyricsPanel();
        updatePlayerHeart(); 
    };

    if (!audioPlayer.paused && audioPlayer.src) {
        fadeNode.gain.cancelScheduledValues(audioCtx.currentTime);
        fadeNode.gain.setValueAtTime(fadeNode.gain.value, audioCtx.currentTime);
        fadeNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + SHORT_FADE_TIME);
        setTimeout(executePlay, SHORT_FADE_TIME * 1000);
    } else {
        executePlay();
    }
}

audioPlayer.addEventListener('ended', () => {
    if (currentAccount && currentSong) ipcRenderer.send('log-listen-history', { accountId: currentAccount.id, songId: currentSong.songID });
    if (repeatMode === 2) { audioPlayer.currentTime = 0; audioPlayer.play(); } 
    else if (isAutoplay) { playNextTrack(); } 
    else { isPlaying = false; document.querySelector('#bottom-player .play-btn').innerHTML = `<svg class="icon icon-filled" style="width:14px; height:14px;"><use href="#icon-play"></use></svg>`; }
});

audioPlayer.addEventListener('play', () => { isPlaying = true; document.querySelector('#bottom-player .play-btn').innerHTML = `<svg class="icon icon-filled" style="width:14px; height:14px;"><use href="#icon-pause"></use></svg>`; });
audioPlayer.addEventListener('pause', () => { isPlaying = false; document.querySelector('#bottom-player .play-btn').innerHTML = `<svg class="icon icon-filled" style="width:14px; height:14px;"><use href="#icon-play"></use></svg>`; });

function playNextTrack() {
    if (playQueue.length === 0) return;
    currentQueueIndex++;
    if (currentQueueIndex >= playQueue.length) { if (repeatMode === 1) { currentQueueIndex = 0; } else { currentQueueIndex = playQueue.length - 1; audioPlayer.pause(); return; } }
    playSong(playQueue[currentQueueIndex].songID);
}

function playPrevTrack() {
    if (playQueue.length === 0) return;
    if (audioPlayer.currentTime > 3) { audioPlayer.currentTime = 0; return; }
    currentQueueIndex--;
    if (currentQueueIndex < 0) { currentQueueIndex = repeatMode === 1 ? playQueue.length - 1 : 0; }
    playSong(playQueue[currentQueueIndex].songID);
}

function togglePlayPause() {
    if (!currentSong && playQueue.length > 0) { playSong(playQueue[0].songID); return; }
    if (!currentSong) return;
    audioPlayer.paused ? smoothPlay() : smoothPause();
}

function shuffleArray(array) {
    let newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [newArr[i], newArr[j]] = [newArr[j], newArr[i]]; }
    return newArr;
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    const btn = document.querySelector('#bottom-player .buttons .icon-btn:nth-child(1)');
    isShuffle ? btn.classList.add('active-toggle') : btn.classList.remove('active-toggle');
    if (playQueue.length > 0) {
        if (isShuffle) { let remaining = shuffleArray(playQueue.slice(currentQueueIndex + 1)); playQueue = [...playQueue.slice(0, currentQueueIndex + 1), ...remaining]; } 
        else { let currentSongID = playQueue[currentQueueIndex].songID; playQueue = [...originalQueue]; currentQueueIndex = playQueue.findIndex(s => s.songID === currentSongID); }
    }
}

function toggleRepeat() {
    repeatMode = (repeatMode + 1) % 3; 
    const btn = document.querySelector('#bottom-player .buttons .icon-btn:nth-child(5)');
    if (repeatMode === 0) { btn.classList.remove('active-toggle'); btn.innerHTML = `<svg class="icon"><use href="#icon-repeat"></use></svg>`; } 
    else if (repeatMode === 1) { btn.classList.add('active-toggle'); btn.innerHTML = `<svg class="icon"><use href="#icon-repeat"></use></svg>`; } 
    else if (repeatMode === 2) { btn.classList.add('active-toggle'); btn.innerHTML = `<svg class="icon"><use href="#icon-repeat-1"></use></svg>`; }
}

function playAlbumContext(albumID, forceShuffle = false) {
    let albumSongs = songsDatabase.filter(s => s.albumID === albumID);
    albumSongs.sort((a, b) => {
        let valA = a[currentAlbumSort.by]; let valB = b[currentAlbumSort.by];
        if (typeof valA === 'string') valA = valA.toLowerCase(); if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return currentAlbumSort.dir === 'asc' ? -1 : 1; 
        if (valA > valB) return currentAlbumSort.dir === 'asc' ? 1 : -1; 
        return 0;
    });

    if (albumSongs.length === 0) return alert("No tracks found!");
    originalQueue = [...albumSongs];
    if (forceShuffle && !isShuffle) toggleShuffle(); 
    playQueue = isShuffle ? shuffleArray(albumSongs) : [...albumSongs];
    currentQueueIndex = 0;
    playSong(playQueue[currentQueueIndex].songID);
}

function playQueueFrom(albumID, index) {
    let albumSongs = songsDatabase.filter(s => s.albumID === albumID);
    albumSongs.sort((a, b) => {
        let valA = a[currentAlbumSort.by]; let valB = b[currentAlbumSort.by];
        if (typeof valA === 'string') valA = valA.toLowerCase(); if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return currentAlbumSort.dir === 'asc' ? -1 : 1; 
        if (valA > valB) return currentAlbumSort.dir === 'asc' ? 1 : -1; 
        return 0;
    });

    originalQueue = [...albumSongs];
    playQueue = isShuffle ? shuffleArray(albumSongs) : [...albumSongs];
    let clickedSongID = albumSongs[index].songID;
    currentQueueIndex = playQueue.findIndex(s => s.songID === clickedSongID);
    playSong(playQueue[currentQueueIndex].songID);
}

function playArtistContext(artistID, forceShuffle = false) {
    let artistSongs = songsDatabase.filter(s => s.artistID === artistID);
    if (artistSongs.length === 0) return alert("No tracks found!");
    originalQueue = [...artistSongs];
    if (forceShuffle && !isShuffle) toggleShuffle(); 
    playQueue = isShuffle ? shuffleArray(artistSongs) : [...artistSongs];
    currentQueueIndex = 0;
    playSong(playQueue[currentQueueIndex].songID);
}

function playQueueFromArtist(artistID, index) {
    let artistSongs = songsDatabase.filter(s => s.artistID === artistID);
    originalQueue = [...artistSongs];
    playQueue = isShuffle ? shuffleArray(artistSongs) : [...artistSongs];
    let clickedSongID = artistSongs[index].songID;
    currentQueueIndex = playQueue.findIndex(s => s.songID === clickedSongID);
    playSong(playQueue[currentQueueIndex].songID);
}

function playGlobalSongContext(index) {
    if (!window.currentGlobalSongsList || window.currentGlobalSongsList.length === 0) return;
    let globalSongs = window.currentGlobalSongsList;
    originalQueue = [...globalSongs];
    playQueue = isShuffle ? shuffleArray(globalSongs) : [...globalSongs];
    let clickedSongID = globalSongs[index].songID;
    currentQueueIndex = playQueue.findIndex(s => s.songID === clickedSongID);
    playSong(playQueue[currentQueueIndex].songID);
}

audioPlayer.addEventListener('timeupdate', () => {
    const progressBar = document.querySelector('#bottom-player .progress-bar input[type="range"]');
    if (audioPlayer.duration) {
        const percentage = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        progressBar.value = percentage;
        progressBar.style.backgroundImage = `linear-gradient(to right, #ffffff ${percentage}%, transparent ${percentage}%)`;
        document.querySelector('#bottom-player .progress-bar .time:first-child').innerText = formatTime(audioPlayer.currentTime);
        document.querySelector('#bottom-player .progress-bar .time:last-child').innerText = formatTime(audioPlayer.duration);
    }

    if (isSyncedLyrics && currentSong && currentSong.parsedLyrics && currentSong.parsedLyrics.isSynced) {
        let activeIndex = -1;
        const currentTime = audioPlayer.currentTime;
        for (let i = 0; i < currentSong.parsedLyrics.length; i++) { if (currentTime >= currentSong.parsedLyrics[i].time) { activeIndex = i; } else { break; } }
        if (activeIndex !== -1) {
            const activeLyric = document.getElementById(`lyric-${activeIndex}`);
            if (activeLyric && !activeLyric.classList.contains('active')) {
                document.querySelectorAll('.lyric-line').forEach(el => el.classList.remove('active'));
                activeLyric.classList.add('active');
                
                const panel = document.getElementById('lyrics-panel');
                if (panel) {
                    panel.scrollTo({
                        top: activeLyric.offsetTop - (panel.clientHeight / 2) + (activeLyric.clientHeight / 2),
                        behavior: 'smooth'
                    });
                }
            }
        }
     }   
});

document.querySelector('#bottom-player .progress-bar input[type="range"]').addEventListener('input', (e) => {
    if (audioPlayer.duration) {
        audioPlayer.currentTime = (e.target.value / 100) * audioPlayer.duration;
        e.target.style.backgroundImage = `linear-gradient(to right, #ffffff ${e.target.value}%, transparent ${e.target.value}%)`;
    }
});

const volSlider = document.querySelector('.volume-slider');
let previousVolume = volSlider.value / 100;
audioPlayer.volume = previousVolume; 
volSlider.style.backgroundImage = `linear-gradient(to right, #ffffff ${volSlider.value}%, transparent ${volSlider.value}%)`;

const muteBtn = volSlider.previousElementSibling;
function updateVolumeIcon(vol) {
    if (!muteBtn) return;
    if (vol <= 0) { muteBtn.innerHTML = `<svg class="icon"><use href="#icon-mute"></use></svg>`; } 
    else { muteBtn.innerHTML = `<svg class="icon"><use href="#icon-volume"></use></svg>`; }
}
updateVolumeIcon(audioPlayer.volume);

window.setVolume = function(vol) {
    audioPlayer.volume = Math.max(0, Math.min(1, vol));
    previousVolume = audioPlayer.volume;
    volSlider.value = audioPlayer.volume * 100;
    volSlider.style.backgroundImage = `linear-gradient(to right, #ffffff ${volSlider.value}%, transparent ${volSlider.value}%)`;
    updateVolumeIcon(audioPlayer.volume);
};

volSlider.addEventListener('input', (e) => {
    setVolume(e.target.value / 100);
});

// GLOBAL KEYBOARD MEDIA SHORTCUTS
document.addEventListener('keydown', (e) => {
    // DO NOT intercept if typing in a search bar or text input
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    // Prevent default scrolling for media keys
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault(); 
    }

    if (e.key === ' ' && !e.ctrlKey) { 
        togglePlayPause(); 
    } else if (e.key === 'ArrowRight' && e.ctrlKey) { 
        playNextTrack(); 
    } else if (e.key === 'ArrowLeft' && e.ctrlKey) { 
        playPrevTrack(); 
    } else if (e.key === 'ArrowRight' && !e.ctrlKey) { 
        if (audioPlayer.duration) audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 5); 
    } else if (e.key === 'ArrowLeft' && !e.ctrlKey) { 
        audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 5); 
    } else if (e.key === 'ArrowUp') { 
        setVolume(audioPlayer.volume + 0.05); 
    } else if (e.key === 'ArrowDown') { 
        setVolume(audioPlayer.volume - 0.05); 
    }
});

if (muteBtn) {
    muteBtn.style.cursor = 'pointer';
    muteBtn.addEventListener('click', () => {
        if (audioPlayer.volume > 0) { previousVolume = audioPlayer.volume; audioPlayer.volume = 0; volSlider.value = 0; } 
        else { audioPlayer.volume = previousVolume > 0 ? previousVolume : 1; volSlider.value = audioPlayer.volume * 100; }
        volSlider.style.backgroundImage = `linear-gradient(to right, #ffffff ${volSlider.value}%, transparent ${volSlider.value}%)`;
        updateVolumeIcon(audioPlayer.volume);
    });
}

document.querySelector('#bottom-player .buttons .icon-btn:nth-child(1)').addEventListener('click', toggleShuffle);
document.querySelector('#bottom-player .buttons .icon-btn:nth-child(2)').addEventListener('click', playPrevTrack);
document.querySelector('#bottom-player .buttons .play-btn').addEventListener('click', togglePlayPause);
document.querySelector('#bottom-player .buttons .icon-btn:nth-child(4)').addEventListener('click', playNextTrack);
document.querySelector('#bottom-player .buttons .icon-btn:nth-child(5)').addEventListener('click', toggleRepeat);

const autoBtn = document.getElementById('btn-autoplay');
if (autoBtn) { autoBtn.addEventListener('click', toggleAutoplay); if (isAutoplay) autoBtn.classList.add('active-toggle'); }

const micBtn = document.querySelector('#bottom-player .extra-controls .icon-btn:nth-child(2)');
if (micBtn) { micBtn.addEventListener('click', toggleLyricsMode); if (isSyncedLyrics) micBtn.classList.add('active-toggle'); }

// ==========================================
// 6. THE DYNAMIC PAGES (VIEWS)
// ==========================================
let isEditMode = localStorage.getItem('isEditMode') === 'true'; 
let isAutoDLMode = localStorage.getItem('isAutoDLMode') === 'true'; 

if (!document.getElementById('edit-styles')) {
    document.head.insertAdjacentHTML('beforeend', `
        <style id="edit-styles">
            .album-card, .artist-card { position: relative; }
            .edit-btn {
                position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.8); color: white;
                border: 1px solid #555; border-radius: 50%; width: 32px; height: 32px; display: flex;
                justify-content: center; align-items: center; cursor: pointer; z-index: 10;
                transition: all 0.2s;
            }
            .edit-btn:hover { background: var(--text-main); color: black; border-color: var(--text-main); transform: scale(1.1); }
            .edit-inline { cursor: pointer; color: var(--text-muted); transition: color 0.2s; display: flex; align-items: center; justify-content: center;}
            .edit-inline:hover { color: var(--text-main); }
        </style>
    `);
}

function renderSettingsView() {
    contentArea.innerHTML = `
        <h1 class="header-title">Settings</h1>
        <div style="background: #181818; padding: 24px; border-radius: 8px; border: 1px solid #282828; display: flex; flex-direction: column; gap: 24px;">
            
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; font-size: 18px; color: var(--text-main);">Enable Database Editor</h3>
                    <p style="margin: 5px 0 0 0; color: var(--text-muted); font-size: 14px;">Displays a gear icon next to all database items. Allows you to safely rewrite names, images, genres, and paths directly.</p>
                </div>
                <label style="position: relative; display: inline-block; width: 50px; height: 28px;">
                    <input type="checkbox" id="toggle-edit-mode" ${isEditMode ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                    <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isEditMode ? 'var(--text-main)' : '#333'}; transition: .4s; border-radius: 34px;">
                        <span style="position: absolute; content: ''; height: 20px; width: 20px; left: 4px; bottom: 4px; background-color: ${isEditMode ? '#000' : 'white'}; transition: .4s; border-radius: 50%; transform: ${isEditMode ? 'translateX(22px)' : 'none'};"></span>
                    </span>
                </label>
            </div>

            <div style="height: 1px; background: #282828; width: 100%;"></div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; font-size: 18px; color: var(--text-main);">Enable Automatic Download Mode</h3>
                    <p style="margin: 5px 0 0 0; color: var(--text-muted); font-size: 14px;">Displays the YouTube Auto Downloader tab in the backend Admin Tool.</p>
                </div>
                <label style="position: relative; display: inline-block; width: 50px; height: 28px;">
                    <input type="checkbox" id="toggle-auto-dl" ${isAutoDLMode ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                    <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isAutoDLMode ? 'var(--text-main)' : '#333'}; transition: .4s; border-radius: 34px;">
                        <span style="position: absolute; content: ''; height: 20px; width: 20px; left: 4px; bottom: 4px; background-color: ${isAutoDLMode ? '#000' : 'white'}; transition: .4s; border-radius: 50%; transform: ${isAutoDLMode ? 'translateX(22px)' : 'none'};"></span>
                    </span>
                </label>
            </div>

            <div style="height: 1px; background: #282828; width: 100%;"></div>
<div style="display: flex; flex-direction: column; gap: 12px;">
<div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; font-size: 18px; color: var(--text-main);">Application Theme</h3>
                    <p style="margin: 5px 0 0 0; color: var(--text-muted); font-size: 14px;">Select an accent color palette.</p>
                </div>
                <select id="theme-selector" class="ctrl-select" style="width: 150px;" onchange="changeAppTheme(this.value)">
                    <option value="default" ${localStorage.getItem('appTheme') === 'default' ? 'selected' : ''}>Classic Dark</option>
                    <option value="theme-neon" ${localStorage.getItem('appTheme') === 'theme-neon' ? 'selected' : ''}>Neon Green</option>
                    <option value="theme-midnight" ${localStorage.getItem('appTheme') === 'theme-midnight' ? 'selected' : ''}>Midnight Blue</option>
                    <option value="theme-rose" ${localStorage.getItem('appTheme') === 'theme-rose' ? 'selected' : ''}>Crimson Rose</option>
                </select>
            </div>
            
            </div>
            
            <div style="height: 1px; background: #282828; width: 100%;"></div>
            <div style="display: flex; flex-direction: column; gap: 12px; background: rgba(255,0,0,0.05); padding: 16px; border-radius: 8px; border: 1px solid rgba(255,0,0,0.2);">
                <h3 style="margin: 0; font-size: 18px; color: #ff0050;">Danger Zone: Delete Profile</h3>
                <p style="margin: 0; color: var(--text-muted); font-size: 14px;">This will permanently delete the active profile and all its playlists/data. Type your profile name <strong style="color: #fff;">${currentAccount ? currentAccount.name : 'None'}</strong> to confirm.</p>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <input type="text" id="delete-account-input" class="ctrl-input" placeholder="Type profile name..." ${!currentAccount ? 'disabled' : ''}>
                    <button class="btn-primary" style="background: #ff0050; color: white; border: none; white-space: nowrap;" onclick="deleteCurrentAccount()" ${!currentAccount ? 'disabled' : ''}>Delete Account</button>
                </div>
            </div>

        </div>
    `;
    
    document.getElementById('toggle-edit-mode').addEventListener('change', (e) => {
        isEditMode = e.target.checked;
        localStorage.setItem('isEditMode', isEditMode); 
        renderSettingsView(); 
    });

    document.getElementById('toggle-auto-dl').addEventListener('change', (e) => {
        isAutoDLMode = e.target.checked;
        localStorage.setItem('isAutoDLMode', isAutoDLMode); 
        renderSettingsView(); 
    });
}

window.deleteCurrentAccount = function() {
    if (!currentAccount) return;
    const inputName = document.getElementById('delete-account-input').value.trim();
    if (inputName !== currentAccount.name) {
        return alert("Name does not match. Deletion aborted.");
    }
    showCustomConfirm(`Are you entirely sure you want to delete profile "${currentAccount.name}"? This cannot be undone.`, () => {
        ipcRenderer.send('delete-account', currentAccount.id);
        localStorage.removeItem('activeAccount');
        window.location.reload();
    });
};

// THE DYNAMIC MODAL GENERATOR
let currentEditItem = null;
let currentEditType = '';

window.openEditModal = function(type, id) {
    currentEditType = type;
    if (type === 'artist') currentEditItem = artistsDatabase.find(a => a.artistID === id);
    if (type === 'album') currentEditItem = albumsDatabase.find(a => a.albumID === id);
    if (type === 'song') currentEditItem = songsDatabase.find(s => s.songID === id);
    if (!currentEditItem) return;

    let html = `
        <div id="edit-modal-overlay" style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); z-index:10000; display:flex; justify-content:center; align-items:center;">
            <div style="background:#181818; width: 600px; max-height: 85vh; border-radius: 8px; border: 1px solid #333; display: flex; flex-direction: column;">
                <div style="padding: 20px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center;">
                    <h2 style="margin: 0; font-size: 20px;">Edit ${type.toUpperCase()} Data</h2>
                </div>
                <div style="padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;" id="edit-form-container"></div>
                
                <div style="padding: 20px; border-top: 1px solid #333; display: flex; justify-content: space-between; align-items: center;">
                    <button class="btn-primary" style="background-color: #ff0050; color: white; border: none; padding: 10px 16px;" onclick="deleteEditItem()">
                        Delete ${type.toUpperCase()}
                    </button>
                    <div style="display: flex; gap: 12px;">
                        <button class="btn-secondary" onclick="closeEditModal()">Cancel</button>
                        <button class="btn-primary" onclick="saveEdit()">Save to File</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    let oldModal = document.getElementById('edit-modal-overlay');
    if (oldModal) oldModal.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    
    const container = document.getElementById('edit-form-container');
    
    for (const [key, value] of Object.entries(currentEditItem)) {
        if (['artistID', 'albumID', 'songID'].includes(key)) {
            container.innerHTML += `<label style="color:var(--text-muted); font-size:12px; margin-bottom: -10px;">${key} (Read Only)</label><input type="text" class="ctrl-input" value="${value}" disabled style="opacity:0.5;">`;
            continue;
        }
        if (key === 'trackcount' || key === 'duration') continue; 
        
        if (typeof value === 'object' && value !== null) {
            if (Array.isArray(value)) {
                container.innerHTML += `<label style="color:var(--text-muted); font-size:12px; margin-bottom: -10px;">${key} (Comma-separated)</label><input type="text" id="edit-input-${key}" class="ctrl-input" value="${value.join(', ')}">`;
            } else {
                for (const [pKey, pVal] of Object.entries(value)) {
                     container.innerHTML += `<label style="color:var(--text-muted); font-size:12px; margin-bottom: -10px;">paths.${pKey}</label><input type="text" id="edit-input-paths-${pKey}" class="ctrl-input" value="${pVal}">`;
                }
            }
        } else {
            container.innerHTML += `<label style="color:var(--text-muted); font-size:12px; margin-bottom: -10px;">${key}</label><input type="text" id="edit-input-${key}" class="ctrl-input" value="${value}">`;
        }
    }
}

window.deleteEditItem = function() {
    if (!currentEditItem) return;
    
    // Use the custom NewMusic confirm modal instead of the native Windows one
    showCustomConfirm(`⚠️ WARNING: Are you sure you want to permanently delete this ${currentEditType} AND ALL associated files and folders? This cannot be undone.`, () => {
        
        let filesToDelete = [];
        let foldersToDelete = [];
        let dArtists = false, dAlbums = false, dSongs = false;

        if (currentEditType === 'artist') {
            const artID = currentEditItem.artistID;
            const artistSlug = artID.replace('art_', '');
            foldersToDelete.push(`./assets/${artistSlug}`);
            for (let i = songsDatabase.length - 1; i >= 0; i--) { if (songsDatabase[i].artistID === artID) songsDatabase.splice(i, 1); }
            for (let i = albumsDatabase.length - 1; i >= 0; i--) { if (albumsDatabase[i].artistID === artID) albumsDatabase.splice(i, 1); }
            const index = artistsDatabase.findIndex(a => a.artistID === artID);
            if (index > -1) artistsDatabase.splice(index, 1);
            dArtists = dAlbums = dSongs = true;
        }
        else if (currentEditType === 'album') {
            const albID = currentEditItem.albumID;
            if (currentEditItem.paths && currentEditItem.paths.cover) filesToDelete.push(currentEditItem.paths.cover);
            for (let i = songsDatabase.length - 1; i >= 0; i--) {
                if (songsDatabase[i].albumID === albID) {
                    if (songsDatabase[i].paths) {
                        if (songsDatabase[i].paths.audio) filesToDelete.push(songsDatabase[i].paths.audio);
                        if (songsDatabase[i].paths.lyrics) filesToDelete.push(songsDatabase[i].paths.lyrics);
                    }
                    songsDatabase.splice(i, 1);
                }
            }
            const index = albumsDatabase.findIndex(a => a.albumID === albID);
            if (index > -1) albumsDatabase.splice(index, 1);
            dAlbums = dSongs = true;
        }
        else if (currentEditType === 'song') {
            const sID = currentEditItem.songID;
            const albID = currentEditItem.albumID;
            if (currentEditItem.paths) {
                if (currentEditItem.paths.audio) filesToDelete.push(currentEditItem.paths.audio);
                if (currentEditItem.paths.lyrics) filesToDelete.push(currentEditItem.paths.lyrics);
            }
            const index = songsDatabase.findIndex(s => s.songID === sID);
            if (index > -1) songsDatabase.splice(index, 1);
            dSongs = true;

            const remainingSongs = songsDatabase.filter(s => s.albumID === albID);
            if (remainingSongs.length === 0) {
                const albIndex = albumsDatabase.findIndex(a => a.albumID === albID);
                if (albIndex > -1) {
                    const alb = albumsDatabase[albIndex];
                    if (alb.paths && alb.paths.cover) filesToDelete.push(alb.paths.cover);
                    albumsDatabase.splice(albIndex, 1);
                    dAlbums = true;
                }
            }
        }

        const payload = { filesToDelete, foldersToDelete, databases: {} };
        if (dArtists) payload.databases['database_artists.js'] = `const artistsDatabase = [\n` + artistsDatabase.map(obj => JSON.stringify(obj, null, 2)).join(',\n') + `\n];`;
        if (dAlbums) {
            const cleanAlbums = albumsDatabase.map(obj => { let copy = {...obj}; delete copy.trackcount; delete copy.duration; return JSON.stringify(copy, null, 2); });
            payload.databases['database_albums.js'] = `const albumsDatabase = [\n` + cleanAlbums.join(',\n') + `\n];`;
        }
        if (dSongs) payload.databases['database_songs.js'] = `const songsDatabase = [\n` + songsDatabase.map(obj => JSON.stringify(obj, null, 2)).join(',\n') + `\n];`;

        ipcRenderer.send('execute-nuclear-delete', payload);
        closeEditModal();
        
        if (window.location.hash.includes(currentEditItem.artistID || currentEditItem.albumID)) window.location.hash = ''; 
        else handleRouting(); 
    });
}

window.closeEditModal = function() {
    const modal = document.getElementById('edit-modal-overlay');
    if (modal) modal.remove();
    currentEditItem = null;
}

window.saveEdit = function() {
    if (!currentEditItem) return;
    for (const [key, value] of Object.entries(currentEditItem)) {
        if (['artistID', 'albumID', 'songID'].includes(key)) continue;
        if (typeof value === 'object' && value !== null) {
            if (Array.isArray(value)) {
                const val = document.getElementById(`edit-input-${key}`).value;
                currentEditItem[key] = val ? val.split(',').map(s => s.trim()).filter(s => s !== '') : [];
            } else {
                for (const [pKey, pVal] of Object.entries(value)) { currentEditItem[key][pKey] = document.getElementById(`edit-input-paths-${pKey}`).value; }
            }
        } else {
            let inputVal = document.getElementById(`edit-input-${key}`).value;
            if (typeof value === 'number') currentEditItem[key] = Number(inputVal) || 0;
            else currentEditItem[key] = inputVal;
        }
    }
    closeEditModal();
    
    if (currentEditType === 'artist') {
        const dbString = `const artistsDatabase = [\n` + artistsDatabase.map(obj => JSON.stringify(obj, null, 2)).join(',\n') + `\n];`;
        ipcRenderer.send('save-database', { file: 'database_artists.js', data: dbString });
    } else if (currentEditType === 'album') {
        const cleanAlbums = albumsDatabase.map(obj => { let copy = {...obj}; delete copy.trackcount; delete copy.duration; return JSON.stringify(copy, null, 2); });
        const dbString = `const albumsDatabase = [\n` + cleanAlbums.join(',\n') + `\n];`;
        ipcRenderer.send('save-database', { file: 'database_albums.js', data: dbString });
    } else if (currentEditType === 'song') {
        const dbString = `const songsDatabase = [\n` + songsDatabase.map(obj => JSON.stringify(obj, null, 2)).join(',\n') + `\n];`;
        ipcRenderer.send('save-database', { file: 'database_songs.js', data: dbString });
    }
    handleRouting(); 
}

function renderHomeView() { 
    const hour = new Date().getHours();
    let greeting = "Good Evening";
    if (hour < 12) greeting = "Good Morning";
    else if (hour < 18) greeting = "Good Afternoon";

    const totalArtists = artistsDatabase.length;
    const totalAlbums = albumsDatabase.length;
    const totalSongs = songsDatabase.length;

    const recentAlbums = [...albumsDatabase]
        .filter(a => a.releaseDate)
        .sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate))
        .slice(0, 6);

    const randomAlbums = shuffleArray([...albumsDatabase]).slice(0, 6);

    const buildMiniGrid = (albumsArray) => {
        return albumsArray.map(album => {
            let artistName = getArtistName(album.artistID);
            return `
                <div class="album-card" onclick="window.location.hash = 'album/${album.albumID}'">
                    ${isEditMode ? `<button class="edit-btn" onclick="event.stopPropagation(); openEditModal('album', '${album.albumID}')"><svg class="icon" style="width:16px;height:16px;"><use href="#icon-gear"></use></svg></button>` : ''}
                    <div class="album-img-wrapper">
                        <img src="${album.paths.cover}" alt="${album.title}" onerror="this.style.display='none'">
                    </div>
                    <div class="title">${album.title}</div>
                    <div class="artist">${artistName}</div>
                </div>
            `;
        }).join('');
    };

    contentArea.innerHTML = `
        <div style="margin-bottom: 50px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
                <div id="live-clock" style="font-family: monospace; color: var(--text-muted); font-size: 16px; margin-bottom: 4px; letter-spacing: 2px;"></div>
                
                <h1 class="header-title" style="font-size: 48px; margin-bottom: 8px; letter-spacing: -1px;">${greeting}.</h1>
                <p style="color: var(--text-muted); font-size: 14px;">
                    Your library currently holds <strong>${totalSongs}</strong> songs across <strong>${totalAlbums}</strong> releases by <strong>${totalArtists}</strong> artists.
                </p>
            </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; border-bottom: 1px solid #282828; padding-bottom: 12px;">
            <h2 class="artist-section-title" style="margin: 0; border: none; padding: 0; font-size: 22px;">New Releases</h2>
            <span style="font-size: 12px; color: var(--text-muted); cursor: pointer;" onclick="window.location.hash = 'albums'">View All</span>
        </div>
        <div class="grid-container" style="margin-bottom: 50px;">
            ${buildMiniGrid(recentAlbums)}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; border-bottom: 1px solid #282828; padding-bottom: 12px;">
            <h2 class="artist-section-title" style="margin: 0; border: none; padding: 0; font-size: 22px;">Quick Picks</h2>
            <span style="font-size: 12px; color: var(--text-muted); cursor: pointer;" onclick="renderHomeView()">↻ Refresh</span>
        </div>
        <div class="grid-container" style="margin-bottom: 50px;">
            ${buildMiniGrid(randomAlbums)}
        </div>
    `; 

    const clockElement = document.getElementById('live-clock');
    const updateClock = () => {
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (clockElement) clockElement.innerText = timeString;
    };
    updateClock();
    homeClockInterval = setInterval(updateClock, 1000);
}

function renderSongsView(isFavorites = false) {
    currentSongViewIsFavorites = isFavorites;
    let allArtists = new Set(), allYears = new Set(), allGenres = new Set(), allTags = new Set();
    
    let sourceSongs = songsDatabase;
    if (isFavorites) {
        if (!currentAccount || !currentAccount.favorites) sourceSongs = [];
        else sourceSongs = songsDatabase.filter(s => currentAccount.favorites.includes(s.songID));
    }

    sourceSongs.forEach(song => {
        const album = albumsDatabase.find(a => a.albumID === song.albumID);
        allArtists.add(getArtistName(song.artistID));
        if (album && album.releaseDate) allYears.add(album.releaseDate.substring(0,4));
        if (song.genre) song.genre.forEach(g => allGenres.add(g));
        if (song.tags) song.tags.forEach(t => allTags.add(t));
    });

    const titleText = isFavorites ? "Favorites" : "All Songs";

    contentArea.innerHTML = `
        <h1 class="header-title">${titleText}</h1>
        <div class="controls-toolbar">
            <input type="text" id="ctrl-song-search" class="ctrl-input ctrl-search" placeholder="Search title or artist...">
            <select id="ctrl-song-sort" class="ctrl-select">
                <option value="title">Sort: Title</option>
                <option value="artist">Sort: Artist</option>
                <option value="duration">Sort: Duration</option>
                <option value="year">Sort: Release Year</option>
            </select>
            <button id="ctrl-song-sort-dir" class="sort-dir-btn">↓ ASC</button>
            <button id="ctrl-song-shuffle" class="sort-dir-btn" style="color: var(--text-main); border: 1px solid #444;">Randomize</button>
            
            ${buildMultiSelect('ms-song-artist', 'Artists', allArtists)}
            ${buildMultiSelect('ms-song-genre', 'Genres', allGenres)}
            ${buildMultiSelect('ms-song-tag', 'Tags', allTags)}
            
            ${buildYearRangeSlider('song', minAlbumYear, maxAlbumYear)}
        </div>
        
        <div style="display: flex; gap: 40px; align-items: flex-start; padding-bottom: 0px;">
            <div style="flex: 1; min-width: 0;">
                <div class="tracklist-header track-row" style="padding-left: 0; padding-right: 0;">
                    <div class="th-num">#</div>
                    <div class="th-title">Title & Artist</div>
                    <div class="th-dur">⏱</div>
                </div>
                <div id="songs-list-container"></div>
            </div>
            
            <div class="lyrics-col" style="width: 480px; flex-shrink: 0; position: sticky; top: 20px;">
                <div class="lyrics-display" id="lyrics-panel">
                    <p>Select a track to view lyrics.</p>
                </div>
            </div>
        </div>
    `;
    
    attachSongControlListeners();
    updateSongList();
    updateLyricsPanel(); 
}

function attachSongControlListeners() {
    document.querySelectorAll('.multi-select .anchor').forEach(anchor => { anchor.addEventListener('click', (e) => { document.querySelectorAll('.multi-select').forEach(ms => { if (ms !== e.target.closest('.multi-select')) ms.classList.remove('visible'); }); e.target.closest('.multi-select').classList.toggle('visible'); }); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.multi-select')) { document.querySelectorAll('.multi-select').forEach(ms => ms.classList.remove('visible')); } });
    
    document.getElementById('ctrl-song-search').addEventListener('input', (e) => { songState.search = e.target.value.toLowerCase(); updateSongList(); });
    document.getElementById('ctrl-song-sort').addEventListener('change', (e) => { songState.sortBy = e.target.value; songState.sortDir = 'asc'; document.getElementById('ctrl-song-sort-dir').innerText = '↓ ASC'; updateSongList(); });
    
    document.getElementById('ctrl-song-sort-dir').addEventListener('click', (e) => { 
        songState.sortDir = songState.sortDir === 'asc' ? 'desc' : 'asc'; 
        e.target.innerText = songState.sortDir === 'asc' ? '↓ ASC' : '↑ DESC'; 
        updateSongList(); 
    });
    
    document.getElementById('ctrl-song-shuffle').addEventListener('click', () => { 
        songState.sortDir = 'random'; 
        document.getElementById('ctrl-song-sort-dir').innerText = '↕ RND'; 
        updateSongList(); 
    });

    const getChecked = (id) => Array.from(document.querySelectorAll(`#${id} input:checked`)).map(cb => cb.value);
    document.querySelectorAll('.multi-select input[type="checkbox"]').forEach(cb => { 
        cb.addEventListener('change', () => { 
            songState.filters.artist = getChecked('ms-song-artist'); 
            songState.filters.genre = getChecked('ms-song-genre'); 
            songState.filters.tag = getChecked('ms-song-tag'); 
            updateSongList(); 
        }); 
    });
    attachDualSliderLogic('song', songState, updateSongList);
}

function updateSongList() {
    const container = document.getElementById('songs-list-container');
    if(!container) return;

    let results = songsDatabase.filter(song => {
        if (currentSongViewIsFavorites) {
            if (!currentAccount || !currentAccount.favorites || !currentAccount.favorites.includes(song.songID)) return false;
        }

        const album = albumsDatabase.find(a => a.albumID === song.albumID);
        const artistName = getArtistName(song.artistID);
        const titleMatch = song.title.toLowerCase().includes(songState.search);
        const artistMatch = artistName.toLowerCase().includes(songState.search);

        if (songState.search && !titleMatch && !artistMatch) return false;

        let f = songState.filters;
        let year = album && album.releaseDate ? parseInt(album.releaseDate.substring(0,4)) : 0;

        if (f.artist.length > 0 && !f.artist.includes(artistName)) return false;
        if (year !== 0 && (year < songState.yearRange.min || year > songState.yearRange.max)) return false;
        if (f.genre.length > 0 && (!song.genre || !song.genre.some(g => f.genre.includes(g)))) return false;
        if (f.tag.length > 0 && (!song.tags || !song.tags.some(t => f.tag.includes(t)))) return false;

        return true;
    });

    if (songState.sortDir === 'random') {
        results = shuffleArray(results);
    } else {
        results.sort((a, b) => {
            const albumA = albumsDatabase.find(x => x.albumID === a.albumID);
            const albumB = albumsDatabase.find(x => x.albumID === b.albumID);
            let valA, valB;

            if (songState.sortBy === 'title') { valA = a.title.toLowerCase(); valB = b.title.toLowerCase(); }
            else if (songState.sortBy === 'artist') { valA = getArtistName(a.artistID).toLowerCase(); valB = getArtistName(b.artistID).toLowerCase(); }
            else if (songState.sortBy === 'duration') { valA = a.duration; valB = b.duration; }
            else if (songState.sortBy === 'year') { valA = albumA && albumA.releaseDate ? parseInt(albumA.releaseDate.substring(0,4)) : 0; valB = albumB && albumB.releaseDate ? parseInt(albumB.releaseDate.substring(0,4)) : 0; }

            if (valA < valB) return songState.sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return songState.sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    if (results.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); padding: 20px;">No songs match those filters.</p>`;
        return;
    }

    let html = '';
    results.forEach((song, index) => {
        let isActive = (currentSong && currentSong.songID === song.songID) ? 'active-track' : '';
        const artistName = getArtistName(song.artistID);
        const coverImg = albumsDatabase.find(a => a.albumID === song.albumID)?.paths.cover || '';
        
        html += `
            <div class="track-item track-row ${isActive}" data-song-id="${song.songID}" onclick="playGlobalSongContext(${index})" style="padding-left: 16px; padding-right: 16px;">
                <div class="t-num" style="display: flex; align-items: center; justify-content: center;">
                    <img src="${coverImg}" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover; background: #282828;">
                </div>
                <div class="t-title" style="display: flex; flex-direction: column; justify-content: center; overflow: hidden; white-space: nowrap;">
                    <div style="font-weight: 500; font-size: 14px; text-overflow: ellipsis; overflow: hidden;">${song.title}</div>
                    <div style="color: var(--text-muted); font-size: 12px; margin-top: 4px; text-overflow: ellipsis; overflow: hidden;">${artistName}</div>
                </div>
                <div class="t-dur" style="display:flex; align-items:center; justify-content:flex-end; gap: 8px;">
                    <span style="min-width: 35px; text-align: right;">${formatTime(song.duration)}</span>
                    ${isEditMode ? `<div class="edit-inline" onclick="event.stopPropagation(); openEditModal('song', '${song.songID}')"><svg class="icon" style="width:16px;height:16px;"><use href="#icon-gear"></use></svg></div>` : ''}
                    <div class="song-menu-btn" onclick="event.stopPropagation(); openContextMenu(event, '${song.songID}')">⋮</div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
    window.currentGlobalSongsList = results; 
}

function renderArtistsView() {
    let allGenres = new Set(), allTags = new Set(), allCountries = new Set(), allStartYears = new Set(), allFirstListen = new Set();
    artistsDatabase.forEach(a => { if (a.genre) a.genre.forEach(g => allGenres.add(g)); if (a.tags) a.tags.forEach(t => allTags.add(t)); if (a.country) allCountries.add(a.country); if (a.startYear) allStartYears.add(a.startYear); if (a.firstlistenYear) allFirstListen.add(a.firstlistenYear); });
    
    contentArea.innerHTML = `
        <h1 class="header-title">Artists</h1>
        <div class="controls-toolbar">
            <input type="text" id="ctrl-search" class="ctrl-input ctrl-search" placeholder="Search artists...">
            <select id="ctrl-sort" class="ctrl-select">
                <option value="firstlistenYear" ${artistState.sortBy === 'firstlistenYear' ? 'selected' : ''}>Sort: First Listened</option>
                <option value="artist" ${artistState.sortBy === 'artist' ? 'selected' : ''}>Sort: Name</option>
                <option value="startYear" ${artistState.sortBy === 'startYear' ? 'selected' : ''}>Sort: Start Year</option>
            </select>
            <button id="ctrl-sort-dir" class="sort-dir-btn">${artistState.sortDir === 'asc' ? '↓ ASC' : '↑ DESC'}</button>
            
            ${buildMultiSelect('ms-startYear', 'Start Year', allStartYears)}
            ${buildMultiSelect('ms-firstlisten', 'First Listened', allFirstListen)}
            ${buildMultiSelect('ms-genre', 'Genres', allGenres)}
            ${buildMultiSelect('ms-tag', 'Tags', allTags)} 
            ${buildMultiSelect('ms-country', 'Country', allCountries)}
            
            ${buildYearRangeSlider('artist', minArtistYear, maxArtistYear)}
        </div>
        <div class="grid-container" id="artist-grid"></div>
    `;
    attachArtistControlListeners(); updateArtistGrid();
}

function attachArtistControlListeners() {
    document.querySelectorAll('.multi-select .anchor').forEach(anchor => { anchor.addEventListener('click', (e) => { document.querySelectorAll('.multi-select').forEach(ms => { if (ms !== e.target.closest('.multi-select')) ms.classList.remove('visible'); }); e.target.closest('.multi-select').classList.toggle('visible'); }); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.multi-select')) { document.querySelectorAll('.multi-select').forEach(ms => ms.classList.remove('visible')); } });
    document.getElementById('ctrl-search').addEventListener('input', (e) => { artistState.search = e.target.value.toLowerCase(); updateArtistGrid(); });
    document.getElementById('ctrl-sort').addEventListener('change', (e) => { artistState.sortBy = e.target.value; updateArtistGrid(); });
    document.getElementById('ctrl-sort-dir').addEventListener('click', (e) => { artistState.sortDir = artistState.sortDir === 'asc' ? 'desc' : 'asc'; e.target.innerText = artistState.sortDir === 'asc' ? '↓ ASC' : '↑ DESC'; updateArtistGrid(); });
    const getChecked = (id) => Array.from(document.querySelectorAll(`#${id} input:checked`)).map(cb => cb.value);
    document.querySelectorAll('.multi-select input[type="checkbox"]').forEach(cb => { cb.addEventListener('change', () => { artistState.filters.genre = getChecked('ms-genre'); artistState.filters.tag = getChecked('ms-tag'); artistState.filters.country = getChecked('ms-country'); artistState.filters.startYear = getChecked('ms-startYear'); artistState.filters.firstlistenYear = getChecked('ms-firstlisten'); updateArtistGrid(); }); });
    attachDualSliderLogic('artist', artistState, updateArtistGrid);
}

function updateArtistGrid() {
    const grid = document.getElementById('artist-grid'); if (!grid) return; grid.innerHTML = ''; 
    let results = artistsDatabase.filter(artist => {
        if (artistState.search && !artist.artist.toLowerCase().includes(artistState.search)) return false;
        let sYear = parseInt(artist.startYear); 
        if (!isNaN(sYear) && (sYear < artistState.yearRange.min || sYear > artistState.yearRange.max)) return false; 
        let f = artistState.filters; 
        if (f.country.length > 0 && !f.country.includes(artist.country)) return false; 
        if (f.startYear.length > 0 && !f.startYear.includes(artist.startYear)) return false; 
        if (f.firstlistenYear.length > 0 && !f.firstlistenYear.includes(artist.firstlistenYear)) return false; 
        if (f.genre.length > 0 && (!artist.genre || !artist.genre.some(g => f.genre.includes(g)))) return false; 
        if (f.tag.length > 0 && (!artist.tags || !artist.tags.some(t => f.tag.includes(t)))) return false; 
        return true; 
    });
    results.sort((a, b) => { let valA = a[artistState.sortBy], valB = b[artistState.sortBy]; if (artistState.sortBy === 'startYear' || artistState.sortBy === 'firstlistenYear') { valA = parseInt(valA) || 0; valB = parseInt(valB) || 0; } else { valA = (valA || '').toLowerCase(); valB = (valB || '').toLowerCase(); } if (valA < valB) return artistState.sortDir === 'asc' ? -1 : 1; if (valA > valB) return artistState.sortDir === 'asc' ? 1 : -1; return 0; });
    if (results.length === 0) { grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1 / -1;">No artists match those filters.</p>`; return; }
    results.forEach(artist => { const card = document.createElement('div'); card.className = 'artist-card'; card.innerHTML = `${isEditMode ? `<button class="edit-btn" onclick="event.stopPropagation(); openEditModal('artist', '${artist.artistID}')"><svg class="icon" style="width:16px;height:16px;"><use href="#icon-gear"></use></svg></button>` : ''}
<div class="artist-img-wrapper"><img src="${artist.paths.cover}" alt="${artist.artist}" onerror="this.style.display='none'"></div><div class="name">${artist.artist}</div>`; card.addEventListener('click', () => { window.location.hash = `artist/${artist.artistID}`; }); grid.appendChild(card); });
}

function renderAlbumsView() {
    let allArtists = new Set(), allGenres = new Set(), allTags = new Set();
    albumsDatabase.forEach(a => { if (a.artistID) { let readableName = getArtistName(a.artistID); if (readableName !== "Unknown Artist") allArtists.add(readableName); } if (a.genre) a.genre.forEach(g => allGenres.add(g)); if (a.tags) a.tags.forEach(t => allTags.add(t)); });
    
    contentArea.innerHTML = `
        <h1 class="header-title">Albums</h1>
        <div class="controls-toolbar">
            <input type="text" id="ctrl-album-search-title" class="ctrl-input ctrl-search" placeholder="Search albums...">
            <input type="text" id="ctrl-album-search-artist" class="ctrl-input ctrl-search" placeholder="Search artists...">
            <select id="ctrl-album-sort" class="ctrl-select">
                <option value="firstlistenDate" ${albumState.sortBy === 'firstlistenDate' ? 'selected' : ''}>Sort: First Listened</option>
                <option value="releaseDate" ${albumState.sortBy === 'releaseDate' ? 'selected' : ''}>Sort: Release Date</option>
                <option value="title" ${albumState.sortBy === 'title' ? 'selected' : ''}>Sort: A-Z (Title)</option>
                <option value="artist" ${albumState.sortBy === 'artist' ? 'selected' : ''}>Sort: A-Z (Artist)</option>
                <option value="duration" ${albumState.sortBy === 'duration' ? 'selected' : ''}>Sort: Duration</option>
                <option value="trackcount" ${albumState.sortBy === 'trackcount' ? 'selected' : ''}>Sort: Track Count</option>
            </select>
            <button id="ctrl-album-sort-dir" class="sort-dir-btn">↑ DESC</button>
            <button id="ctrl-album-type" class="sort-dir-btn">Show: Albums</button>
            ${buildMultiSelect('ms-album-artist', 'Artists', allArtists)}
            ${buildMultiSelect('ms-album-genre', 'Genres', allGenres)}
            ${buildMultiSelect('ms-album-tag', 'Tags', allTags)}
            ${buildYearRangeSlider('album', minAlbumYear, maxAlbumYear)}
        </div>
        <div class="grid-container" id="album-grid"></div>
    `;
    attachAlbumControlListeners(); updateAlbumGrid();
}

function attachAlbumControlListeners() {
    document.querySelectorAll('.multi-select .anchor').forEach(anchor => { anchor.addEventListener('click', (e) => { document.querySelectorAll('.multi-select').forEach(ms => { if (ms !== e.target.closest('.multi-select')) ms.classList.remove('visible'); }); e.target.closest('.multi-select').classList.toggle('visible'); }); });
    document.getElementById('ctrl-album-search-title').addEventListener('input', (e) => { albumState.searchAlbum = e.target.value.toLowerCase(); updateAlbumGrid(); }); 
    document.getElementById('ctrl-album-search-artist').addEventListener('input', (e) => { albumState.searchArtist = e.target.value.toLowerCase(); updateAlbumGrid(); }); 
    document.getElementById('ctrl-album-sort').addEventListener('change', (e) => { albumState.sortBy = e.target.value; updateAlbumGrid(); });
    document.getElementById('ctrl-album-sort-dir').addEventListener('click', (e) => { albumState.sortDir = albumState.sortDir === 'asc' ? 'desc' : 'asc'; e.target.innerText = albumState.sortDir === 'asc' ? '↓ ASC' : '↑ DESC'; updateAlbumGrid(); });
    
    const typeBtn = document.getElementById('ctrl-album-type');
    const typeLabels = ['Show: Albums', 'Show: EPs & Singles', 'Show: Compilations', 'Show: All Releases'];
    typeBtn.innerText = typeLabels[albumState.releaseType];
    
    typeBtn.addEventListener('click', (e) => {
        albumState.releaseType = (albumState.releaseType + 1) % 4; 
        e.target.innerText = typeLabels[albumState.releaseType];
        if(albumState.releaseType !== 0) { e.target.style.borderColor = "var(--text-main)"; e.target.style.color = "var(--text-main)"; } 
        else { e.target.style.borderColor = "#333"; e.target.style.color = "var(--text-main)"; }
        updateAlbumGrid();
    });

    const getChecked = (id) => Array.from(document.querySelectorAll(`#${id} input:checked`)).map(cb => cb.value);
    document.querySelectorAll('.multi-select input[type="checkbox"]').forEach(cb => { cb.addEventListener('change', () => { albumState.filters.artist = getChecked('ms-album-artist'); albumState.filters.genre = getChecked('ms-album-genre'); albumState.filters.tag = getChecked('ms-album-tag'); updateAlbumGrid(); }); });
    attachDualSliderLogic('album', albumState, updateAlbumGrid);
}

function updateAlbumGrid() {
    const grid = document.getElementById('album-grid'); if (!grid) return; grid.innerHTML = ''; 
    let results = albumsDatabase.filter(album => {
        let artistName = getArtistName(album.artistID);
        if (albumState.searchAlbum && !album.title.toLowerCase().includes(albumState.searchAlbum)) return false; 
        if (albumState.searchArtist && !artistName.toLowerCase().includes(albumState.searchArtist)) return false;
        
        let albumYear = album.releaseDate ? parseInt(album.releaseDate.substring(0, 4)) : 0; 
        if (albumYear !== 0 && (albumYear < albumState.yearRange.min || albumYear > albumState.yearRange.max)) return false; 
        
        let f = albumState.filters; 
        let strYear = album.releaseDate ? album.releaseDate.substring(0, 4) : "";
        if (f.artist.length > 0 && !f.artist.includes(artistName)) return false; 
        if (f.year.length > 0 && !f.year.includes(strYear)) return false; 
        if (f.genre.length > 0 && (!album.genre || !album.genre.some(g => f.genre.includes(g)))) return false; 
        if (f.tag.length > 0 && (!album.tags || !album.tags.some(t => f.tag.includes(t)))) return false; 
        
        let type = album.albumType ? album.albumType.toLowerCase() : 'album';
        if (albumState.releaseType === 0 && !['album', 'lp'].includes(type)) return false;
        if (albumState.releaseType === 1 && !['ep', 'single'].includes(type)) return false;
        if (albumState.releaseType === 2 && type !== 'compilation') return false;
        return true; 
    });
    
    results.sort((a, b) => { let valA, valB; if (albumState.sortBy === 'artist') { valA = getArtistName(a.artistID).toLowerCase(); valB = getArtistName(b.artistID).toLowerCase(); } else if (albumState.sortBy === 'duration' || albumState.sortBy === 'trackcount') { valA = parseInt(a[albumState.sortBy]) || 0; valB = parseInt(b[albumState.sortBy]) || 0; } else { valA = (a[albumState.sortBy] || '').toLowerCase(); valB = (b[albumState.sortBy] || '').toLowerCase(); } if (valA < valB) return albumState.sortDir === 'asc' ? -1 : 1; if (valA > valB) return albumState.sortDir === 'asc' ? 1 : -1; return 0; });
    if (results.length === 0) { grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1 / -1;">No albums match those filters.</p>`; return; }
    
    results.forEach(album => {
        let artistName = getArtistName(album.artistID);
        const card = document.createElement('div'); card.className = 'album-card';
        card.innerHTML = `${isEditMode ? `<button class="edit-btn" onclick="event.stopPropagation(); openEditModal('album', '${album.albumID}')"><svg class="icon" style="width:16px;height:16px;"><use href="#icon-gear"></use></svg></button>` : ''}
<div class="album-img-wrapper"><img src="${album.paths.cover}" alt="${album.title}" onerror="this.style.display='none'"></div><div class="title">${album.title}</div><div class="artist">${artistName} • ${album.releaseDate ? album.releaseDate.substring(0, 4) : ''}</div>`;
        card.addEventListener('click', () => { window.location.hash = `album/${album.albumID}`; });
        grid.appendChild(card);
    });
}

function sortAlbumTracks(albumID, column) {
    if (currentAlbumSort.by === column) { currentAlbumSort.dir = currentAlbumSort.dir === 'asc' ? 'desc' : 'asc'; } else { currentAlbumSort.by = column; currentAlbumSort.dir = 'asc'; }
    renderAlbumDetailView(albumID); 
}

function renderAlbumDetailView(albumID) {
    const album = albumsDatabase.find(a => a.albumID === albumID);
    if (!album) return;
    const artistName = getArtistName(album.artistID);
    let albumSongs = songsDatabase.filter(s => s.albumID === albumID);
    
    albumSongs.sort((a, b) => {
        let valA = a[currentAlbumSort.by]; let valB = b[currentAlbumSort.by];
        if (typeof valA === 'string') valA = valA.toLowerCase(); if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return currentAlbumSort.dir === 'asc' ? -1 : 1; if (valA > valB) return currentAlbumSort.dir === 'asc' ? 1 : -1; return 0;
    });

    const getArrow = (col) => currentAlbumSort.by === col ? (currentAlbumSort.dir === 'asc' ? ' ↑' : ' ↓') : '';

    let tracklistHtml = `
        <div class="tracklist-header track-row">
            <div class="th-num" onclick="sortAlbumTracks('${albumID}', 'track')">#${getArrow('track')}</div>
            <div class="th-title" onclick="sortAlbumTracks('${albumID}', 'title')">Title${getArrow('title')}</div>
            <div class="th-dur" onclick="sortAlbumTracks('${albumID}', 'duration')">⏱${getArrow('duration')}</div>
        </div>
    `;

    albumSongs.forEach((song, index) => {
        let isActive = (currentSong && currentSong.songID === song.songID) ? 'active-track' : '';
        tracklistHtml += `
            <div class="track-item track-row ${isActive}" data-song-id="${song.songID}" onclick="playQueueFrom('${albumID}', ${index})">
                <div class="t-num">${song.track}</div>
                <div class="t-title">${song.title}</div>
                <div class="t-dur" style="display:flex; align-items:center; justify-content:flex-end; gap: 8px;">
                    <span style="min-width: 35px; text-align: right;">${formatTime(song.duration)}</span>
                    ${isEditMode ? `<div class="edit-inline" onclick="event.stopPropagation(); openEditModal('song', '${song.songID}')"><svg class="icon" style="width:16px;height:16px;"><use href="#icon-gear"></use></svg></div>` : ''}
                    <div class="song-menu-btn" onclick="event.stopPropagation(); openContextMenu(event, '${song.songID}')">⋮</div>
                </div>
            </div>
        `;
    });

    if (albumSongs.length === 0) tracklistHtml = '<p style="color: var(--text-muted); padding: 20px;">No tracks found for this album yet.</p>';

    const releaseYear = album.releaseDate ? album.releaseDate.substring(0, 4) : 'Unknown Year';
    const totalMins = album.duration ? Math.floor(album.duration / 60) : 0;
    const totalTracks = album.trackcount || albumSongs.length;

    contentArea.innerHTML = `
        <div class="album-detail-container" style="display: flex; gap: 40px; align-items: flex-start;">
            <div class="album-info-col" style="width: 320px; flex-shrink: 0;">
                <img src="${album.paths.cover}" alt="${album.title}" class="big-cover" style="cursor: pointer;" onclick="openImageModal('${album.paths.cover}')" onerror="this.style.display='none'">
                <div>
                    <div class="album-title">${album.title}</div>
                    <div class="album-artist" onclick="window.location.hash = 'artist/${album.artistID}'">${artistName}</div>
                    <div class="album-meta">${releaseYear} • ${totalTracks} songs, ${totalMins} min</div>
                </div>
                <div class="action-buttons">
                    <button class="btn-primary" onclick="playAlbumContext('${albumID}', false)">
                        <svg class="icon icon-filled"><use href="#icon-play"></use></svg> Play
                    </button>
                    <button class="btn-secondary" onclick="playAlbumContext('${albumID}', true)">
                        <svg class="icon"><use href="#icon-shuffle"></use></svg> Shuffle
                    </button>
                </div>
            </div>
            <div class="tracklist-col" style="flex: 1; min-width: 0;">
                ${tracklistHtml}
            </div>
            <div class="lyrics-col" style="width: 420px; flex-shrink: 0;">
                <div class="lyrics-display" id="lyrics-panel">
                    <p>Select a track to view lyrics.</p>
                </div>
            </div>
        </div>
    `;

    updateLyricsPanel();
}

function renderArtistDetailView(artistID) {
    const artist = artistsDatabase.find(a => a.artistID === artistID);
    if (!artist) return;

    let artistAlbums = albumsDatabase.filter(a => a.artistID === artistID);
    let artistSongs = songsDatabase.filter(s => s.artistID === artistID);

    let mainAlbums = artistAlbums.filter(a => !a.albumType || ['album', 'lp'].includes(a.albumType.toLowerCase()));
    let epSingles = artistAlbums.filter(a => a.albumType && ['ep', 'single'].includes(a.albumType.toLowerCase()));
    let compilations = artistAlbums.filter(a => a.albumType && ['compilation'].includes(a.albumType.toLowerCase()));

    let genresHtml = '';
    let tagsHtml = '';
    
    if (artist.genre && artist.genre.length > 0) {
        genresHtml += `<div style="display: flex; gap: 8px; align-items: center;"><span style="color: var(--text-muted); font-size: 12px; text-transform: uppercase; margin-right: 4px;">Genres:</span>`;
        artist.genre.forEach(g => genresHtml += `<span class="tag-pill">${g}</span>`);
        genresHtml += `</div>`;
    }
    
    if (artist.tags && artist.tags.length > 0) {
        tagsHtml += `<div style="display: flex; gap: 8px; align-items: center; margin-top: 10px;"><span style="color: var(--text-muted); font-size: 12px; text-transform: uppercase; margin-right: 4px;">Tags:</span>`;
        artist.tags.forEach(t => tagsHtml += `<span class="tag-pill" style="background: transparent; border: 1px solid #444;">${t}</span>`);
        tagsHtml += `</div>`;
    }

    const buildAlbumGrid = (albumsArr) => {
        if (albumsArr.length === 0) return '<p style="color: var(--text-muted);">No releases found.</p>';
        let html = '<div class="grid-container">';
        albumsArr.forEach(album => {
            html += `
                <div class="album-card" onclick="window.location.hash = 'album/${album.albumID}'">
                    <div class="album-img-wrapper"><img src="${album.paths.cover}" alt="${album.title}" onerror="this.style.display='none'"></div>
                    <div class="title">${album.title}</div>
                    <div class="artist">${album.releaseDate ? album.releaseDate.substring(0, 4) : ''}</div>
                </div>
            `;
        });
        html += '</div>';
        return html;
    };

    let songsHtml = `
        <div class="tracklist-header compact-track-row" style="padding-left: 0; padding-right: 0;">
            <div class="t-left">
                <div class="th-num" style="width: 20px;">#</div>
                <div class="th-title">Title</div>
            </div>
            <div class="th-dur" style="text-align: right;">⏱</div>
        </div>
    `;
    artistSongs.forEach((song, index) => {
        let isActive = (currentSong && currentSong.songID === song.songID) ? 'active-track' : '';
        songsHtml += `
            <div class="track-item compact-track-row ${isActive}" data-song-id="${song.songID}" onclick="playQueueFromArtist('${artistID}', ${index})">
                <div class="t-left">
                    <div class="t-num">${index + 1}</div>
                    <div class="t-title">${song.title}</div>
                </div>
                <div class="t-dur" style="display:flex; align-items:center; justify-content:flex-end; gap: 8px;">
                    <span style="min-width: 35px; text-align: right;">${formatTime(song.duration)}</span>
                    ${isEditMode ? `<div class="edit-inline" onclick="event.stopPropagation(); openEditModal('song', '${song.songID}')"><svg class="icon" style="width:16px;height:16px;"><use href="#icon-gear"></use></svg></div>` : ''}
                    <div class="song-menu-btn" onclick="event.stopPropagation(); openContextMenu(event, '${song.songID}')">⋮</div>
                </div>
            </div>
        `;
    });
    if (artistSongs.length === 0) songsHtml = '<p style="color: var(--text-muted);">No songs found.</p>';

    let membersHtml = '';
    if (artist.members && artist.members.length > 0) {
        membersHtml = `
            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #282828;">
                <h3 style="font-size: 12px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 1px; margin-bottom: 8px;">Members</h3>
                <p style="color: #999; font-size: 14px;">${artist.members.join(', ')}</p>
            </div>
        `;
    }

    contentArea.innerHTML = `
        <div class="artist-header">
            <img src="${artist.paths.cover}" alt="${artist.artist}" onclick="openImageModal('${artist.paths.cover}')" onerror="this.style.display='none'">
            <div class="artist-header-info">
                <h1>${artist.artist}</h1>
                <div style="color: var(--text-muted); margin-bottom: 20px;">
                    ${artist.country ? artist.country + ' • ' : ''} 
                    Active: ${artist.startYear ? artist.startYear : 'Unknown'}
                    ${artist.firstlistenYear ? ' • First Listen: ' + artist.firstlistenYear : ''}
                </div>
                <div class="artist-tags" style="flex-direction: column; align-items: flex-start; gap: 0;">
                    ${genresHtml}
                    ${tagsHtml}
                </div>
            </div>
        </div>
        
        <div class="action-buttons" style="margin-bottom: 40px;">
            <button class="btn-primary" onclick="playArtistContext('${artistID}', false)">
                <svg class="icon icon-filled"><use href="#icon-play"></use></svg> Play All
            </button>
            <button class="btn-secondary" onclick="playArtistContext('${artistID}', true)">
                <svg class="icon"><use href="#icon-shuffle"></use></svg> Shuffle
            </button>
        </div>

        <div class="artist-content-split">
            <div class="artist-songs-col">
                <h2 class="artist-section-title" style="margin-top: 0;">Songs</h2>
                <div class="artist-songs-container">${songsHtml}</div>
            </div>

            <div class="artist-albums-col">
                <h2 class="artist-section-title" style="margin-top: 0;">Albums</h2>
                <div style="margin-bottom: 50px;">${buildAlbumGrid(mainAlbums)}</div>
                ${epSingles.length > 0 ? `<h2 class="artist-section-title">EPs & Singles</h2><div style="margin-bottom: 50px;">${buildAlbumGrid(epSingles)}</div>` : ''}
                ${compilations.length > 0 ? `<h2 class="artist-section-title">Compilations</h2><div style="margin-bottom: 50px;">${buildAlbumGrid(compilations)}</div>` : ''}
            </div>
        </div>
        ${membersHtml}
    `;
}

// ==========================================
// 7. SIDEBAR DOM TRIGGER BINDINGS
// ==========================================
navArtists.addEventListener('click', (event) => { event.preventDefault(); window.location.hash = 'artists'; });
navAlbums.addEventListener('click', (event) => { event.preventDefault(); window.location.hash = 'albums'; });
if (navSongs) { navSongs.addEventListener('click', (event) => { event.preventDefault(); window.location.hash = 'songs'; }); }
const navHome = document.getElementById('nav-home');
if (navHome) { navHome.addEventListener('click', (event) => { event.preventDefault(); window.location.hash = ''; }); }
const navSettings = document.getElementById('nav-settings');
if (navSettings) { navSettings.addEventListener('click', (event) => { event.preventDefault(); window.location.hash = 'settings'; }); }
const navFavorites = document.getElementById('nav-favorites');
if (navFavorites) { navFavorites.addEventListener('click', (event) => { event.preventDefault(); window.location.hash = 'favorites'; }); }
const navPlaylists = document.getElementById('nav-playlists');
if (navPlaylists) { navPlaylists.addEventListener('click', (event) => { event.preventDefault(); window.location.hash = 'playlists'; }); }




function renderStatsView() {
    if (!currentAccount) return contentArea.innerHTML = `<h1 class="header-title">My Stats</h1><p style="color: var(--text-muted);">Please select a profile to view statistics.</p>`;

    // Default dates: last 30 days
    const defaultEnd = new Date().toISOString().split('T')[0];
    const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    contentArea.innerHTML = `
<div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom: 24px;">
            <h1 class="header-title" style="margin:0;">Listening Analytics</h1>
            <div style="display: flex; gap: 12px;">
                <button class="btn-primary" style="background: linear-gradient(45deg, #ff0050, #8a2be2); color: white; border: none; font-weight: bold;" onclick="openRewindModal()">
                    ✨ Create Rewind
                </button>
                <button class="btn-secondary" onclick="ipcRenderer.send('export-account-data', '${currentAccount.slug}')">
                    <svg class="icon" style="width:16px; height:16px;"><use href="#icon-list"></use></svg> Download Data
                </button>
            </div>
        </div>

        <div class="controls-toolbar" style="gap: 16px;">
            <div style="display: flex; flex-direction: column;">
                <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Start Date</label>
                <input type="date" id="stat-start" class="ctrl-input" value="${defaultStart}">
            </div>
            <div style="display: flex; flex-direction: column;">
                <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">End Date</label>
                <input type="date" id="stat-end" class="ctrl-input" value="${defaultEnd}">
            </div>
            <div style="display: flex; flex-direction: column;">
                <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Quick Select</label>
                <select id="stat-quick" class="ctrl-select" onchange="applyQuickDateRange(this.value)">
                    <option value="">-- Select --</option>
                    <option value="7">Last 7 Days</option>
                    <option value="30" selected>Last 30 Days</option>
                    <option value="365">Last Year</option>
                    <option value="all">All Time</option>
                </select>
            </div>
            <button class="btn-primary" style="margin-top: 14px; padding: 8px 16px;" onclick="calculateStats()">Generate Report</button>
        </div>

        <div id="stats-dashboard" style="display: flex; flex-direction: column; gap: 24px; margin-bottom: 40px;">
            <p style="color: var(--text-muted);">Click "Generate Report" to see your stats.</p>
        </div>
    `;

    calculateStats(); // Auto-calculate on load
}

window.applyQuickDateRange = function(days) {
    const end = new Date();
    document.getElementById('stat-end').value = end.toISOString().split('T')[0];
    if (days === 'all') {
        document.getElementById('stat-start').value = "2020-01-01";
    } else if (days) {
        const start = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
        document.getElementById('stat-start').value = start.toISOString().split('T')[0];
    }
    calculateStats();
};

window.calculateStats = function() {
    const dash = document.getElementById('stats-dashboard');
    if (!currentAccount.history || currentAccount.history.length === 0) {
        dash.innerHTML = `<p style="color: var(--text-muted);">No listening history recorded yet. Go play some music!</p>`;
        return;
    }

    const startDate = new Date(document.getElementById('stat-start').value);
    const endDate = new Date(document.getElementById('stat-end').value);
    endDate.setHours(23, 59, 59, 999); 

    const filteredHistory = currentAccount.history.filter(h => {
        const d = new Date(h.timestamp);
        return d >= startDate && d <= endDate;
    });

    if (filteredHistory.length === 0) {
        dash.innerHTML = `<p style="color: var(--text-muted);">No listening data found in this date range.</p>`;
        return;
    }

    let totalSeconds = 0;
    const songCounts = {}, artistCounts = {}, albumCounts = {}, genreCounts = {}, tagCounts = {};
    const timeOfDay = new Array(24).fill(0);
    const playsOverTime = {};

    filteredHistory.forEach(h => {
        const song = songsDatabase.find(s => s.songID === h.songID);
        if (!song) return;
        
        totalSeconds += parseInt(song.duration) || 0;
        
        songCounts[song.songID] = (songCounts[song.songID] || 0) + 1;
        artistCounts[song.artistID] = (artistCounts[song.artistID] || 0) + 1;
        albumCounts[song.albumID] = (albumCounts[song.albumID] || 0) + 1;
        
        if (song.genre) song.genre.forEach(g => genreCounts[g] = (genreCounts[g] || 0) + 1);
        if (song.tags) song.tags.forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1);

        const d = new Date(h.timestamp);
        timeOfDay[d.getHours()]++;
        
        const dateStr = d.toISOString().split('T')[0];
        playsOverTime[dateStr] = (playsOverTime[dateStr] || 0) + 1;
    });

    const getTop = (dict, num) => Object.entries(dict).sort((a,b) => b[1] - a[1]).slice(0, num);

    // Format Lists
    const buildList = (title, topArray, resolver) => {
        let html = `<div class="stats-card"><h3>${title}</h3>`;
        if (topArray.length === 0) return html + `<p style="color: #666; font-size: 13px;">No data.</p></div>`;
        topArray.forEach((entry, idx) => {
            html += `<div class="stats-list-item"><div class="name"><span style="color:#666; margin-right:8px;">${idx+1}.</span> ${resolver(entry[0])}</div><div class="count">${entry[1]} plays</div></div>`;
        });
        return html + `</div>`;
    };

    const topSongs = buildList('Top Songs', getTop(songCounts, 10), id => songsDatabase.find(s => s.songID === id)?.title || "Unknown");
    const topArtists = buildList('Top Artists', getTop(artistCounts, 5), id => getArtistName(id));
    const topAlbums = buildList('Top Albums', getTop(albumCounts, 5), id => albumsDatabase.find(a => a.albumID === id)?.title || "Unknown");
    const topGenres = buildList('Top Genres', getTop(genreCounts, 5), name => name);
    
    // Format Time of Day Chart
    const maxHour = Math.max(...timeOfDay, 1);
    let hourChartHtml = `<div class="stats-card" style="flex: 100%;"><h3>Habits by Time of Day</h3><div class="stats-bar-chart" style="gap: 2px;">`;
    timeOfDay.forEach((val, hr) => {
        const hPct = (val / maxHour) * 100;
        hourChartHtml += `<div style="flex:1; display:flex; flex-direction:column; align-items:center; height:100%;">
            <div style="flex:1; width:100%; display:flex; align-items:flex-end;"><div class="stats-bar" style="height:${hPct}%; width:100%;" data-val="${val} plays"></div></div>
            <div style="font-size:10px; color:#666; margin-top:4px;">${hr}h</div>
        </div>`;
    });
    hourChartHtml += `</div></div>`;

    // History List
    let historyHtml = `<div class="stats-card" style="flex: 100%;"><h3>Recent History</h3><div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;">`;
    const recent = [...filteredHistory].reverse().slice(0, 30);
    recent.forEach(h => {
        const song = songsDatabase.find(s => s.songID === h.songID);
        const d = new Date(h.timestamp);
        if (song) historyHtml += `<div class="stats-list-item" style="border:none; padding:4px 0;"><div class="name">${song.title} <span style="color:#666; font-size:11px;">(${getArtistName(song.artistID)})</span></div><div class="count" style="font-weight:normal;">${d.toLocaleDateString()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}</div></div>`;
    });
    historyHtml += `</div></div>`;

    const totalHours = Math.floor(totalSeconds / 3600);
    const totalMins = Math.floor((totalSeconds % 3600) / 60);

    dash.innerHTML = `
        <div style="background: var(--text-main); color: #000; padding: 24px; border-radius: 8px; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <div style="font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; opacity: 0.8;">Total Listening Time</div>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: -1px;">${totalHours} <span style="font-size: 18px; font-weight: normal;">Hours</span> ${totalMins} <span style="font-size: 18px; font-weight: normal;">Mins</span></div>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; opacity: 0.8;">Total Streams</div>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: -1px;">${filteredHistory.length}</div>
            </div>
        </div>
        
        <div style="display: flex; gap: 24px; flex-wrap: wrap;">
            ${topSongs}
            <div style="display: flex; flex-direction: column; gap: 24px; flex: 1; min-width: 280px;">
                ${topArtists}
                ${topAlbums}
                ${topGenres}
            </div>
        </div>

        ${hourChartHtml}
        ${historyHtml}
    `;
};




// ==========================================
// 🚨 NEW: ACCOUNT & FAVORITES SYSTEM
// ==========================================
let allAccounts = [];
let currentAccount = null; 

ipcRenderer.send('fetch-accounts');
ipcRenderer.on('accounts-data', (event, accounts) => {
    allAccounts = accounts;
    const savedAccId = localStorage.getItem('activeAccount');
    if (savedAccId) {
        const found = allAccounts.find(a => a.id === savedAccId);
        if (found) setAccount(found);
    }
    renderAccountDropdownList();
});

function toggleProfileDropdown() { document.getElementById('profile-dropdown').classList.toggle('visible'); }
document.addEventListener('click', (e) => {
    if (!e.target.closest('#btn-profile') && !e.target.closest('#profile-dropdown')) {
        document.getElementById('profile-dropdown').classList.remove('visible');
    }
});

function renderAccountDropdownList() {
    const container = document.getElementById('account-list-container');
    if (allAccounts.length === 0) {
        container.innerHTML = `<p style="color: #666; font-size: 13px; padding: 16px; margin: 0; text-align: center;">No accounts found.</p>`;
        return;
    }
    container.innerHTML = allAccounts.map(acc => {
        const isActive = currentAccount && currentAccount.id === acc.id;
        return `
            <div class="dropdown-item" onclick="setAccountById('${acc.id}')" style="${isActive ? 'background: #333;' : ''}">
                <img src="${acc.paths.profilePic}" onerror="this.src='logo.ico'"> 
                <div style="flex: 1;">${acc.name}</div>
                ${isActive ? '<span style="font-size: 12px; color: var(--text-muted);">Active</span>' : ''}
            </div>
        `;
    }).join('');
}

function setAccountById(id) {
    if (currentAccount && currentAccount.id === id) {
        document.getElementById('profile-dropdown').classList.remove('visible');
        return;
    }
    if (currentAccount) {
        showCustomConfirm("Are you sure you want to switch accounts? This will reload the app.", () => {
            localStorage.setItem('activeAccount', id);
            window.location.reload();
        });
    } else {
        localStorage.setItem('activeAccount', id);
        window.location.reload();
    }
}

function setAccount(acc) {
    currentAccount = acc;
    if (!currentAccount.favorites) currentAccount.favorites = [];
    localStorage.setItem('activeAccount', acc.id);
    const profileBtn = document.getElementById('btn-profile');
    profileBtn.innerHTML = `<img src="${acc.paths.profilePic}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" onerror="this.src='logo.ico'">`;
    renderAccountDropdownList();
    
    updatePlayerHeart();
    if (window.location.hash === '#favorites') updateSongList();
}

window.openContextMenu = function(e, songId) {
    e.preventDefault(); e.stopPropagation(); 
    const existing = document.getElementById('context-menu');
    if (existing) existing.remove();

    if (!currentAccount) return alert("Please create or select a profile first!");

    const isFav = currentAccount.favorites && currentAccount.favorites.includes(songId);
    
    // Build Playlist Submenu HTML
    let plHtml = `<div class="dropdown-item" onclick="openCreatePlaylistModal('${songId}'); document.getElementById('context-menu').remove();" style="color: var(--text-main); font-weight: bold;">+ Create New Playlist</div><div class="dropdown-divider"></div>`;
    
    if (currentAccount.playlists && currentAccount.playlists.length > 0) {
        plHtml += `<div style="padding: 8px; background: #1a1a1a;"><input type="text" id="ctx-pl-search" placeholder="Search playlists..." style="width:100%; background: #333; border: none; color: white; padding: 6px; border-radius: 4px; font-size: 12px;" onclick="event.stopPropagation();" onkeyup="filterCtxPlaylists(this.value)"></div>`;
        plHtml += `<div id="ctx-pl-list">`;
        currentAccount.playlists.forEach(pl => {
            const hasSong = pl.songs.includes(songId);
            const checkStyle = hasSong ? 'display: inline;' : 'display: none;';
            plHtml += `<div class="dropdown-item ctx-pl-item" style="display: flex; justify-content: space-between; align-items: center;" onclick="addSongToPlaylist('${pl.id}', '${songId}', this); event.stopPropagation();">
                <span>${pl.name}</span>
                <span class="pl-check" style="color: var(--text-main); font-weight: bold; ${checkStyle}">✓</span>
            </div>`;
        });
        plHtml += `</div>`;
    }

    const menu = document.createElement('div');
    menu.id = 'context-menu'; menu.className = 'profile-dropdown visible';
    menu.style.position = 'fixed'; menu.style.top = e.clientY + 'px'; menu.style.left = (e.clientX - 160) + 'px'; 
    menu.style.zIndex = 10000; menu.style.width = '200px';
    menu.style.overflow = 'visible'; // <--- THIS SAVES THE DAY
    menu.innerHTML = `
        <div class="dropdown-item" onclick="toggleFavorite('${songId}'); document.getElementById('context-menu').remove();">
            <svg class="icon ${isFav ? 'icon-filled' : ''}" style="width:16px;height:16px; color: ${isFav ? 'var(--text-main)' : 'var(--text-muted)'};"><use href="#icon-heart"></use></svg>
            ${isFav ? 'Remove from Favorites' : 'Save to Favorites'}
        </div>
        <div class="dropdown-item has-submenu">
            <svg class="icon" style="width:16px;height:16px; color: var(--text-muted);"><use href="#icon-list"></use></svg> Add to Playlist ▸
            <div class="submenu">${plHtml}</div>
        </div>
    `;
    document.body.appendChild(menu);

    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!e.target.closest('#context-menu')) {
                const m = document.getElementById('context-menu'); if(m) m.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 0);
};

window.filterCtxPlaylists = function(term) {
    const termL = term.toLowerCase();
    document.querySelectorAll('.ctx-pl-item').forEach(item => {
        item.style.display = item.innerText.toLowerCase().includes(termL) ? 'flex' : 'none';
    });
};

window.addSongToPlaylist = function(plID, songId, element) {
    const pl = currentAccount.playlists.find(p => p.id === plID);
    if (!pl) return;
    
    // If it's already there, do nothing. No alerts.
    if (pl.songs.includes(songId)) return; 
    
    pl.songs.push(songId);
    ipcRenderer.send('save-account-data', currentAccount);
    
    // Visually show the checkmark on the clicked element instantly
    if (element) {
        const check = element.querySelector('.pl-check');
        if (check) check.style.display = 'inline';
    }
};

window.toggleFavorite = function(songId) {
    if (!currentAccount) return alert("Please create or select a profile first!");
    
    ipcRenderer.send('toggle-favorite', { accountId: currentAccount.id, songId });

    if (!currentAccount.favorites) currentAccount.favorites = [];
    const idx = currentAccount.favorites.indexOf(songId);
    if (idx > -1) currentAccount.favorites.splice(idx, 1);
    else currentAccount.favorites.push(songId);

    updatePlayerHeart();
    
    if (window.location.hash === '#favorites') updateSongList();
}

window.updatePlayerHeart = function() {
    const btn = document.getElementById('btn-player-favorite');
    if (!btn) return;
    if (!currentSong || !currentAccount) {
        btn.innerHTML = `<svg class="icon"><use href="#icon-heart"></use></svg>`;
        btn.classList.remove('active-toggle');
        return;
    }
    const isFav = currentAccount.favorites && currentAccount.favorites.includes(currentSong.songID);
    if (isFav) {
        btn.innerHTML = `<svg class="icon icon-filled"><use href="#icon-heart"></use></svg>`;
        btn.classList.add('active-toggle');
    } else {
        btn.innerHTML = `<svg class="icon"><use href="#icon-heart"></use></svg>`;
        btn.classList.remove('active-toggle');
    }
}

document.getElementById('btn-player-favorite').addEventListener('click', () => {
    if (currentSong) toggleFavorite(currentSong.songID);
});

let draggedImagePath = null;

function openCreateAccountModal() {
    document.getElementById('profile-dropdown').classList.remove('visible');
    document.getElementById('create-account-modal').style.display = 'flex';
    const nameInput = document.getElementById('acc-name-input');
    if (nameInput) nameInput.value = '';
    document.getElementById('drop-zone-preview').style.display = 'none';
    document.getElementById('file-input').value = ''; 
    draggedImagePath = null;
    
    const dropZone = document.getElementById('drop-zone');
    if(dropZone) dropZone.classList.remove('drag-active');
}

function closeCreateAccountModal() {
    document.getElementById('create-account-modal').style.display = 'none';
}

// Setup Drag & Drop listeners
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

if (dropZone && fileInput) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-active'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-active'), false);
    });

    dropZone.addEventListener('drop', handleDrop, false);

    fileInput.addEventListener('change', function() {
        handleFileSelect(this.files);
    });
}

function handleDrop(e) {
    let dt = e.dataTransfer;
    let files = dt.files;
    handleFileSelect(files);
}

function handleFileSelect(files) {
    if (files && files.length > 0) {
        let file = files[0];
        
        // Ensure it's an image
        if (!file.type.startsWith('image/')) return alert("Please select an image file.");
        
        // Electron gives us the exact absolute file path for FFmpeg
        draggedImagePath = file.path; 
        
        // Use URL.createObjectURL to safely bypass Electron's local file security for the preview!
        const preview = document.getElementById('drop-zone-preview');
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
    }
}

function submitNewAccount() {
    const name = document.getElementById('acc-name-input').value.trim();
    if (!name) return alert("Please enter a profile name.");
    
    // Send to backend to create folder, JSON, and crop image
    ipcRenderer.send('create-account', { name: name, imagePath: draggedImagePath });
    
    // Temporarily change button to show it's working
    document.querySelector('#create-account-modal .btn-primary').innerText = "Processing Image...";
}

// Handle Success Reply
ipcRenderer.on('account-created-success', (event, newAcc) => {
    // Add to local list and select it immediately
    allAccounts.push(newAcc);
    setAccount(newAcc);
    
    // Reset and close modal
    closeCreateAccountModal();
    document.querySelector('#create-account-modal .btn-primary').innerText = "Create Account";
});

// --- MODAL LOGIC ---
let draggedPlImagePath = null;

function openCreatePlaylistModal(pendingSongId = "") {
    document.getElementById('create-playlist-modal').style.display = 'flex';
    document.getElementById('pl-name-input').value = '';
    document.getElementById('pl-drop-zone-preview').style.display = 'none';
    document.getElementById('pl-pending-song').value = pendingSongId;
    draggedPlImagePath = null;
}

function closeCreatePlaylistModal() { document.getElementById('create-playlist-modal').style.display = 'none'; }

// Wire up the playlist drag & drop image zone just like the account one
const plDropZone = document.getElementById('pl-drop-zone');
const plFileInput = document.getElementById('pl-file-input');

if (plDropZone && plFileInput) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eName => plDropZone.addEventListener(eName, e => { e.preventDefault(); e.stopPropagation(); }, false));
    ['dragenter', 'dragover'].forEach(eName => plDropZone.addEventListener(eName, () => plDropZone.classList.add('drag-active'), false));
    ['dragleave', 'drop'].forEach(eName => plDropZone.addEventListener(eName, () => plDropZone.classList.remove('drag-active'), false));
    
    plDropZone.addEventListener('drop', e => {
        let file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) { draggedPlImagePath = file.path; document.getElementById('pl-drop-zone-preview').src = URL.createObjectURL(file); document.getElementById('pl-drop-zone-preview').style.display = 'block'; }
    });
    plFileInput.addEventListener('change', function() {
        let file = this.files[0];
        if (file && file.type.startsWith('image/')) { draggedPlImagePath = file.path; document.getElementById('pl-drop-zone-preview').src = URL.createObjectURL(file); document.getElementById('pl-drop-zone-preview').style.display = 'block'; }
    });
}

function submitNewPlaylist() {
    const name = document.getElementById('pl-name-input').value.trim();
    if (!name) return alert("Enter a playlist name.");
    document.querySelector('#create-playlist-modal .btn-primary').innerText = "Generating...";
    ipcRenderer.send('create-playlist', { accountId: currentAccount.id, name: name, imagePath: draggedPlImagePath });
}

ipcRenderer.on('playlist-created-success', (event, { userData, newPlaylist }) => {
    currentAccount = userData; 
    const pendingSong = document.getElementById('pl-pending-song').value;
    if (pendingSong) {
        addSongToPlaylist(newPlaylist.id, pendingSong);
    }
    closeCreatePlaylistModal();
    document.querySelector('#create-playlist-modal .btn-primary').innerText = "Create Playlist";
    if (window.location.hash === '#playlists') renderPlaylistsView();
});

// --- PLAYLIST DETAIL VIEW (WITH REORDERING) ---
function renderPlaylistDetailView(playlistID) {
    if (!currentAccount) return;
    const pl = currentAccount.playlists.find(p => p.id === playlistID);
    if (!pl) return;

    let playlistSongs = pl.songs.map(songId => songsDatabase.find(s => s.songID === songId)).filter(s => s);
    const totalMins = playlistSongs.reduce((acc, s) => acc + (parseInt(s.duration) || 0), 0) / 60;

    let tracklistHtml = `<div class="tracklist-header track-row"><div class="th-num">#</div><div class="th-title">Title & Artist</div><div class="th-dur">⏱</div></div>`;

    playlistSongs.forEach((song, index) => {
        let isActive = (currentSong && currentSong.songID === song.songID) ? 'active-track' : '';
        tracklistHtml += `
            <div class="track-item track-row draggable ${isActive}" data-song-id="${song.songID}" data-index="${index}" onclick="playQueueFromPlaylist('${playlistID}', ${index})" draggable="true">
                <div class="t-num">☰ ${index + 1}</div>
                <div class="t-title" style="display: flex; flex-direction: column;">
                    <span>${song.title}</span>
                    <span style="font-size: 11px; color: var(--text-muted);">${getArtistName(song.artistID)}</span>
                </div>
                <div class="t-dur" style="display:flex; align-items:center; justify-content:flex-end; gap: 8px;">
                    <span style="min-width: 35px; text-align: right;">${formatTime(song.duration)}</span>
                    <div class="song-menu-btn" onclick="event.stopPropagation(); removeSongFromPlaylist('${playlistID}', ${index});">✕</div>
                </div>
            </div>
        `;
    });

    if (playlistSongs.length === 0) tracklistHtml += '<p style="color: var(--text-muted); padding: 20px;">No tracks added yet.</p>';

    contentArea.innerHTML = `
        <div class="album-detail-container" style="display: flex; gap: 40px; align-items: flex-start;">
            <div class="album-info-col" style="width: 320px; flex-shrink: 0;">
                <img src="${pl.cover}" class="big-cover">
                <div>
                    <div class="album-title">${pl.name}</div>
                    <div class="album-artist">Playlist • ${currentAccount.name}</div>
                    <div class="album-meta">${playlistSongs.length} songs, ${Math.floor(totalMins)} min</div>
                </div>
                <div class="action-buttons">
                    <button class="btn-primary" onclick="playPlaylistContext('${playlistID}', false)"><svg class="icon icon-filled"><use href="#icon-play"></use></svg> Play</button>
                    <button class="btn-secondary" onclick="playPlaylistContext('${playlistID}', true)"><svg class="icon"><use href="#icon-shuffle"></use></svg> Shuffle</button>
                    <button class="btn-primary" style="background: #ff0050; color: white; border: none; padding: 12px;" onclick="deletePlaylist('${playlistID}')" title="Delete Playlist">✕</button>
                </div>
            </div>
            <div class="tracklist-col" id="playlist-drag-container" style="flex: 1; min-width: 0;">${tracklistHtml}</div>
        </div>
    `;

    // ATTACH DRAG AND DROP EVENTS FOR REORDERING
    let draggedItemIndex = null;
    document.querySelectorAll('.draggable').forEach(row => {
        row.addEventListener('dragstart', function() {
            draggedItemIndex = parseInt(this.getAttribute('data-index'));
            this.classList.add('dragging');
        });
        row.addEventListener('dragover', function(e) {
            e.preventDefault();
            this.classList.add('drag-over');
        });
        row.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
        });
        row.addEventListener('drop', function(e) {
            e.preventDefault();
            this.classList.remove('drag-over');
            const targetIndex = parseInt(this.getAttribute('data-index'));
            
            // Reorder the array in the backend
            const plRef = currentAccount.playlists.find(p => p.id === playlistID);
            const movedSongId = plRef.songs.splice(draggedItemIndex, 1)[0];
            plRef.songs.splice(targetIndex, 0, movedSongId);
            
            ipcRenderer.send('save-account-data', currentAccount);
            renderPlaylistDetailView(playlistID); // Reload View
        });
        row.addEventListener('dragend', function() {
            this.classList.remove('dragging');
        });
    });
}

window.deletePlaylist = function(plID) {
    showCustomConfirm("Are you sure you want to permanently delete this playlist?", () => {
        const plIndex = currentAccount.playlists.findIndex(p => p.id === plID);
        if (plIndex === -1) return;
        
        const pl = currentAccount.playlists[plIndex];
        currentAccount.playlists.splice(plIndex, 1);
        
        ipcRenderer.send('delete-playlist-data', { account: currentAccount, coverPath: pl.cover });
        window.location.hash = 'playlists';
    });
};

window.removeSongFromPlaylist = function(plID, index) {
    showCustomConfirm("Are you sure you want to remove this song from the playlist?", () => {
        const pl = currentAccount.playlists.find(p => p.id === plID);
        if (!pl) return;
        pl.songs.splice(index, 1);
        ipcRenderer.send('save-account-data', currentAccount);
        renderPlaylistDetailView(plID);
    });
};

// Playback Logic for Playlists
window.playPlaylistContext = function(plID, forceShuffle = false) {
    const pl = currentAccount.playlists.find(p => p.id === plID);
    let playlistSongs = pl.songs.map(songId => songsDatabase.find(s => s.songID === songId)).filter(s => s);
    if (playlistSongs.length === 0) return alert("Playlist is empty!");
    originalQueue = [...playlistSongs];
    if (forceShuffle && !isShuffle) toggleShuffle(); 
    playQueue = isShuffle ? shuffleArray(playlistSongs) : [...playlistSongs];
    currentQueueIndex = 0;
    playSong(playQueue[currentQueueIndex].songID);
};

window.playQueueFromPlaylist = function(plID, index) {
    const pl = currentAccount.playlists.find(p => p.id === plID);
    let playlistSongs = pl.songs.map(songId => songsDatabase.find(s => s.songID === songId)).filter(s => s);
    originalQueue = [...playlistSongs];
    playQueue = isShuffle ? shuffleArray(playlistSongs) : [...playlistSongs];
    let clickedSongID = playlistSongs[index].songID;
    currentQueueIndex = playQueue.findIndex(s => s.songID === clickedSongID);
    playSong(playQueue[currentQueueIndex].songID);
};

// --- PLAYLISTS BROWSE TAB (Mimicking Albums View logic) ---
let playlistState = { search: "", sortBy: "title", sortDir: "asc", filters: { artist: [], genre: [], tag: [] } };

function getPlaylistStats(pl) {
    let pSongs = pl.songs.map(id => songsDatabase.find(s => s.songID === id)).filter(s=>s);
    let duration = pSongs.reduce((sum, s) => sum + (parseInt(s.duration)||0), 0);
    let artists = new Set(), genres = new Set(), tags = new Set();
    
    pSongs.forEach(s => {
        artists.add(getArtistName(s.artistID));
        if(s.genre) s.genre.forEach(g => genres.add(g));
        if(s.tags) s.tags.forEach(t => tags.add(t));
    });
    
    return { trackcount: pSongs.length, duration, artists: Array.from(artists), genres: Array.from(genres), tags: Array.from(tags) };
}

function renderPlaylistsView() {
    if (!currentAccount) return contentArea.innerHTML = `<h1 class="header-title">Playlists</h1><p style="color: var(--text-muted);">Please select a profile to view playlists.</p>`;
    
    let allArtists = new Set(), allGenres = new Set(), allTags = new Set();
    currentAccount.playlists.forEach(pl => {
        let stats = getPlaylistStats(pl);
        stats.artists.forEach(a => allArtists.add(a));
        stats.genres.forEach(g => allGenres.add(g));
        stats.tags.forEach(t => allTags.add(t));
    });

    contentArea.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 24px;">
            <h1 class="header-title" style="margin:0;">My Playlists</h1>
            <button class="btn-primary" onclick="openCreatePlaylistModal()">+ New Playlist</button>
        </div>
        
        <div class="controls-toolbar">
            <input type="text" id="ctrl-pl-search" class="ctrl-input ctrl-search" placeholder="Search playlists...">
            <select id="ctrl-pl-sort" class="ctrl-select">
                <option value="title" ${playlistState.sortBy === 'title' ? 'selected' : ''}>Sort: A-Z (Title)</option>
                <option value="duration" ${playlistState.sortBy === 'duration' ? 'selected' : ''}>Sort: Duration</option>
                <option value="trackcount" ${playlistState.sortBy === 'trackcount' ? 'selected' : ''}>Sort: Track Count</option>
            </select>
            <button id="ctrl-pl-sort-dir" class="sort-dir-btn">${playlistState.sortDir === 'asc' ? '↓ ASC' : '↑ DESC'}</button>
            <button id="ctrl-pl-shuffle" class="sort-dir-btn" style="color: var(--text-main); border: 1px solid #444;">Randomize</button>
            
            ${buildMultiSelect('ms-pl-artist', 'Artists', allArtists)}
            ${buildMultiSelect('ms-pl-genre', 'Genres', allGenres)}
            ${buildMultiSelect('ms-pl-tag', 'Tags', allTags)}
        </div>
        <div class="grid-container" id="playlist-grid"></div>
    `;
    
    attachPlaylistControlListeners();
    updatePlaylistGrid();
}

function attachPlaylistControlListeners() {
    document.querySelectorAll('.multi-select .anchor').forEach(anchor => { anchor.addEventListener('click', (e) => { document.querySelectorAll('.multi-select').forEach(ms => { if (ms !== e.target.closest('.multi-select')) ms.classList.remove('visible'); }); e.target.closest('.multi-select').classList.toggle('visible'); }); });
    
    document.getElementById('ctrl-pl-search').addEventListener('input', (e) => { playlistState.search = e.target.value.toLowerCase(); updatePlaylistGrid(); }); 
    document.getElementById('ctrl-pl-sort').addEventListener('change', (e) => { playlistState.sortBy = e.target.value; updatePlaylistGrid(); });
    document.getElementById('ctrl-pl-sort-dir').addEventListener('click', (e) => { playlistState.sortDir = playlistState.sortDir === 'asc' ? 'desc' : 'asc'; e.target.innerText = playlistState.sortDir === 'asc' ? '↓ ASC' : '↑ DESC'; updatePlaylistGrid(); });
    document.getElementById('ctrl-pl-shuffle').addEventListener('click', () => { playlistState.sortDir = 'random'; document.getElementById('ctrl-pl-sort-dir').innerText = '↕ RND'; updatePlaylistGrid(); });
    
    const getChecked = (id) => Array.from(document.querySelectorAll(`#${id} input:checked`)).map(cb => cb.value);
    document.querySelectorAll('.multi-select input[type="checkbox"]').forEach(cb => { 
        cb.addEventListener('change', () => { 
            playlistState.filters.artist = getChecked('ms-pl-artist'); 
            playlistState.filters.genre = getChecked('ms-pl-genre'); 
            playlistState.filters.tag = getChecked('ms-pl-tag'); 
            updatePlaylistGrid(); 
        }); 
    });
}

function updatePlaylistGrid() {
    const grid = document.getElementById('playlist-grid'); if (!grid) return; grid.innerHTML = ''; 
    if (!currentAccount.playlists || currentAccount.playlists.length === 0) {
        grid.innerHTML = `<p style="color: var(--text-muted);">You have no playlists.</p>`; return;
    }

    let enrichedPlaylists = currentAccount.playlists.map(pl => { return { ...pl, stats: getPlaylistStats(pl) }; });

    let results = enrichedPlaylists.filter(pl => {
        if (playlistState.search && !pl.name.toLowerCase().includes(playlistState.search)) return false; 
        let f = playlistState.filters; 
        if (f.artist.length > 0 && !f.artist.some(a => pl.stats.artists.includes(a))) return false; 
        if (f.genre.length > 0 && !f.genre.some(g => pl.stats.genres.includes(g))) return false; 
        if (f.tag.length > 0 && !f.tag.some(t => pl.stats.tags.includes(t))) return false; 
        return true; 
    });
    
    if (playlistState.sortDir === 'random') {
        results = shuffleArray(results);
    } else {
        results.sort((a, b) => { 
            let valA, valB; 
            if (playlistState.sortBy === 'duration') { valA = a.stats.duration; valB = b.stats.duration; } 
            else if (playlistState.sortBy === 'trackcount') { valA = a.stats.trackcount; valB = b.stats.trackcount; } 
            else { valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); } 
            
            if (valA < valB) return playlistState.sortDir === 'asc' ? -1 : 1; 
            if (valA > valB) return playlistState.sortDir === 'asc' ? 1 : -1; 
            return 0; 
        });
    }

    if (results.length === 0) { grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1 / -1;">No playlists match those filters.</p>`; return; }
    
    results.forEach(pl => {
        const card = document.createElement('div'); card.className = 'album-card';
        card.innerHTML = `
            <div class="album-img-wrapper"><img src="${pl.cover}" onerror="this.src='logo.ico'"></div>
            <div class="title">${pl.name}</div>
            <div class="artist">${pl.stats.trackcount} Tracks • ${Math.floor(pl.stats.duration / 60)} mins</div>`;
        card.addEventListener('click', () => { window.location.hash = `playlist/${pl.id}`; });
        grid.appendChild(card);
    });
}

// ==========================================
// GLOBAL TOP SEARCH BAR IMPLEMENTATION
// ==========================================
const searchBar = document.getElementById('search-bar');
if (searchBar) {
    // Dynamically wrap the search bar so the results box anchors correctly
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.flex = '1';
    wrapper.style.maxWidth = '350px';
    searchBar.parentNode.insertBefore(wrapper, searchBar);
    wrapper.appendChild(searchBar);
    searchBar.style.width = '100%';

    // Create the results dropdown container
    const resultsBox = document.createElement('div');
    resultsBox.id = 'global-search-results';
    resultsBox.style.cssText = "display: none; position: absolute; top: 110%; left: 0; width: 100%; background: #242424; border: 1px solid #333; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); z-index: 1000; flex-direction: column; overflow: hidden;";
    wrapper.appendChild(resultsBox);

    searchBar.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        if (!term) { resultsBox.style.display = 'none'; return; }

        let results = [];
        
        // Search Arrays
        artistsDatabase.forEach(a => { if(a.artist.toLowerCase().includes(term)) results.push({ type: 'Artist', text: a.artist, img: a.paths.cover, action: () => { window.location.hash = `artist/${a.artistID}`; hideSearch(); } }); });
        albumsDatabase.forEach(a => { if(a.title.toLowerCase().includes(term)) results.push({ type: 'Album', text: a.title, sub: getArtistName(a.artistID), img: a.paths.cover, action: () => { window.location.hash = `album/${a.albumID}`; hideSearch(); } }); });
        songsDatabase.forEach(s => { if(s.title.toLowerCase().includes(term)) { const alb = albumsDatabase.find(al=>al.albumID===s.albumID); results.push({ type: 'Song', text: s.title, sub: getArtistName(s.artistID), img: alb?alb.paths.cover:'', action: () => { originalQueue = [s]; playQueue = [s]; currentQueueIndex = 0; playSong(s.songID); hideSearch(); } }); } });

        // Limit to top 5 results
        results = results.slice(0, 5); 

        resultsBox.innerHTML = '';
        if (results.length === 0) {
            resultsBox.innerHTML = `<div style="padding: 12px; color: var(--text-muted); font-size: 13px; text-align: center;">No results found.</div>`;
        } else {
            results.forEach(r => {
                const div = document.createElement('div');
                div.className = 'dropdown-item';
                div.style.cssText = "display: flex; align-items: center; gap: 12px; padding: 10px; cursor: pointer;";
                div.innerHTML = `
                    <img src="${r.img}" style="width: 32px; height: 32px; border-radius: ${r.type === 'Artist' ? '50%' : '4px'}; object-fit: cover; background: #111;" onerror="this.style.display='none'">
                    <div style="flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
                        <div style="color: var(--text-main); font-size: 14px; font-weight: 500;">${r.text}</div>
                        <div style="color: var(--text-muted); font-size: 12px;">${r.type}${r.sub ? ' • ' + r.sub : ''}</div>
                    </div>
                `;
                div.onclick = r.action; // Attach dynamic route action
                resultsBox.appendChild(div);
            });
        }
        resultsBox.style.display = 'flex';
    });

    const hideSearch = () => { resultsBox.style.display = 'none'; searchBar.value = ''; };
    
    // Hide search results if clicked outside
    document.addEventListener('click', (e) => { 
        if(!e.target.closest('#search-bar') && !e.target.closest('#global-search-results')) {
            resultsBox.style.display = 'none'; 
        }
    });
}

window.changeAppTheme = function(themeClass) {
    document.body.className = ''; 
    if (themeClass !== 'default') document.body.classList.add(themeClass);
    localStorage.setItem('appTheme', themeClass);
};
// Apply theme on load
const savedTheme = localStorage.getItem('appTheme');
if (savedTheme) changeAppTheme(savedTheme);

// ==========================================
// THE "Rewind" POSTER ENGINE
// ==========================================
window.openRewindModal = function() {
    const existing = document.getElementById('Rewind-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'Rewind-modal-overlay';
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.9); z-index:99999; display:flex; flex-direction: column; align-items:center; overflow-y: auto; padding: 40px 0; box-sizing: border-box; backdrop-filter: blur(8px);";
    
    overlay.innerHTML = `
<div style="display: flex; gap: 12px; margin-bottom: 20px; z-index: 10; flex-shrink: 0;">
            <button class="btn-secondary" style="background: #242424; color: white; border: none;" onclick="generateRewindData('month')">This Month</button>
            <button class="btn-secondary" style="background: #242424; color: white; border: none;" onclick="generateRewindData('last_month')">Last Month</button>
            <button class="btn-secondary" style="background: #242424; color: white; border: none;" onclick="generateRewindData('year')">This Year</button>
            <button class="btn-secondary" style="background: #242424; color: white; border: none;" onclick="generateRewindData('all')">All Time</button>
            <button class="btn-primary" style="background: #00f0ff; color: #000; border: none; margin-left: 24px; font-weight: bold;" onclick="downloadRewindPoster()">⬇ Download PNG</button>
            <button class="btn-primary" style="background: #ff0050; color: white; border: none; margin-left: 12px;" onclick="document.getElementById('Rewind-modal-overlay').remove()">Close (X)</button>
        </div>
        <div id="Rewind-poster-container" style="box-shadow: 0 20px 60px rgba(0,0,0,0.8); flex-shrink: 0; margin-bottom: 40px;">
            <div style="width: 1100px; height: 700px; background: #0f0c29; display:flex; justify-content:center; align-items:center; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1);">
                <p style="color: rgba(255,255,255,0.4); text-align: center; font-size: 18px;">Select a timeframe above to generate your Rewind poster.</p>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};

window.generateRewindData = function(timeframe) {
    if (!currentAccount || !currentAccount.history) return;

    let startDate, endDate;
    const now = new Date();
    
    if (timeframe === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (timeframe === 'last_month') {
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    } else if (timeframe === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    } else {
        startDate = new Date(2000, 0, 1);
        endDate = new Date(2100, 0, 1);
    }

    const filtered = currentAccount.history.filter(h => {
        const d = new Date(h.timestamp);
        return d >= startDate && d <= endDate;
    });

    const container = document.getElementById('Rewind-poster-container');
    if (filtered.length === 0) {
        container.innerHTML = `<div style="width: 1000px; height: 600px; background: #121212; display:flex; justify-content:center; align-items:center; color: #ff0050; border-radius: 16px;">No listening data found for this period.</div>`;
        return;
    }

    let totalSecs = 0;
    const songStats = {}, artistStats = {}, albumStats = {}, genreStats = {};
    let yearSum = 0, yearCount = 0;
    const hourCounts = new Array(24).fill(0);

    filtered.forEach(h => {
        const song = songsDatabase.find(s => s.songID === h.songID);
        if (!song) return;
        const dur = parseInt(song.duration) || 0;
        totalSecs += dur;

        if(!songStats[song.songID]) songStats[song.songID] = { plays: 0, dur: 0 };
        songStats[song.songID].plays++; songStats[song.songID].dur += dur;

        if(!artistStats[song.artistID]) artistStats[song.artistID] = { plays: 0, dur: 0 };
        artistStats[song.artistID].plays++; artistStats[song.artistID].dur += dur;

        if(!albumStats[song.albumID]) albumStats[song.albumID] = { plays: 0, dur: 0 };
        albumStats[song.albumID].plays++; albumStats[song.albumID].dur += dur;

        if(song.genre) {
            song.genre.forEach(g => {
                if(!genreStats[g]) genreStats[g] = { plays: 0, dur: 0 };
                genreStats[g].plays++; genreStats[g].dur += dur;
            });
        }

        const album = albumsDatabase.find(a => a.albumID === song.albumID);
        if(album && album.releaseDate) {
            const yr = parseInt(album.releaseDate.substring(0,4));
            if(!isNaN(yr) && yr > 1000) { yearSum += yr; yearCount++; }
        }

        const d = new Date(h.timestamp);
        hourCounts[d.getHours()]++;
    });

    const avgYear = yearCount > 0 ? Math.round(yearSum / yearCount) : "Unknown";
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    const formatHour = (h) => {
        let ampm = h >= 12 ? 'PM' : 'AM';
        let hr = h % 12 || 12;
        let timeWord = h >= 5 && h < 12 ? "Morning" : h >= 12 && h < 17 ? "Afternoon" : h >= 17 && h < 21 ? "Evening" : "Night";
        return `${hr}:00 ${ampm} (${timeWord})`;
    };

    const fmtDur = (sec) => sec >= 3600 ? (sec/3600).toFixed(1) + 'h' : Math.ceil(sec/60) + 'm';
    const getTop = (obj, num) => Object.entries(obj).sort((a,b) => b[1].plays - a[1].plays).slice(0, num);

    const tSongs = getTop(songStats, 10);
    const tArtists = getTop(artistStats, 10);
    const tAlbums = getTop(albumStats, 10);
    const tGenres = getTop(genreStats, 10);

    const titleText = timeframe === 'all' ? "All Time" : timeframe === 'month' ? startDate.toLocaleString('default', { month: 'long', year: 'numeric' }) : timeframe === 'last_month' ? startDate.toLocaleString('default', { month: 'long', year: 'numeric' }) : startDate.getFullYear();

    const buildList = (dataArr, resolver, listType) => {
        return dataArr.map((item, idx) => {
            const data = resolver(item[0]);
            const plays = item[1].plays;
            const dur = fmtDur(item[1].dur);
            const imgHtml = data.img ? `<img src="${data.img}" style="width: 28px; height: 28px; border-radius: ${listType === 'artist' ? '50%' : '4px'}; object-fit: cover; margin-right: 10px; background: rgba(255,255,255,0.1);" onerror="this.style.display='none'">` : '';
            return `<div class="w-list-item"><span class="w-rank">${idx+1}.</span>${imgHtml}<span class="w-name">${data.name}</span><span class="w-stats"><strong>${plays}</strong> plays<br>${dur}</span></div>`;
        }).join('');
    };

    container.innerHTML = `
        <div class="Rewind-poster">
            <div class="Rewind-bg"></div>
            
            <div class="w-header">
                <h1>NewMusic <span>Rewind</span></h1>
                <h2>${titleText} • ${currentAccount.name}</h2>
            </div>
            
            <div class="w-summary">
                <div class="w-stat-box"><div>Total Listening Time</div><strong>${fmtDur(totalSecs)}</strong></div>
                <div class="w-stat-box"><div>Unique Songs</div><strong>${Object.keys(songStats).length}</strong></div>
                <div class="w-stat-box"><div>Unique Artists</div><strong>${Object.keys(artistStats).length}</strong></div>
                <div class="w-stat-box"><div>Unique Albums</div><strong>${Object.keys(albumStats).length}</strong></div>
            </div>
            
            <div class="w-columns">
                <div class="w-col">
                    <h3>Top 10 Songs</h3>
                    ${buildList(tSongs, id => {
                        const s = songsDatabase.find(x => x.songID === id);
                        const a = albumsDatabase.find(x => x.albumID === (s ? s.albumID : null));
                        return { name: s ? s.title : "Unknown", img: a ? a.paths.cover : "" };
                    }, 'song')}
                </div>
                <div class="w-col">
                    <h3>Top 10 Artists</h3>
                    ${buildList(tArtists, id => {
                        const a = artistsDatabase.find(x => x.artistID === id);
                        return { name: a ? a.artist : "Unknown", img: a ? a.paths.cover : "" };
                    }, 'artist')}
                </div>
                <div class="w-col">
                    <h3>Top 10 Albums</h3>
                    ${buildList(tAlbums, id => {
                        const a = albumsDatabase.find(x => x.albumID === id);
                        return { name: a ? a.title : "Unknown", img: a ? a.paths.cover : "" };
                    }, 'album')}
                </div>
                <div class="w-col">
                    <h3>Top 10 Genres</h3>
                    ${buildList(tGenres, name => ({ name: name, img: "" }), 'genre')}
                </div>
            </div>
            
            <div class="w-footer">
                <div>Average Musical Era: <strong>${avgYear}</strong></div>
                <div>Peak Listening Time: <strong>${formatHour(peakHour)}</strong></div>
            </div>
        </div>
    `;
};

// Download logic and backend response hook
window.downloadRewindPoster = function() {
    const poster = document.querySelector('.Rewind-poster');
    if (!poster) return alert("Please generate a Rewind poster first!");
    
    // We send the precise location of the poster div to Electron to take the screenshot
    const bounds = poster.getBoundingClientRect();
    ipcRenderer.send('download-Rewind-poster', {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
    });
};

ipcRenderer.on('backend-reply', (event, msg) => {
    if (msg.includes('Rewind')) window.alert(msg);
});