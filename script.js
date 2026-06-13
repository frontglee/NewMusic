// ==========================================
// 1. TOP-LEVEL CONFIG & SETUP (Must be first)
// ==========================================
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const PC_SYNC_KEY_STORAGE = 'newmusicPCSyncKey';
let pcSyncServerState = null;
let pcSyncBuildStatus = '';
let pcSyncSetupStatus = null;
let pcSyncSetupMessage = '';

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function generateSyncKey() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0').toUpperCase()).join('').match(/.{1,4}/g).join('-');
}

function getSyncKey() {
    let key = localStorage.getItem(PC_SYNC_KEY_STORAGE);
    if (!key) {
        key = generateSyncKey();
        localStorage.setItem(PC_SYNC_KEY_STORAGE, key);
    }
    return key;
}

async function ensurePCSyncServerRunning(options = {}) {
    const status = await ipcRenderer.invoke('sync-server-start', { key: getSyncKey() });
    if (status?.error) {
        if (!options.quiet) alert(status.error);
        pcSyncServerState = status;
        return status;
    }
    pcSyncServerState = status;
    return status;
}

async function refreshPCSyncServerStatus() {
    pcSyncServerState = await ipcRenderer.invoke('sync-server-status');
    return pcSyncServerState;
}

async function refreshPCSyncSetupStatus() {
    pcSyncSetupStatus = await ipcRenderer.invoke('sync-setup-status');
    return pcSyncSetupStatus;
}

window.checkPCSyncSetup = async function() {
    pcSyncSetupMessage = 'Checking sync setup...';
    renderSettingsView();

    await refreshPCSyncSetupStatus();
    if (pcSyncSetupStatus?.configured) {
        pcSyncSetupMessage = 'Sync setup is ready.';
        await ensurePCSyncServerRunning({ quiet: true });
    } else {
        pcSyncSetupMessage = pcSyncSetupStatus?.message || pcSyncSetupStatus?.error || 'Sync setup is not ready yet.';
    }
    renderSettingsView();
};

window.runPCSyncFirstTimeSetup = async function() {
    pcSyncSetupMessage = 'Opening Windows sync setup... approve the admin prompt if it appears.';
    renderSettingsView();

    const result = await ipcRenderer.invoke('sync-run-first-time-setup');
    if (result?.error) {
        pcSyncSetupMessage = `Could not start setup: ${result.error}`;
    } else {
        pcSyncSetupMessage = 'Finish the setup window, then click Check Setup.';
    }
    renderSettingsView();
};

window.startPCSyncServer = async function() {
    await ensurePCSyncServerRunning();
    renderSettingsView();
};

window.stopPCSyncServer = async function() {
    pcSyncServerState = await ipcRenderer.invoke('sync-server-stop');
    renderSettingsView();
};

window.rebuildMobileSyncBundle = async function() {
    pcSyncBuildStatus = 'Building mobile bundle... The app may pause while audio is converted.';
    renderSettingsView();

    const result = await ipcRenderer.invoke('sync-build-mobile-bundle');
    if (result?.error) {
        pcSyncBuildStatus = `Mobile bundle build failed: ${result.error}`;
        renderSettingsView();
        return;
    }

    const counts = result.manifest?.counts || {};
    pcSyncBuildStatus = `Mobile bundle ready: ${counts.songs || 0} songs, ${counts.files || 0} files.`;
    await ensurePCSyncServerRunning({ quiet: true });
    renderSettingsView();
};

window.copySyncUrl = async function(url) {
    try {
        await navigator.clipboard.writeText(url);
        alert('Sync URL copied.');
    } catch (err) {
        alert(url);
    }
};

window.regenerateSyncKey = function() {
    showCustomConfirm('Create a new sync key? The old key will stop pairing new mobile sync sessions.', async () => {
        const wasRunning = pcSyncServerState?.running;
        localStorage.setItem(PC_SYNC_KEY_STORAGE, generateSyncKey());
        if (wasRunning) {
            await ipcRenderer.invoke('sync-server-stop');
            await ensurePCSyncServerRunning({ quiet: true });
        }
        renderSettingsView();
    });
};

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
        // REMOVED handleRouting() from here to prevent race condition
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
        <div class="modal-box" style="width:360px; padding: 28px; text-align: center;">
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
            <div class="modal-box" style="width:360px; padding: 28px; text-align: center;">
                <p style="color: var(--text-main); margin: 0 0 24px 0; font-size: 15px;">${msg}</p>
                <input type="password" id="prompt-input" style="width:100%; padding: 10px; margin-bottom: 20px; background: var(--bg-surface); border:1px solid var(--border-color); color: var(--text-main); border-radius:4px;">
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
        <div class="modal-box" style="width:380px; padding: 28px;">
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
const fadeNode = audioCtx.createGain();

// Route directly: Source -> Fade -> Speakers
audioSource.connect(fadeNode);
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
// Replace the existing definitions with these:
let isSyncedLyrics = localStorage.getItem('isSyncedLyrics') !== 'false'; // Defaults to true
let isAutoplay = localStorage.getItem('isAutoplay') !== 'false'; // Defaults to true

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
function getSongReleaseDate(song, album = null) {
    if (song && song.releaseDate) return song.releaseDate;
    if (album && album.releaseDate) return album.releaseDate;
    return '';
}

function getSongReleaseYear(song, album = null) {
    const date = getSongReleaseDate(song, album);
    const year = date ? parseInt(String(date).substring(0, 4)) : 0;
    return !isNaN(year) && year > 1000 ? year : 0;
}

let validAlbumYears = albumsDatabase.map(a => a.releaseDate ? parseInt(a.releaseDate.substring(0, 4)) : 0).filter(y => y > 1000);
let minAlbumYear = validAlbumYears.length > 0 ? Math.min(...validAlbumYears) : 1950;
let maxAlbumYear = validAlbumYears.length > 0 ? Math.max(...validAlbumYears) : new Date().getFullYear();

let validSongYears = songsDatabase.map(song => {
    const album = albumsDatabase.find(a => a.albumID === song.albumID);
    return getSongReleaseYear(song, album);
}).filter(y => y > 1000);
let minSongYear = validSongYears.length > 0 ? Math.min(...validSongYears) : minAlbumYear;
let maxSongYear = validSongYears.length > 0 ? Math.max(...validSongYears) : maxAlbumYear;

let validArtistYears = artistsDatabase.map(a => parseInt(a.startYear)).filter(y => !isNaN(y) && y > 1000);
let minArtistYear = validArtistYears.length > 0 ? Math.min(...validArtistYears) : 1950;
let maxArtistYear = validArtistYears.length > 0 ? Math.max(...validArtistYears) : new Date().getFullYear();

let artistState = { search: "", sortBy: "firstlistenYear", sortDir: "desc", yearRange: { min: minArtistYear, max: maxArtistYear }, filters: { genre: [], tag: [], country: [], startYear: [], firstlistenYear: [] } };
let albumState = { searchAlbum: "", searchArtist: "", sortBy: "firstlistenDate", sortDir: "desc", releaseType: 0, yearRange: { min: minAlbumYear, max: maxAlbumYear }, filters: { artist: [], genre: [], tag: [], year: [] } };
let songState = { search: "", sortBy: "title", sortDir: "asc", yearRange: { min: minSongYear, max: maxSongYear }, filters: { artist: [], year: [], genre: [], tag: [] } };

let currentAlbumSort = { by: 'track', dir: 'asc' }; 
window.currentGlobalSongsList = [];

const REWIND_THEME_OPTIONS = [
    { label: 'Deep Space (Default)', value: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)' },
    { label: 'Crimson Velvet', value: 'linear-gradient(135deg, #1f000b, #4a0018, #1a0008)' },
    { label: 'Matrix Green', value: 'linear-gradient(135deg, #05190b, #0d381b, #071f0f)' },
    { label: 'Monochrome Slate', value: 'linear-gradient(135deg, #1e1e1e, #2c2c2c, #121212)' }
];

function loadRewindSettings() {
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem('rewindSettings') || '{}') || {};
    } catch (e) {}

    const validRank = value => value === 'plays' || value === 'time';
    const savedSorts = saved.sorts || {};

    return {
        sorts: {
            songs: validRank(savedSorts.songs) ? savedSorts.songs : 'time',
            artists: validRank(savedSorts.artists) ? savedSorts.artists : 'time',
            albums: validRank(savedSorts.albums) ? savedSorts.albums : 'time',
            genres: validRank(savedSorts.genres) ? savedSorts.genres : 'time'
        },
        theme: REWIND_THEME_OPTIONS.some(theme => theme.value === saved.theme)
            ? saved.theme
            : REWIND_THEME_OPTIONS[0].value
    };
}

let rewindSettings = loadRewindSettings();

function saveRewindSettings() {
    localStorage.setItem('rewindSettings', JSON.stringify(rewindSettings));
}

function refreshOpenRewindPoster() {
    if (document.querySelector('.Rewind-poster') && window.lastRewindType) {
        generateRewindData(window.lastRewindType, window.lastRewindVal);
    }
}

window.setRewindRankMode = function(section, value) {
    if (!rewindSettings.sorts.hasOwnProperty(section)) return;
    rewindSettings.sorts[section] = value === 'plays' ? 'plays' : 'time';
    saveRewindSettings();
    refreshOpenRewindPoster();
};

window.setRewindTheme = function(value) {
    if (!REWIND_THEME_OPTIONS.some(theme => theme.value === value)) return;
    rewindSettings.theme = value;
    saveRewindSettings();
    refreshOpenRewindPoster();
};

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
function buildMultiSelect(id, label, optionsMap, sortDir = 'asc', selectedValues = []) {
    const isArtistYearFilter = id === 'ms-startYear' || id === 'ms-firstlisten';

    let entries = Object.entries(optionsMap || {})
        .filter(([val]) => val !== undefined && val !== null && String(val).trim() !== '')
        .map(([val, count]) => [String(val), Number(count) || 0]);

    if (sortDir === 'random') {
        entries = shuffleArray(entries);
    } else if (isArtistYearFilter) {
        entries.sort((a, b) => {
            const yearA = parseInt(a[0]) || 0;
            const yearB = parseInt(b[0]) || 0;
            return sortDir === 'asc' ? yearB - yearA : yearA - yearB;
        });
    } else {
        entries.sort((a, b) => {
            if (a[1] !== b[1]) return sortDir === 'desc' ? a[1] - b[1] : b[1] - a[1];
            return a[0].localeCompare(b[0]);
        });
    }

    const selected = new Set((selectedValues || []).map(String));

    let optionsHtml = entries.map(([val, count]) => {
        const checked = selected.has(val) ? 'checked' : '';
        const countHtml = isArtistYearFilter ? '' : ` <span style="color: var(--text-muted);">(${count})</span>`;
        return `<label><input type="checkbox" value="${val}" ${checked}> ${val}${countHtml}</label>`;
    }).join('');

    return `<div id="${id}" class="multi-select"><div class="anchor">${label} <span>▼</span></div><div class="items">${optionsHtml}</div></div>`;
}


function getMultiSelectOptionCount(label) {
    const countText = label.querySelector('span')?.textContent || '';
    const match = countText.match(/\((\d+)\)/);
    return match ? Number(match[1]) : 0;
}

function sortMultiSelectOptions(id, sortDir) {
    const items = document.querySelector(`#${id} .items`);
    if (!items) return;

    const isArtistYearFilter = id === 'ms-startYear' || id === 'ms-firstlisten';

    let labels = Array.from(items.querySelectorAll('label'));
    if (sortDir === 'random') {
        labels = shuffleArray(labels);
    } else if (isArtistYearFilter) {
        labels.sort((a, b) => {
            const yearA = parseInt(a.querySelector('input')?.value || '0') || 0;
            const yearB = parseInt(b.querySelector('input')?.value || '0') || 0;
            return sortDir === 'asc' ? yearB - yearA : yearA - yearB;
        });
    } else {
        labels.sort((a, b) => {
            const countDiff = getMultiSelectOptionCount(a) - getMultiSelectOptionCount(b);
            if (countDiff !== 0) return sortDir === 'desc' ? countDiff : -countDiff;

            const aValue = a.querySelector('input')?.value || '';
            const bValue = b.querySelector('input')?.value || '';
            return aValue.localeCompare(bValue);
        });
    }

    items.replaceChildren(...labels);
}

function updateMultiSelectOptionOrder(ids, sortDir) {
    ids.forEach(id => sortMultiSelectOptions(id, sortDir));
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

function formatLongDuration(totalSeconds) {
    const seconds = parseInt(totalSeconds, 10) || 0;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatByteSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = value / 1024;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`;
}

function getDirectorySize(folderPath) {
    try {
        if (!fs.existsSync(folderPath)) return 0;
        return fs.readdirSync(folderPath, { withFileTypes: true }).reduce((total, entry) => {
            const abs = path.join(folderPath, entry.name);
            if (entry.isDirectory()) return total + getDirectorySize(abs);
            if (entry.isFile()) return total + fs.statSync(abs).size;
            return total;
        }, 0);
    } catch (err) {
        console.warn('Could not calculate folder size:', err);
        return 0;
    }
}

function parseLibraryDate(value) {
    const raw = String(value || '').trim();
    if (!/^\d{4}(?:-\d{1,2})?(?:-\d{1,2})?$/.test(raw)) return null;
    const parts = raw.split('-').map(part => parseInt(part, 10));
    const year = parts[0];
    const month = parts[1] || 7;
    const day = parts[2] || 1;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatAverageReleaseDate(songs) {
    const timestamps = songs
        .map(song => parseLibraryDate(song.releaseDate || albumsDatabase.find(album => album.albumID === song.albumID)?.releaseDate))
        .filter(Boolean)
        .map(date => date.getTime());
    if (!timestamps.length) return 'Unknown';
    const average = timestamps.reduce((sum, value) => sum + value, 0) / timestamps.length;
    return new Date(average).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}
// 5.🎧 MASTER AUDIO & CONTROLS ENGINE
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
    if (!currentSong) { lyricsPanel.innerHTML = '<p style="color: var(--text-muted);">Select a track to view lyrics.</p>'; return; }
    if (currentSong.parsedLyrics) { renderLyricsToPanel(currentSong.parsedLyrics); return; }
    if (currentSong.paths && currentSong.paths.lyrics) {
        lyricsPanel.innerHTML = '<p style="color: var(--text-muted);">Loading lyrics...</p>';
        const checkingSongID = currentSong.songID; 
        const lyricsData = await fetchAndParseLRC(currentSong.paths.lyrics);
        if (currentSong.songID !== checkingSongID) return; 
        if (lyricsData && lyricsData.length > 0) { currentSong.parsedLyrics = lyricsData; renderLyricsToPanel(lyricsData); } 
        else { lyricsPanel.innerHTML = '<p style="color: var(--text-muted);">Failed to load lyrics.</p>'; }
    } else { lyricsPanel.innerHTML = '<p style="color: var(--text-muted);">No lyrics available for this track.</p>'; }
}

function toggleLyricsMode() {
    isSyncedLyrics = !isSyncedLyrics;
    localStorage.setItem('isSyncedLyrics', isSyncedLyrics); // Save to memory
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
    localStorage.setItem('isAutoplay', isAutoplay); // Save to memory
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
        progressBar.style.backgroundImage = `linear-gradient(to right, var(--accent-color) ${percentage}%, transparent ${percentage}%)`;
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
        e.target.style.backgroundImage = `linear-gradient(to right, var(--accent-color) ${e.target.value}%, transparent ${e.target.value}%)`;
    }
});

const volSlider = document.querySelector('.volume-slider');

// --- NEW: LOAD SAVED VOLUME ON BOOT ---
const savedVolume = localStorage.getItem('playerVolume');
if (savedVolume !== null) {
    audioPlayer.volume = parseFloat(savedVolume);
    volSlider.value = audioPlayer.volume * 100;
} else {
    audioPlayer.volume = volSlider.value / 100;
}
let previousVolume = audioPlayer.volume; 

volSlider.style.backgroundImage = `linear-gradient(to right, var(--accent-color) ${volSlider.value}%, transparent ${volSlider.value}%)`;

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
    
    // --- NEW: SAVE TO STORAGE ---
    localStorage.setItem('playerVolume', audioPlayer.volume);
    
    volSlider.value = audioPlayer.volume * 100;
    volSlider.style.backgroundImage = `linear-gradient(to right, var(--accent-color) ${volSlider.value}%, transparent ${volSlider.value}%)`;
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
        
        // --- NEW: SAVE MUTE STATE TO STORAGE ---
        localStorage.setItem('playerVolume', audioPlayer.volume);
        
        volSlider.style.backgroundImage = `linear-gradient(to right, var(--accent-color) ${volSlider.value}%, transparent ${volSlider.value}%)`;
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
let isTipsMode = localStorage.getItem('isTipsMode') !== 'false'; // Tips are on by default
let isSpotifyPlaylistImportEnabled = localStorage.getItem('isSpotifyPlaylistImportEnabled') === 'true';

function refreshTipsModeClass() {
    document.body.classList.toggle('tips-enabled', isTipsMode);
}

function setNewMusicTip(selector, text) {
    document.querySelectorAll(selector).forEach(el => {
        if (el) el.setAttribute('data-tip', text);
    });
}

function applyAppTips() {
    setNewMusicTip('#btn-autoplay', 'Toggle autoplay');
    setNewMusicTip('#bottom-player .extra-controls .icon-btn:nth-child(2)', 'Toggle synced lyrics or plain lyrics');
    setNewMusicTip('#bottom-player .extra-controls .icon-btn:nth-child(3)', 'Mute');
    setNewMusicTip('#bottom-player .buttons .icon-btn:nth-child(1)', 'Shuffle');
    setNewMusicTip('#bottom-player .buttons .icon-btn:nth-child(2)', 'Previous song');
    setNewMusicTip('#bottom-player .buttons .icon-btn:nth-child(4)', 'Next song');
    setNewMusicTip('#bottom-player .buttons .icon-btn:nth-child(5)', 'Replay mode');
    setNewMusicTip('#bottom-player .buttons .play-btn', 'Pause');
    setNewMusicTip('#btn-player-favorite', 'Add to favorites');
    setNewMusicTip('#btn-profile', 'Local accounts');
    refreshTipsModeClass();
}

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
    localStorage.removeItem('isAutoDLMode');
    localStorage.setItem('isExperimentalMode', 'true');

    const syncKey = getSyncKey();
    const syncSenderHtml = `
        <section class="sync-card">
            <div class="sync-header">
                <div>
                    <h3>PC to Mobile Sync</h3>
                    <p>One-way sync only. This PC sends the mobile library; the phone never pushes edits back.</p>
                </div>
                <span class="sync-status sync-status-dot ${pcSyncServerState?.running ? 'is-running' : ''}">
                    <span></span>${pcSyncServerState?.running ? 'Sender on' : 'Sender off'}
                </span>
            </div>
            <div class="sync-key-box">
                <span>${syncKey}</span>
                <button class="btn-secondary" onclick="regenerateSyncKey()">New Key</button>
            </div>
            <div class="sync-subpanel">
                <div class="sync-subpanel-header">
                    <div>
                        <h4>PC Sender</h4>
                        <p>Rebuild after changing the PC library, then sync from the phone with only the key.</p>
                    </div>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
                        <button class="btn-secondary" onclick="rebuildMobileSyncBundle()">Rebuild Mobile Bundle</button>
                        <button class="btn-secondary" onclick="${pcSyncServerState?.running ? 'stopPCSyncServer()' : 'startPCSyncServer()'}">
                            ${pcSyncServerState?.running ? 'Stop Sender' : 'Start Sender'}
                        </button>
                    </div>
                </div>
                ${pcSyncBuildStatus ? `<p class="sync-note">${escapeHTML(pcSyncBuildStatus)}</p>` : ''}
                ${pcSyncServerState?.running ? `
                    <p class="sync-note">Ready. NewMusic PE can find this PC automatically when the key matches.</p>
                ` : `
                    <p class="sync-note">The sender is closed. Open this PC app with a built mobile bundle, then start it if auto-start did not.</p>
                `}
            </div>
            <ul class="sync-rules">
                <li>The phone only needs this key and the same network.</li>
                <li>Every request needs the secret key.</li>
                <li>Only the mobile manifest and listed mobile files can be downloaded.</li>
            </ul>
        </section>
    `;
    const syncSetupHtml = `
        <section class="sync-card">
            <div class="sync-header">
                <div>
                    <h3>PC to Mobile Sync</h3>
                    <p>Run the first-time Windows setup before starting the phone sender.</p>
                </div>
                <span class="sync-status sync-status-dot">
                    <span></span>Setup needed
                </span>
            </div>
            <div class="sync-subpanel">
                <div class="sync-subpanel-header">
                    <div>
                        <h4>First-Time Setup</h4>
                        <p>Adds the Windows Firewall rules NewMusic needs for phone sync on Private networks.</p>
                    </div>
                    <div class="sync-actions-inline">
                        <button class="btn-primary" onclick="runPCSyncFirstTimeSetup()">Set Up Sync</button>
                        <button class="btn-secondary" onclick="checkPCSyncSetup()">Check Setup</button>
                    </div>
                </div>
                <p class="sync-note">${escapeHTML(pcSyncSetupMessage || pcSyncSetupStatus?.message || pcSyncSetupStatus?.error || 'Setup has not been checked yet.')}</p>
            </div>
        </section>
    `;
    const syncSectionHtml = pcSyncSetupStatus?.configured ? syncSenderHtml : syncSetupHtml;

    contentArea.innerHTML = `
        <h1 class="header-title">Settings</h1>
        <div style="background: var(--bg-elevated); padding: 24px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 24px;">
            
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; font-size: 18px; color: var(--text-main);">Enable Database Editor</h3>
                    <p style="margin: 5px 0 0 0; color: var(--text-muted); font-size: 14px;">Displays a gear icon next to all database items. Allows you to safely rewrite names, images, genres, and paths directly.</p>
                </div>
                <label style="position: relative; display: inline-block; width: 50px; height: 28px;">
                    <input type="checkbox" id="toggle-edit-mode" ${isEditMode ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                    <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isEditMode ? 'var(--accent-color)' : 'var(--bg-surface-strong)'}; transition: .4s; border-radius: 34px;">
                        <span style="position: absolute; content: ''; height: 20px; width: 20px; left: 4px; bottom: 4px; background-color: ${isEditMode ? 'var(--accent-contrast)' : 'var(--text-main)'}; transition: .4s; border-radius: 50%; transform: ${isEditMode ? 'translateX(22px)' : 'none'};"></span>
                    </span>
                </label>
            </div>

            <div style="height: 1px; background: var(--border-color); width: 100%;"></div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; font-size: 18px; color: var(--text-main);">Enable Tips</h3>
                    <p style="margin: 5px 0 0 0; color: var(--text-muted); font-size: 14px;">Shows short explanations when you hover over buttons for about 2 seconds.</p>
                </div>
                <label style="position: relative; display: inline-block; width: 50px; height: 28px;">
                    <input type="checkbox" id="toggle-tips-mode" ${isTipsMode ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                    <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isTipsMode ? 'var(--accent-color)' : 'var(--bg-surface-strong)'}; transition: .4s; border-radius: 34px;">
                        <span style="position: absolute; content: ''; height: 20px; width: 20px; left: 4px; bottom: 4px; background-color: ${isTipsMode ? 'var(--accent-contrast)' : 'var(--text-main)'}; transition: .4s; border-radius: 50%; transform: ${isTipsMode ? 'translateX(22px)' : 'none'};"></span>
                    </span>
                </label>
            </div>

            <div style="height: 1px; background: var(--border-color); width: 100%;"></div>

            <div style="display: flex; justify-content: space-between; align-items: center; gap: 18px;">
                <div>
                    <h3 style="margin: 0; font-size: 18px; color: var(--text-main);">Enable Playlist Import</h3>
                    <p style="margin: 5px 0 0 0; color: var(--text-muted); font-size: 14px;">Adds the playlist importer to the Admin Tool for CSV/TXT tracklists, YouTube matching, and batch downloads.</p>
                </div>
                <label style="position: relative; display: inline-block; width: 50px; height: 28px; flex: 0 0 auto;">
                    <input type="checkbox" id="toggle-spotify-import" ${isSpotifyPlaylistImportEnabled ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                    <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isSpotifyPlaylistImportEnabled ? 'var(--accent-color)' : 'var(--bg-surface-strong)'}; transition: .4s; border-radius: 34px;">
                        <span style="position: absolute; content: ''; height: 20px; width: 20px; left: 4px; bottom: 4px; background-color: ${isSpotifyPlaylistImportEnabled ? 'var(--accent-contrast)' : 'var(--text-main)'}; transition: .4s; border-radius: 50%; transform: ${isSpotifyPlaylistImportEnabled ? 'translateX(22px)' : 'none'};"></span>
                    </span>
                </label>
            </div>

            <div style="height: 1px; background: var(--border-color); width: 100%;"></div>

<div style="display: flex; flex-direction: column; gap: 12px;">
<div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; font-size: 18px; color: var(--text-main);">Application Theme</h3>
                    <p style="margin: 5px 0 0 0; color: var(--text-muted); font-size: 14px;">Pick a visual mood for the app.</p>
                </div>
                <select id="theme-selector" class="ctrl-select" style="width: 150px;" onchange="changeAppTheme(this.value)">
                    <option value="default" ${localStorage.getItem('appTheme') === 'default' ? 'selected' : ''}>Classic Dark</option>
                    <option value="theme-midnight" ${localStorage.getItem('appTheme') === 'theme-midnight' ? 'selected' : ''}>Ink Bloom</option>
                    <option value="theme-rose" ${localStorage.getItem('appTheme') === 'theme-rose' ? 'selected' : ''}>Velvet Bloom</option>
                    <option value="theme-neon" ${localStorage.getItem('appTheme') === 'theme-neon' ? 'selected' : ''}>Aurora</option>
                    <option value="theme-graphite" ${localStorage.getItem('appTheme') === 'theme-graphite' ? 'selected' : ''}>Graphite</option>
                    <option value="theme-dusk" ${localStorage.getItem('appTheme') === 'theme-dusk' ? 'selected' : ''}>Dusk</option>
                    <option value="theme-light" ${localStorage.getItem('appTheme') === 'theme-light' ? 'selected' : ''}>Daybreak</option>
                    <option value="theme-fresh" ${localStorage.getItem('appTheme') === 'theme-fresh' ? 'selected' : ''}>Fresh Air</option>
                </select>
            </div>
            
            </div>
            
                        <div style="height: 1px; background: var(--border-color); width: 100%;"></div>
            ${syncSectionHtml}

            <div style="height: 1px; background: var(--border-color); width: 100%;"></div>
            <div style="display: flex; flex-direction: column; gap: 12px; background: rgba(255,0,0,0.05); padding: 16px; border-radius: 8px; border: 1px solid rgba(255,0,0,0.2);">
                <h3 style="margin: 0; font-size: 18px; color: #ff0050;">Danger Zone: Delete Profile</h3>
                <p style="margin: 0; color: var(--text-muted); font-size: 14px;">This will permanently delete the active profile and all its playlists/data. Type your profile name <strong style="color: var(--text-main);">${currentAccount ? currentAccount.name : 'None'}</strong> to confirm.</p>
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

    document.getElementById('toggle-tips-mode').addEventListener('change', (e) => {
        isTipsMode = e.target.checked;
        localStorage.setItem('isTipsMode', isTipsMode);
        refreshTipsModeClass();
        renderSettingsView();
    });

    document.getElementById('toggle-spotify-import').addEventListener('change', (e) => {
        isSpotifyPlaylistImportEnabled = e.target.checked;
        localStorage.setItem('isSpotifyPlaylistImportEnabled', isSpotifyPlaylistImportEnabled);
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
            <div style="background: var(--bg-elevated); width: 600px; max-height: 85vh; border-radius: 8px; border: 1px solid var(--border-color); display: flex; flex-direction: column;">
                <div style="padding: 20px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <h2 style="margin: 0; font-size: 20px;">Edit ${type.toUpperCase()} Data</h2>
                </div>
                <div style="padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;" id="edit-form-container"></div>
                
                <div style="padding: 20px; border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
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
    
        if ((type === 'song' || type === 'album') && !Object.prototype.hasOwnProperty.call(currentEditItem, 'releaseDate')) {
        currentEditItem.releaseDate = '';
    }

    if (type === 'album' && !Object.prototype.hasOwnProperty.call(currentEditItem, 'firstlistenDate')) {
        currentEditItem.firstlistenDate = '';
    }

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

function getDatabaseInfoForType(type) {
    if (type === 'artist') return { file: 'database_artists.js', idKey: 'artistID' };
    if (type === 'album') return { file: 'database_albums.js', idKey: 'albumID' };
    if (type === 'song') return { file: 'database_songs.js', idKey: 'songID' };
    return null;
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeSurgicalValue(value) {
    if (Array.isArray(value)) {
        return `[${value.map(item => JSON.stringify(item)).join(', ')}]`;
    }

    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value === null) return 'null';

    return JSON.stringify(value ?? '');
}

function findMatchingBrace(text, openIndex) {
    let depth = 0;
    let inString = false;
    let quote = '';
    let escaped = false;

    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === quote) {
                inString = false;
                quote = '';
            }
            continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
            inString = true;
            quote = ch;
            continue;
        }

        if (ch === '{') depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) return i + 1;
        }
    }

    return -1;
}

function findDatabaseObjectBlock(content, idKey, idValue) {
    const idPattern = new RegExp(`["']?${escapeRegExp(idKey)}["']?\\s*:\\s*["']${escapeRegExp(idValue)}["']`);
    const match = content.match(idPattern);
    if (!match) return null;

    const idIndex = match.index;
    const start = content.lastIndexOf('{', idIndex);
    if (start === -1) return null;

    const end = findMatchingBrace(content, start);
    if (end === -1) return null;

    return {
        start,
        end,
        text: content.slice(start, end)
    };
}

function hasTopLevelProperty(block, key) {
    const propRegex = new RegExp(`^\\s*["']?${escapeRegExp(key)}["']?\\s*:`, 'm');
    return propRegex.test(block);
}

function getIndentForBlock(block) {
    const indentMatch = block.match(/\n(\s+)["']?[\w$]+["']?\s*:/);
    return indentMatch ? indentMatch[1] : '  ';
}

function replaceOrInsertTopLevelProperty(block, key, value, afterKey = null) {
    const serialized = serializeSurgicalValue(value);
    const propRegex = new RegExp(`(^\\s*["']?${escapeRegExp(key)}["']?\\s*:\\s*)[^\\n]*(,?\\s*)$`, 'm');

    if (propRegex.test(block)) {
        return block.replace(propRegex, `$1${serialized}$2`);
    }

    const indent = getIndentForBlock(block);
    const newLine = `\n${indent}${key}: ${serialized},`;

    if (afterKey) {
        const afterRegex = new RegExp(`(^\\s*["']?${escapeRegExp(afterKey)}["']?\\s*:\\s*[^\\n]*,?\\s*$)`, 'm');
        if (afterRegex.test(block)) {
            return block.replace(afterRegex, `$1${newLine}`);
        }
    }

    return block.replace(/\n\s*}$/, `${newLine}$&`);
}

function replaceNestedProperty(block, parentKey, childKey, value) {
    const parentRegex = new RegExp(`["']?${escapeRegExp(parentKey)}["']?\\s*:\\s*{`);
    const parentMatch = parentRegex.exec(block);
    if (!parentMatch) return block;

    const parentOpen = parentMatch.index + parentMatch[0].lastIndexOf('{');
    const parentEnd = findMatchingBrace(block, parentOpen);
    if (parentEnd === -1) return block;

    let parentBlock = block.slice(parentOpen, parentEnd);
    const serialized = serializeSurgicalValue(value);
    const childRegex = new RegExp(`(^\\s*["']?${escapeRegExp(childKey)}["']?\\s*:\\s*)[^\\n]*(,?\\s*)$`, 'm');

    if (childRegex.test(parentBlock)) {
        parentBlock = parentBlock.replace(childRegex, `$1${serialized}$2`);
    } else {
        const indent = getIndentForBlock(parentBlock);
        parentBlock = parentBlock.replace(/\n\s*}$/, `\n${indent}${childKey}: ${serialized},$&`);
    }

    return block.slice(0, parentOpen) + parentBlock + block.slice(parentEnd);
}

function getInsertAfterKey(type, key) {
    if (type === 'song' && key === 'releaseDate') return 'track';
    if (type === 'album' && key === 'releaseDate') return 'artistID';
    if (type === 'album' && key === 'firstlistenDate') return 'releaseDate';
    return null;
}

function patchDatabaseObjectText(type, idValue, changes) {
    const info = getDatabaseInfoForType(type);
    if (!info) throw new Error(`Unknown database type: ${type}`);

    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, info.file);

    let content = fs.readFileSync(filePath, 'utf8');
    const blockData = findDatabaseObjectBlock(content, info.idKey, idValue);

    if (!blockData) {
        throw new Error(`Could not find ${type} with ${info.idKey}: ${idValue}`);
    }

    let block = blockData.text;

    changes.forEach(change => {
        if (change.parentKey) {
            block = replaceNestedProperty(block, change.parentKey, change.key, change.value);
        } else {
            block = replaceOrInsertTopLevelProperty(
                block,
                change.key,
                change.value,
                getInsertAfterKey(type, change.key)
            );
        }
    });

    return {
        file: info.file,
        data: content.slice(0, blockData.start) + block + content.slice(blockData.end)
    };
}

function removeDatabaseObjectBlock(content, idKey, idValue) {
    const blockData = findDatabaseObjectBlock(content, idKey, idValue);
    if (!blockData) return content;

    const after = content.slice(blockData.end);
    const afterComma = after.match(/^(\s*,)/);
    if (afterComma) {
        return content.slice(0, blockData.start) + content.slice(blockData.end + afterComma[1].length);
    }

    const before = content.slice(0, blockData.start);
    const beforeComma = before.match(/,\s*$/);
    if (beforeComma) {
        return content.slice(0, before.length - beforeComma[0].length) + content.slice(blockData.end);
    }

    return content.slice(0, blockData.start) + content.slice(blockData.end);
}

function deleteDatabaseObjectsText(file, idKey, ids) {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, file);

    let content = fs.readFileSync(filePath, 'utf8');

    ids.forEach(id => {
        content = removeDatabaseObjectBlock(content, idKey, id);
    });

    return content;
}

window.deleteEditItem = function() {
    if (!currentEditItem) return;
    
    showCustomConfirm(`⚠️ WARNING: Are you sure you want to permanently delete this ${currentEditType} AND ALL associated files and folders? This cannot be undone.`, () => {
        
        let filesToDelete = [];
        let foldersToDelete = [];

        let artistIDsToDelete = [];
        let albumIDsToDelete = [];
        let songIDsToDelete = [];

        if (currentEditType === 'artist') {
            const artID = currentEditItem.artistID;
            const artistSlug = artID.replace('art_', '');

            artistIDsToDelete.push(artID);
            albumIDsToDelete = albumsDatabase.filter(a => a.artistID === artID).map(a => a.albumID);
            songIDsToDelete = songsDatabase.filter(s => s.artistID === artID).map(s => s.songID);

            foldersToDelete.push(`./assets/${artistSlug}`);

            for (let i = songsDatabase.length - 1; i >= 0; i--) {
                if (songsDatabase[i].artistID === artID) songsDatabase.splice(i, 1);
            }

            for (let i = albumsDatabase.length - 1; i >= 0; i--) {
                if (albumsDatabase[i].artistID === artID) albumsDatabase.splice(i, 1);
            }

            const index = artistsDatabase.findIndex(a => a.artistID === artID);
            if (index > -1) artistsDatabase.splice(index, 1);
        }
        else if (currentEditType === 'album') {
            const albID = currentEditItem.albumID;

            albumIDsToDelete.push(albID);
            songIDsToDelete = songsDatabase.filter(s => s.albumID === albID).map(s => s.songID);

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
        }
        else if (currentEditType === 'song') {
            const sID = currentEditItem.songID;
            const albID = currentEditItem.albumID;

            songIDsToDelete.push(sID);

            if (currentEditItem.paths) {
                if (currentEditItem.paths.audio) filesToDelete.push(currentEditItem.paths.audio);
                if (currentEditItem.paths.lyrics) filesToDelete.push(currentEditItem.paths.lyrics);
            }

            const index = songsDatabase.findIndex(s => s.songID === sID);
            if (index > -1) songsDatabase.splice(index, 1);

            const remainingSongs = songsDatabase.filter(s => s.albumID === albID);
            if (remainingSongs.length === 0) {
                const albIndex = albumsDatabase.findIndex(a => a.albumID === albID);
                if (albIndex > -1) {
                    const alb = albumsDatabase[albIndex];
                    albumIDsToDelete.push(alb.albumID);

                    if (alb.paths && alb.paths.cover) filesToDelete.push(alb.paths.cover);
                    albumsDatabase.splice(albIndex, 1);
                }
            }
        }

        const payload = { filesToDelete, foldersToDelete, databases: {} };

        try {
            if (artistIDsToDelete.length > 0) {
                payload.databases['database_artists.js'] = deleteDatabaseObjectsText('database_artists.js', 'artistID', artistIDsToDelete);
            }

            if (albumIDsToDelete.length > 0) {
                payload.databases['database_albums.js'] = deleteDatabaseObjectsText('database_albums.js', 'albumID', albumIDsToDelete);
            }

            if (songIDsToDelete.length > 0) {
                payload.databases['database_songs.js'] = deleteDatabaseObjectsText('database_songs.js', 'songID', songIDsToDelete);
            }
        } catch (err) {
            alert(`Database delete failed: ${err.message}`);
            return;
        }

        const deletedArtistID = currentEditItem.artistID;
        const deletedAlbumID = currentEditItem.albumID;

        ipcRenderer.send('execute-nuclear-delete', payload);
        closeEditModal();
        
        if ((deletedArtistID && window.location.hash.includes(deletedArtistID)) || (deletedAlbumID && window.location.hash.includes(deletedAlbumID))) window.location.hash = ''; 
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

    const editType = currentEditType;
    const info = getDatabaseInfoForType(editType);
    if (!info) return;

    const idValue = currentEditItem[info.idKey];
    const changes = [];

    for (const [key, value] of Object.entries(currentEditItem)) {
        if (['artistID', 'albumID', 'songID'].includes(key)) continue;
        if (key === 'trackcount' || key === 'duration') continue;

        if (typeof value === 'object' && value !== null) {
            if (Array.isArray(value)) {
                const input = document.getElementById(`edit-input-${key}`);
                if (!input) continue;

                const newValue = input.value
                    ? input.value.split(',').map(s => s.trim()).filter(s => s !== '')
                    : [];

                currentEditItem[key] = newValue;
                changes.push({ key, value: newValue });
            } else {
                for (const [pKey] of Object.entries(value)) {
                    const input = document.getElementById(`edit-input-paths-${pKey}`);
                    if (!input) continue;

                    currentEditItem[key][pKey] = input.value;
                    changes.push({ parentKey: key, key: pKey, value: input.value });
                }
            }
        } else {
            const input = document.getElementById(`edit-input-${key}`);
            if (!input) continue;

            const inputVal = input.value;
            const newValue = typeof value === 'number' ? Number(inputVal) || 0 : inputVal;

            currentEditItem[key] = newValue;
            changes.push({ key, value: newValue });
        }
    }

    if (editType === 'song') {
        const releaseInput = document.getElementById('edit-input-releaseDate');
        currentEditItem.releaseDate = releaseInput ? releaseInput.value : (currentEditItem.releaseDate || '');
        changes.push({ key: 'releaseDate', value: currentEditItem.releaseDate });
    }

    if (editType === 'album') {
        const releaseInput = document.getElementById('edit-input-releaseDate');
        const firstListenInput = document.getElementById('edit-input-firstlistenDate');

        currentEditItem.releaseDate = releaseInput ? releaseInput.value : (currentEditItem.releaseDate || '');
        currentEditItem.firstlistenDate = firstListenInput ? firstListenInput.value : (currentEditItem.firstlistenDate || '');

        changes.push({ key: 'releaseDate', value: currentEditItem.releaseDate });
        changes.push({ key: 'firstlistenDate', value: currentEditItem.firstlistenDate });
    }

    try {
        const patched = patchDatabaseObjectText(editType, idValue, changes);
        ipcRenderer.send('save-database', patched);
    } catch (err) {
        alert(`Database save failed: ${err.message}`);
        return;
    }

    closeEditModal();
    handleRouting(); 
}

function renderHomeView() { 
    const hour = new Date().getHours();
    let greeting = "Good Evening";
    if (hour < 12) greeting = "Good Morning";
    else if (hour < 18) greeting = "Good Afternoon";

    const albumReleases = albumsDatabase.filter(album => {
        const type = String(album.albumType || 'album').toLowerCase();
        return type === 'album' || type === 'lp';
    });
    const totalArtists = artistsDatabase.length;
    const totalAlbums = albumReleases.length;
    const totalSongs = songsDatabase.length;
    const totalDuration = songsDatabase.reduce((sum, song) => sum + (parseInt(song.duration, 10) || 0), 0);
    const averageDuration = totalSongs ? Math.round(totalDuration / totalSongs) : 0;
    const assetsSize = formatByteSize(getDirectorySize(path.join(__dirname, 'assets')));
    const averageReleaseDate = formatAverageReleaseDate(songsDatabase);
    const homeStats = [
        { label: 'Songs', value: totalSongs.toLocaleString(), detail: 'tracks in library' },
        { label: 'Albums', value: totalAlbums.toLocaleString(), detail: 'saved albums' },
        { label: 'Artists', value: totalArtists.toLocaleString(), detail: 'artist folders' },
        { label: 'Assets Size', value: assetsSize, detail: './assets/' },
        { label: 'Total Runtime', value: formatLongDuration(totalDuration), detail: 'all songs combined' },
        { label: 'Avg Song Length', value: formatTime(averageDuration), detail: 'mean track duration' },
        { label: 'Avg Release Date', value: averageReleaseDate, detail: 'across dated songs' },
    ];

    const recentAlbums = [...albumReleases]
        .filter(a => a.releaseDate)
        .sort((a, b) => (parseLibraryDate(b.releaseDate)?.getTime() || 0) - (parseLibraryDate(a.releaseDate)?.getTime() || 0))
        .slice(0, 6);

    const randomAlbums = shuffleArray([...albumReleases]).slice(0, 6);

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
        <div style="margin-bottom: 28px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
                <div id="live-clock" style="font-family: monospace; color: var(--text-muted); font-size: 16px; margin-bottom: 4px; letter-spacing: 2px;"></div>
                
                <h1 class="header-title" style="font-size: 48px; margin-bottom: 8px; letter-spacing: 0;">${greeting}.</h1>
            </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; border-bottom: 1px solid #282828; padding-bottom: 12px;">
            <h2 class="artist-section-title" style="margin: 0; border: none; padding: 0; font-size: 22px;">Recent Albums</h2>
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

        <div class="home-stats-grid">
            ${homeStats.map(stat => `
                <div class="home-stat-card">
                    <div class="home-stat-label">${stat.label}</div>
                    <div class="home-stat-value">${stat.value}</div>
                    <div class="home-stat-detail">${stat.detail}</div>
                </div>
            `).join('')}
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
    // 1. Initializing as Objects for counting
    let allArtists = {}, allYears = {}, allGenres = {}, allTags = {};
    
    let sourceSongs = songsDatabase;
    if (isFavorites) {
        if (!currentAccount || !currentAccount.favorites) sourceSongs = [];
        else sourceSongs = songsDatabase.filter(s => currentAccount.favorites.includes(s.songID));
    }

    // 2. Logic to populate counts
    sourceSongs.forEach(song => {
        const album = albumsDatabase.find(a => a.albumID === song.albumID);
        const artistName = getArtistName(song.artistID);
        
        allArtists[artistName] = (allArtists[artistName] || 0) + 1;
        
                const songYear = getSongReleaseYear(song, album);
        if (songYear) {
            allYears[String(songYear)] = (allYears[String(songYear)] || 0) + 1;
        }
        
        if (song.genre) song.genre.forEach(g => allGenres[g] = (allGenres[g] || 0) + 1);
        if (song.tags) song.tags.forEach(t => allTags[t] = (allTags[t] || 0) + 1);
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
            <button id="ctrl-song-sort-dir" class="sort-dir-btn">${songState.sortDir === 'random' ? '↕ RNG' : (songState.sortDir === 'asc' ? '↓ ASC' : '↑ DESC')}</button>
            <button id="ctrl-song-shuffle" class="sort-dir-btn" style="color: var(--text-main); border: 1px solid #444;">RNG</button>
            
            ${buildMultiSelect('ms-song-artist', 'Artists', allArtists, songState.sortDir, songState.filters.artist)}
            ${buildMultiSelect('ms-song-genre', 'Genres', allGenres, songState.sortDir, songState.filters.genre)}
            ${buildMultiSelect('ms-song-tag', 'Tags', allTags, songState.sortDir, songState.filters.tag)}
            
            ${buildYearRangeSlider('song', minSongYear, maxSongYear)}
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
    document.getElementById('ctrl-song-sort').addEventListener('change', (e) => { songState.sortBy = e.target.value; songState.sortDir = 'asc'; document.getElementById('ctrl-song-sort-dir').innerText = '↓ ASC'; updateMultiSelectOptionOrder(['ms-song-artist', 'ms-song-genre', 'ms-song-tag'], songState.sortDir); updateSongList(); });
    
    document.getElementById('ctrl-song-sort-dir').addEventListener('click', (e) => { 
        songState.sortDir = songState.sortDir === 'asc' ? 'desc' : 'asc'; 
        e.target.innerText = songState.sortDir === 'asc' ? '↓ ASC' : '↑ DESC'; 
        updateMultiSelectOptionOrder(['ms-song-artist', 'ms-song-genre', 'ms-song-tag'], songState.sortDir);
        updateSongList(); 
    });
    
    document.getElementById('ctrl-song-shuffle').addEventListener('click', () => { 
        songState.sortDir = 'random'; 
        document.getElementById('ctrl-song-sort-dir').innerText = '↕ RNG'; 
        updateMultiSelectOptionOrder(['ms-song-artist', 'ms-song-genre', 'ms-song-tag'], songState.sortDir);
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
        let year = getSongReleaseYear(song, album);

        if (f.artist.length > 0 && !f.artist.includes(artistName)) return false;
        if (year !== 0 && (year < songState.yearRange.min || year > songState.yearRange.max)) return false;
        if (f.genre.length > 0 && (!song.genre || !song.genre.some(g => f.genre.includes(g)))) return false;
        if (f.tag.length > 0 && (!song.tags || !song.tags.some(t => f.tag.includes(t)))) return false;

        return true;
    });

    // ENSURE RANDOMIZE IS CHECKED BEFORE SORTING
    if (songState.sortDir === 'random') {
        results = shuffleArray(results);
    } else {
        results.sort((a, b) => {
            // ... (keep existing sorting logic here)
            const albumA = albumsDatabase.find(x => x.albumID === a.albumID);
            const albumB = albumsDatabase.find(x => x.albumID === b.albumID);
            let valA, valB;

            if (songState.sortBy === 'title') { valA = a.title.toLowerCase(); valB = b.title.toLowerCase(); }
            else if (songState.sortBy === 'artist') { valA = getArtistName(a.artistID).toLowerCase(); valB = getArtistName(b.artistID).toLowerCase(); }
            else if (songState.sortBy === 'duration') { valA = a.duration; valB = b.duration; }
            else if (songState.sortBy === 'year') { valA = getSongReleaseYear(a, albumA); valB = getSongReleaseYear(b, albumB); }

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
    let allGenres = {}, allTags = {}, allCountries = {}, allStartYears = {}, allFirstListen = {};
    artistsDatabase.forEach(a => {
        if (a.genre) a.genre.forEach(g => allGenres[g] = (allGenres[g] || 0) + 1);
        if (a.tags) a.tags.forEach(t => allTags[t] = (allTags[t] || 0) + 1);
        if (a.country) allCountries[a.country] = (allCountries[a.country] || 0) + 1;
        if (a.startYear) allStartYears[a.startYear] = (allStartYears[a.startYear] || 0) + 1;
        if (a.firstlistenYear) allFirstListen[a.firstlistenYear] = (allFirstListen[a.firstlistenYear] || 0) + 1;
    });
    
    contentArea.innerHTML = `
        <h1 class="header-title">Artists</h1>
        <div class="controls-toolbar">
            <input type="text" id="ctrl-search" class="ctrl-input ctrl-search" placeholder="Search artists...">
            <select id="ctrl-sort" class="ctrl-select">
                <option value="firstlistenYear" ${artistState.sortBy === 'firstlistenYear' ? 'selected' : ''}>Sort: First Listened</option>
                <option value="artist" ${artistState.sortBy === 'artist' ? 'selected' : ''}>Sort: Name</option>
                <option value="startYear" ${artistState.sortBy === 'startYear' ? 'selected' : ''}>Sort: Start Year</option>
            </select>
                        <button id="ctrl-sort-dir" class="sort-dir-btn">${artistState.sortDir === 'random' ? '↕ RNG' : (artistState.sortDir === 'asc' ? '↓ ASC' : '↑ DESC')}</button>
            <button id="ctrl-artist-shuffle" class="sort-dir-btn" style="color: var(--text-main); border: 1px solid #444;">RNG</button>
            
            ${buildMultiSelect('ms-startYear', 'Start Year', allStartYears, artistState.sortDir, artistState.filters.startYear)}
            ${buildMultiSelect('ms-firstlisten', 'First Listened', allFirstListen, artistState.sortDir, artistState.filters.firstlistenYear)}
            ${buildMultiSelect('ms-genre', 'Genres', allGenres, artistState.sortDir, artistState.filters.genre)}
            ${buildMultiSelect('ms-tag', 'Tags', allTags, artistState.sortDir, artistState.filters.tag)} 
            ${buildMultiSelect('ms-country', 'Country', allCountries, artistState.sortDir, artistState.filters.country)}
            
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
    document.getElementById('ctrl-sort-dir').addEventListener('click', (e) => { artistState.sortDir = artistState.sortDir === 'asc' ? 'desc' : 'asc'; e.target.innerText = artistState.sortDir === 'asc' ? '↓ ASC' : '↑ DESC'; updateMultiSelectOptionOrder(['ms-startYear', 'ms-firstlisten', 'ms-genre', 'ms-tag', 'ms-country'], artistState.sortDir); updateArtistGrid(); });
    const getChecked = (id) => Array.from(document.querySelectorAll(`#${id} input:checked`)).map(cb => cb.value);
    document.querySelectorAll('.multi-select input[type="checkbox"]').forEach(cb => { cb.addEventListener('change', () => { artistState.filters.genre = getChecked('ms-genre'); artistState.filters.tag = getChecked('ms-tag'); artistState.filters.country = getChecked('ms-country'); artistState.filters.startYear = getChecked('ms-startYear'); artistState.filters.firstlistenYear = getChecked('ms-firstlisten'); updateArtistGrid(); }); });
    attachDualSliderLogic('artist', artistState, updateArtistGrid);
    document.getElementById('ctrl-artist-shuffle').addEventListener('click', () => { 
    artistState.sortDir = 'random'; 
    document.getElementById('ctrl-sort-dir').innerText = '↕ RNG'; 
    updateMultiSelectOptionOrder(['ms-startYear', 'ms-firstlisten', 'ms-genre', 'ms-tag', 'ms-country'], artistState.sortDir);
    updateArtistGrid(); 
});
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

    // CORRECT LOGIC: Sort outside the sort function
    if (artistState.sortDir === 'random') {
        results = shuffleArray(results);
    } else {
        results.sort((a, b) => { 
            let valA = a[artistState.sortBy], valB = b[artistState.sortBy]; 
            if (artistState.sortBy === 'startYear' || artistState.sortBy === 'firstlistenYear') { 
                valA = parseInt(valA) || 0; valB = parseInt(valB) || 0; 
            } else { 
                valA = (valA || '').toLowerCase(); valB = (valB || '').toLowerCase(); 
            } 
            if (valA < valB) return artistState.sortDir === 'asc' ? -1 : 1; 
            if (valA > valB) return artistState.sortDir === 'asc' ? 1 : -1; 
            return 0; 
        });
    }

    if (results.length === 0) { grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1 / -1;">No artists match those filters.</p>`; return; }
    
    results.forEach(artist => { 
        const card = document.createElement('div'); card.className = 'artist-card'; 
        card.innerHTML = `${isEditMode ? `<button class="edit-btn" onclick="event.stopPropagation(); openEditModal('artist', '${artist.artistID}')"><svg class="icon" style="width:16px;height:16px;"><use href="#icon-gear"></use></svg></button>` : ''}
        <div class="artist-img-wrapper"><img src="${artist.paths.cover}" alt="${artist.artist}" onerror="this.style.display='none'"></div><div class="name">${artist.artist}</div>`; 
        card.addEventListener('click', () => { window.location.hash = `artist/${artist.artistID}`; }); 
        grid.appendChild(card); 
    });
}

function renderAlbumsView() {
    let allArtists = {}, allGenres = {}, allTags = {};
    albumsDatabase.forEach(a => {
        if (a.artistID) {
            let readableName = getArtistName(a.artistID);
            if (readableName !== "Unknown Artist") allArtists[readableName] = (allArtists[readableName] || 0) + 1;
        }
        if (a.genre) a.genre.forEach(g => allGenres[g] = (allGenres[g] || 0) + 1);
        if (a.tags) a.tags.forEach(t => allTags[t] = (allTags[t] || 0) + 1);
    });
    
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
            <button id="ctrl-album-sort-dir" class="sort-dir-btn">${albumState.sortDir === 'random' ? '↕ RNG' : (albumState.sortDir === 'asc' ? '↓ ASC' : '↑ DESC')}</button>
            <button id="ctrl-album-type" class="sort-dir-btn">Show: Albums</button>
            <button id="ctrl-album-shuffle" class="sort-dir-btn" style="color: var(--text-main); border: 1px solid #444;">RNG</button>
            ${buildMultiSelect('ms-album-artist', 'Artists', allArtists, albumState.sortDir, albumState.filters.artist)}
            ${buildMultiSelect('ms-album-genre', 'Genres', allGenres, albumState.sortDir, albumState.filters.genre)}
            ${buildMultiSelect('ms-album-tag', 'Tags', allTags, albumState.sortDir, albumState.filters.tag)}
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
    document.getElementById('ctrl-album-sort-dir').addEventListener('click', (e) => { albumState.sortDir = albumState.sortDir === 'asc' ? 'desc' : 'asc'; e.target.innerText = albumState.sortDir === 'asc' ? '↓ ASC' : '↑ DESC'; updateMultiSelectOptionOrder(['ms-album-artist', 'ms-album-genre', 'ms-album-tag'], albumState.sortDir); updateAlbumGrid(); });
    document.getElementById('ctrl-album-shuffle').addEventListener('click', () => { 
    albumState.sortDir = 'random'; 
    document.getElementById('ctrl-album-sort-dir').innerText = '↕ RNG'; 
    updateMultiSelectOptionOrder(['ms-album-artist', 'ms-album-genre', 'ms-album-tag'], albumState.sortDir);
    updateAlbumGrid(); 
});

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
    
    // START OF UPDATED LOGIC
    if (albumState.sortDir === 'random') {
        results = shuffleArray(results);
    } else {
        results.sort((a, b) => { 
            let valA, valB; 
            if (albumState.sortBy === 'artist') { 
                valA = getArtistName(a.artistID).toLowerCase(); 
                valB = getArtistName(b.artistID).toLowerCase(); 
            } else if (albumState.sortBy === 'duration' || albumState.sortBy === 'trackcount') { 
                valA = parseInt(a[albumState.sortBy]) || 0; 
                valB = parseInt(b[albumState.sortBy]) || 0; 
            } else { 
                valA = (a[albumState.sortBy] || '').toLowerCase(); 
                valB = (b[albumState.sortBy] || '').toLowerCase(); 
            } 
            if (valA < valB) return albumState.sortDir === 'asc' ? -1 : 1; 
            if (valA > valB) return albumState.sortDir === 'asc' ? 1 : -1; 
            return 0; 
        });
    }
    // END OF UPDATED LOGIC

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




function formatDateInputValue(date) {
    const local = new Date(date);
    if (Number.isNaN(local.getTime())) return '';
    const day = String(local.getDate()).padStart(2, '0');
    const month = String(local.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${local.getFullYear()}`;
}

function parseDateInputValue(value, endOfDay = false) {
    const raw = String(value || '').trim();
    let match = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    let day;
    let month;
    let year;
    if (match) {
        day = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        year = parseInt(match[3], 10);
    } else {
        match = raw.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
        if (!match) return null;
        year = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        day = parseInt(match[3], 10);
    }
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    if (endOfDay) date.setHours(23, 59, 59, 999);
    return Number.isNaN(date.getTime()) ? null : date;
}

function renderStatsView() {
    if (!currentAccount) return contentArea.innerHTML = `<h1 class="header-title">My Stats</h1><p style="color: var(--text-muted);">Please select a profile to view statistics.</p>`;

    const defaultEnd = formatDateInputValue(new Date());
    const defaultStart = formatDateInputValue(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    contentArea.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom: 24px;">
            <h1 class="header-title" style="margin:0;">Listening Analytics</h1>
            <div style="display: flex; gap: 12px;">
                <button class="btn-secondary" onclick="ipcRenderer.send('export-account-data', '${currentAccount.slug}')">
                    <svg class="icon" style="width:16px; height:16px;"><use href="#icon-list"></use></svg> Download Data
                </button>
            </div>
        </div>

        <div class="controls-toolbar" style="gap: 16px;">
            <div style="display: flex; flex-direction: column;">
                <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Start Date</label>
                <input type="text" id="stat-start" class="ctrl-input" value="${defaultStart}" placeholder="12/06/2026" inputmode="numeric" onchange="handleStatsDateChange()" onkeydown="if(event.key === 'Enter') handleStatsDateChange()">
            </div>
            <div style="display: flex; flex-direction: column;">
                <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">End Date</label>
                <input type="text" id="stat-end" class="ctrl-input" value="${defaultEnd}" placeholder="12/06/2026" inputmode="numeric" onchange="handleStatsDateChange()" onkeydown="if(event.key === 'Enter') handleStatsDateChange()">
            </div>
            <div style="display: flex; flex-direction: column;">
                <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Quick Select</label>
                <div style="display: flex; gap: 8px;">
                    <select id="stat-quick" class="ctrl-select" onchange="applyQuickDateRange(this.value)">
                        <option value="">-- Select --</option>
                        <option value="7">Last 7 Days</option>
                        <option value="30" selected>Last 30 Days</option>
                        <option value="365">Last Year</option>
                        <option value="all">All Time</option>
                    </select>
                    <input type="text" id="stat-exact-month" class="ctrl-input" placeholder="06/2026" inputmode="numeric" onchange="applyExactMonth(this.value)" onkeydown="if(event.key === 'Enter') applyExactMonth(this.value)" title="Type month/year">
                </div>
            </div>
            <div style="display: flex; flex-direction: column;">
                <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Rank By</label>
                <select id="stat-rank-by" class="ctrl-select" onchange="calculateStats()">
                    <option value="plays">Plays</option>
                    <option value="time" selected>Time Listened</option>
                </select>
            </div>
            <button class="btn-primary" style="margin-top: 14px; padding: 8px 16px;" onclick="openRewindSettingsModal()">Rewind Options</button>
            
            <div style="margin-left: auto;">
                <button class="btn-primary" style="margin-top: 14px; background: linear-gradient(45deg, #ff0050, #8a2be2); color: white; border: none; font-weight: bold;" onclick="openRewindModal()">Create Rewind</button>
            </div>
        </div>

        <div id="stats-dashboard" style="display: flex; flex-direction: column; gap: 24px; margin-bottom: 40px;">
            <p style="color: var(--text-muted);">Use the controls above to view your stats.</p>
        </div>
    `;

    calculateStats(); 
}

window.handleStatsDateChange = function() {
    const quick = document.getElementById('stat-quick');
    const exactMonth = document.getElementById('stat-exact-month');
    if (quick) quick.value = '';
    if (exactMonth) exactMonth.value = '';
    calculateStats();
};

window.applyQuickDateRange = function(value) {
    if (!value) return;
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);
    if (value === 'all') {
        const historyDates = (currentAccount?.history || [])
            .map(entry => new Date(entry.timestamp))
            .filter(date => !Number.isNaN(date.getTime()))
            .sort((a, b) => a - b);
        start = historyDates[0] || new Date(2000, 0, 1);
    } else {
        const days = parseInt(value, 10) || 30;
        start.setDate(start.getDate() - days + 1);
    }
    const startInput = document.getElementById('stat-start');
    const endInput = document.getElementById('stat-end');
    const exactMonth = document.getElementById('stat-exact-month');
    if (startInput) startInput.value = formatDateInputValue(start);
    if (endInput) endInput.value = formatDateInputValue(end);
    if (exactMonth) exactMonth.value = '';
    calculateStats();
};

window.applyExactMonth = function(val) {
    const raw = String(val || '').trim();
    if(!raw) return;
    let match = raw.match(/^(\d{1,2})[\/.\-](\d{4})$/);
    let month;
    let year;
    if (match) {
        month = parseInt(match[1], 10);
        year = parseInt(match[2], 10);
    } else {
        match = raw.match(/^(\d{4})[\/.\-](\d{1,2})$/);
        if (!match) {
            calculateStats();
            return;
        }
        year = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
    }
    if (!year || !month || month < 1 || month > 12) {
        calculateStats();
        return;
    }
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    document.getElementById('stat-start').value = formatDateInputValue(start);
    document.getElementById('stat-end').value = formatDateInputValue(end);
    const quick = document.getElementById('stat-quick');
    if (quick) quick.value = '';
    calculateStats();
};

window.calculateStats = function() {
    const dash = document.getElementById('stats-dashboard');
    if (!currentAccount.history || currentAccount.history.length === 0) {
        dash.innerHTML = `<p style="color: var(--text-muted);">No listening history recorded yet. Go play some music!</p>`;
        return;
    }

    const startDate = parseDateInputValue(document.getElementById('stat-start').value);
    const endDate = parseDateInputValue(document.getElementById('stat-end').value, true);
    if (!startDate || !endDate) {
        dash.innerHTML = `<p style="color: var(--text-muted);">Type valid dates as DD/MM/YYYY, for example 12/06/2026.</p>`;
        return;
    }
    if (startDate > endDate) {
        dash.innerHTML = `<p style="color: var(--text-muted);">Start Date must be before End Date.</p>`;
        return;
    }

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
        
        const dur = parseInt(song.duration) || 0;
        totalSeconds += dur;
        
        if(!songCounts[song.songID]) songCounts[song.songID] = { plays: 0, dur: 0 };
        songCounts[song.songID].plays++; songCounts[song.songID].dur += dur;
        
        if(!artistCounts[song.artistID]) artistCounts[song.artistID] = { plays: 0, dur: 0 };
        artistCounts[song.artistID].plays++; artistCounts[song.artistID].dur += dur;
        
        if(!albumCounts[song.albumID]) albumCounts[song.albumID] = { plays: 0, dur: 0 };
        albumCounts[song.albumID].plays++; albumCounts[song.albumID].dur += dur;
        
        if (song.genre) song.genre.forEach(g => {
            if(!genreCounts[g]) genreCounts[g] = { plays: 0, dur: 0 };
            genreCounts[g].plays++; genreCounts[g].dur += dur;
        });
        if (song.tags) song.tags.forEach(t => {
            if(!tagCounts[t]) tagCounts[t] = { plays: 0, dur: 0 };
            tagCounts[t].plays++; tagCounts[t].dur += dur;
        });

        const d = new Date(h.timestamp);
        timeOfDay[d.getHours()]++;
        
        const dateStr = d.toISOString().split('T')[0];
        playsOverTime[dateStr] = (playsOverTime[dateStr] || 0) + 1;
    });

    const fmtDur = (sec) => sec >= 3600 ? (sec/3600).toFixed(1) + 'h' : Math.ceil(sec/60) + 'm';
    const rankBy = document.getElementById('stat-rank-by') ? document.getElementById('stat-rank-by').value : 'time';
    const getTop = (dict, num) => {
        const ranked = Object.entries(dict).sort((a,b) => b[1][rankBy === 'time' ? 'dur' : 'plays'] - a[1][rankBy === 'time' ? 'dur' : 'plays']);
        return Number.isFinite(num) ? ranked.slice(0, num) : ranked;
    };

    // Format Lists
    const renderRankItems = (section) => {
        const state = window.statsRankPages && window.statsRankPages[section];
        if (!state) return '';
        const start = state.page * state.perPage;
        return state.items.slice(start, start + state.perPage).map((item) => item.html).join('');
    };

    window.updateStatsRankPage = function(section) {
        const state = window.statsRankPages && window.statsRankPages[section];
        if (!state) return;
        const pageCount = Math.max(1, Math.ceil(state.items.length / state.perPage));
        const list = document.getElementById(`stats-${section}-list`);
        const label = document.getElementById(`stats-${section}-page`);
        const prev = document.getElementById(`stats-${section}-prev`);
        const next = document.getElementById(`stats-${section}-next`);
        if (list) list.innerHTML = renderRankItems(section);
        if (label) label.innerText = `${state.page + 1}/${pageCount}`;
        if (prev) prev.disabled = state.page <= 0;
        if (next) next.disabled = state.page >= pageCount - 1;
    };

    window.changeStatsRankPage = function(section, delta) {
        const state = window.statsRankPages && window.statsRankPages[section];
        if (!state) return;
        const pageCount = Math.max(1, Math.ceil(state.items.length / state.perPage));
        state.page = Math.max(0, Math.min(pageCount - 1, state.page + delta));
        window.updateStatsRankPage(section);
    };

    window.statsRankPages = {};

    const buildList = (section, title, topArray, resolver, perPage) => {
        if (topArray.length === 0) return `<div class="stats-card"><h3>${title}</h3><p style="color: var(--text-muted); font-size: 13px;">No data.</p></div>`;
        const items = topArray.map((entry, idx) => {
            const plays = entry[1].plays;
            const duration = fmtDur(entry[1].dur);
            const statDisplay = `${plays} plays &bull; ${duration}`;
            return {
                html: `<div class="stats-list-item"><div class="name"><span style="color: var(--text-muted); margin-right:8px;">${idx+1}.</span> ${resolver(entry[0])}</div><div class="count" style="text-align: right; line-height: 1.3;">${statDisplay}</div></div>`
            };
        });
        window.statsRankPages[section] = { items, perPage, page: 0 };
        const pageCount = Math.max(1, Math.ceil(items.length / perPage));
        return `
            <div class="stats-card">
                <div class="stats-rank-header">
                    <h3>${title}</h3>
                    <div class="stats-rank-pager">
                        <button id="stats-${section}-prev" type="button" class="rank-page-btn" onclick="changeStatsRankPage('${section}', -1)" aria-label="Previous ${title} page" disabled>
                            <span class="rank-page-icon rank-page-prev"></span>
                        </button>
                        <span id="stats-${section}-page" class="rank-page-count">1/${pageCount}</span>
                        <button id="stats-${section}-next" type="button" class="rank-page-btn" onclick="changeStatsRankPage('${section}', 1)" aria-label="Next ${title} page" ${pageCount <= 1 ? 'disabled' : ''}>
                            <span class="rank-page-icon rank-page-next"></span>
                        </button>
                    </div>
                </div>
                <div id="stats-${section}-list" class="stats-rank-page-list" style="--rank-page-size: ${perPage};">${renderRankItems(section)}</div>
            </div>
        `;
    };  

    const topSongs = buildList('songs', 'Top Songs', getTop(songCounts), id => songsDatabase.find(s => s.songID === id)?.title || "Unknown", 20);
    const topArtists = buildList('artists', 'Top Artists', getTop(artistCounts), id => getArtistName(id), 5);
    const topAlbums = buildList('albums', 'Top Albums', getTop(albumCounts), id => albumsDatabase.find(a => a.albumID === id)?.title || "Unknown", 5);
    const topGenres = buildList('genres', 'Top Genres', getTop(genreCounts), name => name, 5);
    
    // Format Time of Day Chart
    const maxHour = Math.max(...timeOfDay, 1);
    let hourChartHtml = `<div class="stats-card" style="flex: 100%;"><h3>Habits by Time of Day</h3><div class="stats-bar-chart" style="gap: 2px;">`;
    timeOfDay.forEach((val, hr) => {
        const hPct = (val / maxHour) * 100;
        hourChartHtml += `<div style="flex:1; display:flex; flex-direction:column; align-items:center; height:100%;">
            <div style="flex:1; width:100%; display:flex; align-items:flex-end;"><div class="stats-bar" style="height:${hPct}%; width:100%;" data-val="${val} plays"></div></div>
            <div style="font-size:10px; color: var(--text-muted); margin-top:4px;">${hr}h</div>
        </div>`;
    });
    hourChartHtml += `</div></div>`;

    // History List
    const recent = [...filteredHistory].reverse().slice(0, 30);
    const historyItems = recent.map(h => {
        const song = songsDatabase.find(s => s.songID === h.songID);
        if (!song) return '';
        const d = new Date(h.timestamp);
        return `<div class="stats-list-item" style="border:none; padding:4px 0;"><div class="name">${song.title} <span style="color: var(--text-muted); font-size:11px;">(${getArtistName(song.artistID)})</span></div><div class="count" style="font-weight:normal;">${d.toLocaleDateString()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}</div></div>`;
    }).filter(Boolean);
    const historyMidpoint = Math.ceil(historyItems.length / 2);
    let historyHtml = `<div class="stats-card" style="flex: 100%;"><h3>Recent History</h3><div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;"><div>${historyItems.slice(0, historyMidpoint).join('')}</div><div>${historyItems.slice(historyMidpoint).join('')}</div></div>`;
    historyHtml += `</div></div>`;

    const totalHours = Math.floor(totalSeconds / 3600);
    const totalMins = Math.floor((totalSeconds % 3600) / 60);

    dash.innerHTML = `
        <div style="background: var(--bg-elevated); color: var(--text-main); border: 1px solid var(--border-color); padding: 24px; border-radius: 8px; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <div style="font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; opacity: 0.8;">Total Listening Time</div>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 0;">${totalHours} <span style="font-size: 18px; font-weight: normal;">Hours</span> ${totalMins} <span style="font-size: 18px; font-weight: normal;">Mins</span></div>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; opacity: 0.8;">Total Streams</div>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 0;">${filteredHistory.length}</div>
            </div>
        </div>
        
        <div style="display: flex; gap: 24px; flex-wrap: wrap;">
            ${topSongs}
            <div id="stats-side-column" style="display: flex; flex-direction: column; gap: 24px; flex: 1; min-width: 280px;">
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
    handleRouting(); // Only route once accounts are loaded
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
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 13px; padding: 16px; margin: 0; text-align: center;">No accounts found.</p>`;
        return;
    }
    container.innerHTML = allAccounts.map(acc => {
        const isActive = currentAccount && currentAccount.id === acc.id;
        return `
            <div class="dropdown-item" onclick="setAccountById('${acc.id}')" style="${isActive ? 'background: #333;' : ''}">
                <img src="${acc.paths.profilePic}" onerror="this.src='logo.png'"> 
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
    profileBtn.innerHTML = `<img src="${acc.paths.profilePic}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" onerror="this.src='logo.png'">`;
    renderAccountDropdownList();
    
    updatePlayerHeart();
    if (window.location.hash === '#favorites') updateSongList();
    if (window.location.hash === '#playlists') renderPlaylistsView(); // Fix for Playlists tab
    if (window.location.hash === '#stats') renderStatsView();         // Fix for Stats tab
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

let draggedImageBase64 = null;
let draggedImageExt = null;

function openCreateAccountModal() {
    document.getElementById('profile-dropdown').classList.remove('visible');
    document.getElementById('create-account-modal').style.display = 'flex';
    const nameInput = document.getElementById('acc-name-input');
    if (nameInput) nameInput.value = '';
    document.getElementById('drop-zone-preview').style.display = 'none';
    document.getElementById('file-input').value = ''; 
    draggedImageBase64 = null;
    draggedImageExt = null;
    
    const dropZone = document.getElementById('drop-zone');
    if(dropZone) dropZone.classList.remove('drag-active');
}

function closeCreateAccountModal() {
    document.getElementById('create-account-modal').style.display = 'none';
}

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
        if (!file.type.startsWith('image/')) return alert("Please select an image file.");
        
        let extIndex = file.name ? file.name.lastIndexOf('.') : -1;
        draggedImageExt = extIndex > -1 ? file.name.substring(extIndex).toLowerCase() : '.png';
        
        const reader = new FileReader();
        // Read file as Base64 text to guarantee safe transmission over IPC
        reader.onload = function() { draggedImageBase64 = reader.result; };
        reader.readAsDataURL(file);
        
        const preview = document.getElementById('drop-zone-preview');
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
    }
}

function submitNewAccount() {
    const name = document.getElementById('acc-name-input').value.trim();
    if (!name) return alert("Please enter a profile name.");
    
    ipcRenderer.send('create-account', { name: name, imageBase64: draggedImageBase64, imageExt: draggedImageExt });
    
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
let draggedPlImageBase64 = null;
let draggedPlImageExt = null;

function openCreatePlaylistModal(pendingSongId = "") {
    document.getElementById('create-playlist-modal').style.display = 'flex';
    document.getElementById('pl-name-input').value = '';
    document.getElementById('pl-drop-zone-preview').style.display = 'none';
    document.getElementById('pl-pending-song').value = pendingSongId;
    draggedPlImageBase64 = null;
    draggedPlImageExt = null;
}

function closeCreatePlaylistModal() { document.getElementById('create-playlist-modal').style.display = 'none'; }

const plDropZone = document.getElementById('pl-drop-zone');
const plFileInput = document.getElementById('pl-file-input');

if (plDropZone && plFileInput) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eName => plDropZone.addEventListener(eName, e => { e.preventDefault(); e.stopPropagation(); }, false));
    ['dragenter', 'dragover'].forEach(eName => plDropZone.addEventListener(eName, () => plDropZone.classList.add('drag-active'), false));
    ['dragleave', 'drop'].forEach(eName => plDropZone.addEventListener(eName, () => plDropZone.classList.remove('drag-active'), false));
    
    plDropZone.addEventListener('drop', e => {
        let file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) { 
            let extIndex = file.name ? file.name.lastIndexOf('.') : -1;
            draggedPlImageExt = extIndex > -1 ? file.name.substring(extIndex).toLowerCase() : '.png';
            const reader = new FileReader();
            reader.onload = function() { draggedPlImageBase64 = reader.result; };
            reader.readAsDataURL(file);
            document.getElementById('pl-drop-zone-preview').src = URL.createObjectURL(file); document.getElementById('pl-drop-zone-preview').style.display = 'block'; 
        }
    });
    plFileInput.addEventListener('change', function() {
        let file = this.files[0];
        if (file && file.type.startsWith('image/')) { 
            let extIndex = file.name ? file.name.lastIndexOf('.') : -1;
            draggedPlImageExt = extIndex > -1 ? file.name.substring(extIndex).toLowerCase() : '.png';
            const reader = new FileReader();
            reader.onload = function() { draggedPlImageBase64 = reader.result; };
            reader.readAsDataURL(file);
            document.getElementById('pl-drop-zone-preview').src = URL.createObjectURL(file); document.getElementById('pl-drop-zone-preview').style.display = 'block'; 
        }
    });
}

function submitNewPlaylist() {
    const name = document.getElementById('pl-name-input').value.trim();
    if (!name) return alert("Enter a playlist name.");
    document.querySelector('#create-playlist-modal .btn-primary').innerText = "Generating...";
    ipcRenderer.send('create-playlist', { accountId: currentAccount.id, name: name, imageBase64: draggedPlImageBase64, imageExt: draggedPlImageExt });
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
                <img src="${pl.cover}" class="big-cover" style="cursor: pointer;" onclick="openImageModal('${pl.cover}')" onerror="this.style.display='none'">
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
    
    let allArtists = {}, allGenres = {}, allTags = {};
    currentAccount.playlists.forEach(pl => {
        let stats = getPlaylistStats(pl);
        stats.artists.forEach(a => allArtists[a] = (allArtists[a] || 0) + 1);
        stats.genres.forEach(g => allGenres[g] = (allGenres[g] || 0) + 1);
        stats.tags.forEach(t => allTags[t] = (allTags[t] || 0) + 1);
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
            
            ${buildMultiSelect('ms-pl-artist', 'Artists', allArtists, playlistState.sortDir, playlistState.filters.artist)}
            ${buildMultiSelect('ms-pl-genre', 'Genres', allGenres, playlistState.sortDir, playlistState.filters.genre)}
            ${buildMultiSelect('ms-pl-tag', 'Tags', allTags, playlistState.sortDir, playlistState.filters.tag)}
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
            <div class="album-img-wrapper"><img src="${pl.cover}" onerror="this.src='logo.png'"></div>
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
    resultsBox.style.cssText = "display: none; position: absolute; top: 110%; left: 0; width: 100%; background: var(--bg-elevated); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--control-shadow); z-index: 1000; flex-direction: column; overflow: hidden;";
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
                    <img src="${r.img}" style="width: 32px; height: 32px; border-radius: ${r.type === 'Artist' ? '50%' : '4px'}; object-fit: cover; background: var(--bg-surface-strong);" onerror="this.style.display='none'">
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

const APP_THEME_CLASSES = ['theme-neon', 'theme-midnight', 'theme-rose', 'theme-light', 'theme-graphite', 'theme-dusk', 'theme-fresh'];

window.changeAppTheme = function(themeClass) {
    document.body.classList.remove(...APP_THEME_CLASSES);
    if (themeClass && themeClass !== 'default') document.body.classList.add(themeClass);
    localStorage.setItem('appTheme', themeClass || 'default');
    refreshTipsModeClass();
};
// Apply theme on load
const savedTheme = localStorage.getItem('appTheme');
changeAppTheme(savedTheme || 'default');
applyAppTips();

// ==========================================
// THE "Rewind" POSTER ENGINE
// ==========================================
window.openRewindSettingsModal = function() {
    const existing = document.getElementById('Rewind-settings-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'Rewind-settings-overlay';
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.78); z-index:100000; display:flex; justify-content:center; align-items:center; backdrop-filter: blur(6px);";

    const rankSelect = (section, label) => `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px;">
            <label style="color: var(--text-muted); font-size: 13px;">${label}</label>
            <select class="ctrl-select" onchange="setRewindRankMode('${section}', this.value)">
                <option value="time" ${rewindSettings.sorts[section] === 'time' ? 'selected' : ''}>Time</option>
                <option value="plays" ${rewindSettings.sorts[section] === 'plays' ? 'selected' : ''}>Plays</option>
            </select>
        </div>
    `;

    const themeOptions = REWIND_THEME_OPTIONS.map(theme =>
        `<option value="${theme.value}" ${rewindSettings.theme === theme.value ? 'selected' : ''}>${theme.label}</option>`
    ).join('');

    overlay.innerHTML = `
        <div class="modal-box" style="width: 440px; padding: 28px;">
            <h3 style="margin: 0 0 20px 0; color: var(--text-main); font-size: 20px;">Rewind Options</h3>
            <div style="display: flex; flex-direction: column; gap: 14px; margin-bottom: 22px;">
                ${rankSelect('songs', 'Songs')}
                ${rankSelect('artists', 'Artists')}
                ${rankSelect('albums', 'Albums')}
                ${rankSelect('genres', 'Genres')}
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px;">
                <label style="color: var(--text-muted); font-size: 13px;">Theme</label>
                <select class="ctrl-select" onchange="setRewindTheme(this.value)">${themeOptions}</select>
            </div>
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button class="btn-secondary" style="padding: 10px 16px;" onclick="document.getElementById('Rewind-settings-overlay').remove()">Close</button>
                <button class="btn-primary" style="padding: 10px 16px;" onclick="document.getElementById('Rewind-settings-overlay').remove(); openRewindModal();">Create Rewind</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
};

window.fitRewindPosterToViewport = function() {
    const poster = document.querySelector('.Rewind-poster, .Rewind-poster-placeholder');
    const container = document.getElementById('Rewind-poster-container');
    const panel = document.getElementById('Rewind-controls-panel');
    if (!poster || !container) return;

    poster.style.transform = '';
    container.style.width = '';
    container.style.height = '';

    const naturalWidth = poster.offsetWidth || 1100;
    const naturalHeight = poster.offsetHeight || 700;
    const panelWidth = panel ? panel.offsetWidth : 0;
    const availableWidth = Math.max(320, window.innerWidth - panelWidth - 120);
    const availableHeight = Math.max(360, window.innerHeight - 80);
    const scale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);

    poster.style.transformOrigin = 'top left';
    poster.style.transform = `scale(${scale})`;
    container.style.width = `${naturalWidth * scale}px`;
    container.style.height = `${naturalHeight * scale}px`;
};

window.addEventListener('resize', () => {
    if (document.getElementById('Rewind-modal-overlay')) fitRewindPosterToViewport();
});

window.openRewindModal = function() {
    const existing = document.getElementById('Rewind-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'Rewind-modal-overlay';
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.9); z-index:99999; display:flex; flex-direction: row; align-items:flex-start; justify-content:flex-start; gap: 24px; overflow:auto; padding: 40px; box-sizing: border-box; backdrop-filter: blur(8px);";
    
    overlay.innerHTML = `
        <div id="Rewind-controls-panel" style="background: var(--bg-elevated); border: 1px solid var(--border-color); padding: 20px; border-radius: 12px; display: flex; flex-direction: column; gap: 14px; z-index: 10; width: 260px; flex: 0 0 260px; position: sticky; top: 0; align-self: flex-start;">
            <h3 style="margin: 0; font-size: 16px; color: var(--text-main);">Create Rewind</h3>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <button class="btn-secondary" onclick="generateRewindData('month')">This Month</button>
                <button class="btn-secondary" onclick="generateRewindData('last_month')">Last Month</button>
                <button class="btn-secondary" onclick="generateRewindData('year')">This Year</button>
                <button class="btn-secondary" onclick="generateRewindData('last_year')">Last Year</button>
                <button class="btn-secondary" onclick="generateRewindData('all')">All Time</button>
                <input type="month" id="rewind-exact-month" class="ctrl-input" style="margin: 0; width: 100%;" onchange="generateRewindData('exact', this.value)" title="Select exact month & year">
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px; padding-top: 16px; border-top: 1px solid #333;">
                <button class="btn-primary" style="background: #00f0ff; color: #000; width: 100%; border: none; font-weight: bold;" onclick="downloadRewindPoster()">⬇ Download Poster PNG</button>
                <button class="btn-primary" style="background: #ff0050; color: white; border: none; width: 100%;" onclick="document.getElementById('Rewind-modal-overlay').remove()">Close Menu</button>
            </div>
        </div>

        <div id="Rewind-poster-container" style="box-shadow: 0 20px 60px rgba(0,0,0,0.8); flex: 0 0 auto; overflow: visible;">
            <div class="Rewind-poster-placeholder" style="width: 1100px; height: 700px; background: var(--bg-surface); display:flex; justify-content:center; align-items:center; border: 1px solid var(--border-color);">
                <p style="color: var(--text-muted); text-align: center; font-size: 18px;">Pick a period on the left to generate your Rewind poster.</p>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(fitRewindPosterToViewport);
};

window.generateRewindData = function(timeframe, customVal) {
    if (!currentAccount || !currentAccount.history) return;
    
    window.lastRewindType = timeframe;
    window.lastRewindVal = customVal;

    let startDate, endDate;
    const now = new Date();
    let titleText = "Unknown Date";
    
    if (timeframe === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        titleText = startDate.toLocaleString('default', { month: 'long', year: 'numeric' });
    } else if (timeframe === 'last_month') {
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        titleText = startDate.toLocaleString('default', { month: 'long', year: 'numeric' });
    } else if (timeframe === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
        titleText = startDate.getFullYear();
    } else if (timeframe === 'last_year') {
        startDate = new Date(now.getFullYear() - 1, 0, 1);
        endDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
        titleText = startDate.getFullYear();
    } else if (timeframe === 'exact' && customVal) {
        const [y, m] = customVal.split('-');
        startDate = new Date(y, parseInt(m) - 1, 1);
        endDate = new Date(y, parseInt(m), 0, 23, 59, 59);
        titleText = startDate.toLocaleString('default', { month: 'long', year: 'numeric' });
    } else {
        startDate = new Date(2000, 0, 1);
        endDate = new Date(2100, 0, 1);
        titleText = "All Time";
    }

    const filtered = currentAccount.history.filter(h => {
        const d = new Date(h.timestamp);
        return d >= startDate && d <= endDate;
    });

    const container = document.getElementById('Rewind-poster-container');
    if (!container) return;

    if (filtered.length === 0) {
        container.innerHTML = `<div style="width: 1000px; height: 600px; background: var(--bg-surface); display:flex; justify-content:center; align-items:center; color: #ff0050;">No listening data found for this period.</div>`;
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
        return `${hr}:00 ${ampm}`;
    };

    const fmtDur = (sec) => sec >= 3600 ? (sec/3600).toFixed(1) + 'h' : Math.ceil(sec/60) + 'm';
    
    const sortS = rewindSettings.sorts.songs;
    const sortAr = rewindSettings.sorts.artists;
    const sortAl = rewindSettings.sorts.albums;
    const sortG = rewindSettings.sorts.genres;

    const getTop = (obj, num, rankMode) => Object.entries(obj).sort((a,b) => b[1][rankMode === 'time' ? 'dur' : 'plays'] - a[1][rankMode === 'time' ? 'dur' : 'plays']).slice(0, num);

    const tSongs = getTop(songStats, 10, sortS);
    const tArtists = getTop(artistStats, 10, sortAr);
    const tAlbums = getTop(albumStats, 10, sortAl);
    const tGenres = getTop(genreStats, 10, sortG);

    const selectedTheme = rewindSettings.theme;

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
        <div class="Rewind-poster" style="background: ${selectedTheme};">
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
    requestAnimationFrame(fitRewindPosterToViewport);
};

// Download logic and backend response hook
window.downloadRewindPoster = function() {
    const poster = document.querySelector('.Rewind-poster');
    if (!poster) return alert("Please generate a Rewind poster first!");

    fitRewindPosterToViewport();
    poster.scrollIntoView({ block: 'center', inline: 'center' });

    // Capture after scrolling/scaling so Electron sees the full poster and doesn't crop it.
    requestAnimationFrame(() => {
        const bounds = poster.getBoundingClientRect();
        ipcRenderer.send('download-Rewind-poster', {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
        });
    });
};

ipcRenderer.on('backend-reply', (event, msg) => {
    if (msg.includes('Rewind') || msg.startsWith('Database saved') || msg.startsWith('Database save failed') || msg.startsWith('Database delete')) window.alert(msg);
});

// Boot up the databases and routing on startup
loadDatabases();
refreshPCSyncSetupStatus().then(async status => {
    if (status?.configured) await ensurePCSyncServerRunning({ quiet: true });
    if (window.location.hash === '#settings') renderSettingsView();
});
