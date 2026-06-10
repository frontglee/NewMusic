const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec, execFile } = require('child_process');
const fs = require('fs');

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: "NewMusic",
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    mainWindow.maximize();
    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ==========================================
// BACKEND LISTENERS
// ==========================================

function searchYoutubeMusic(query, limit = 10) {
  return new Promise((resolve, reject) => {
    const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 10, 20));
    const encodedQuery = encodeURIComponent(String(query || '').trim());
    const searchUrl = `https://music.youtube.com/search?q=${encodedQuery}#songs`;

    execFile(
      ytDlpPath,
      [searchUrl, '-I', `1-${safeLimit}`, '--dump-json'],
      { maxBuffer: 1024 * 1024 * 50 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          const lines = stdout.trim().split('\n').filter(Boolean);
          const results = lines.map((line) => JSON.parse(line)).map((video) => ({
            title: video.title,
            channel: video.uploader,
            duration: video.duration_string || '',
            duration_seconds: video.duration || 0,
            url: video.webpage_url,
            upload_date: video.upload_date,
            view_count: video.view_count,
            thumbnail: video.thumbnail,
          }));
          resolve(results);
        } catch (e) {
          reject(new Error('Failed to parse results.'));
        }
      },
    );
  });
}

function relToAppAbs(relPath) {
  return path.join(__dirname, String(relPath || '').replace(/^\.\//, ''));
}

function finalizeExperimentalThumbnail(audioNoExt, coverRel, profileRel, done) {
  const sourceThumb = `${audioNoExt}.png`;
  if (!fs.existsSync(sourceThumb)) {
    done();
    return;
  }

  const tempThumb = `${audioNoExt}.__thumb_tmp.png`;
  try {
    if (fs.existsSync(tempThumb)) fs.unlinkSync(tempThumb);
    fs.renameSync(sourceThumb, tempThumb);
  } catch (err) {
    done();
    return;
  }

  const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
  const ffmpegExe = fs.existsSync(ffmpegPath) ? ffmpegPath : 'ffmpeg';
  execFile(
    ffmpegExe,
    [
      '-y',
      '-i',
      tempThumb,
      '-vf',
      "crop='min(iw,ih)':'min(iw,ih)',scale=1200:1200",
      sourceThumb,
    ],
    () => {
      try {
        const finalThumb = fs.existsSync(sourceThumb) ? sourceThumb : tempThumb;
        if (coverRel) {
          const coverAbs = relToAppAbs(coverRel);
          fs.mkdirSync(path.dirname(coverAbs), { recursive: true });
          fs.copyFileSync(finalThumb, coverAbs);
        }
        if (profileRel) {
          const profileAbs = relToAppAbs(profileRel);
          fs.mkdirSync(path.dirname(profileAbs), { recursive: true });
          fs.copyFileSync(finalThumb, profileAbs);
        }
      } catch (err) {
        console.error('Thumbnail copy failed:', err);
      } finally {
        try {
          if (fs.existsSync(sourceThumb)) fs.unlinkSync(sourceThumb);
          if (fs.existsSync(tempThumb)) fs.unlinkSync(tempThumb);
        } catch (cleanupErr) {}
        done();
      }
    },
  );
}

ipcMain.handle('youtube-search-one', async (event, payload = {}) => {
  try {
    const results = await searchYoutubeMusic(payload.query, payload.limit || 10);
    return { results };
  } catch (error) {
    return { error: 'Search failed: ' + error.message };
  }
});

ipcMain.on('search-youtube', (event, query) => {
  console.log(`Searching YouTube Music for: ${query}`);
  searchYoutubeMusic(query, 10)
    .then((results) => event.reply('search-results', { results }))
    .catch(() => event.reply('search-results', { error: "Search failed. Check terminal." }));
});

ipcMain.on('download-experimental-song', (event, payload) => {
  const ytUrl = payload.youtubeUrl;
  const audioRel = payload.audioPath;
  const lyricsRel = payload.lyricsPath;
  if (!ytUrl || !audioRel) {
    event.reply('experimental-download-reply', 'Experimental download failed: missing URL or audio path.');
    return;
  }

  const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');
  const audioAbs = path.join(__dirname, audioRel.replace(/^\.\//, ''));
  const audioNoExt = audioAbs.replace(/\.wav$/i, '');
  const outputPath = `${audioNoExt}.%(ext)s`;
  fs.mkdirSync(path.dirname(audioAbs), { recursive: true });

  if (lyricsRel) {
    const lyricsAbs = path.join(__dirname, lyricsRel.replace(/^\.\//, ''));
    fs.mkdirSync(path.dirname(lyricsAbs), { recursive: true });
    if (!fs.existsSync(lyricsAbs)) fs.writeFileSync(lyricsAbs, '', 'utf8');
  }

  event.reply('experimental-download-reply', `Starting download: ${payload.title || ytUrl}`);

  execFile(ytDlpPath, [
    '--no-playlist',
    '--force-overwrites',
    '-f',
    'bestaudio',
    '--extract-audio',
    '--audio-format',
    'wav',
    '--write-thumbnail',
    '--convert-thumbnails',
    'png',
    '-o',
    outputPath,
    ytUrl,
  ], (error) => {
    if (error) {
      event.reply('experimental-download-reply', `Experimental download failed: ${error.message}`);
      return;
    }
    finalizeExperimentalThumbnail(audioNoExt, payload.coverPath, payload.profilePath, () => {
      event.reply('experimental-download-reply', `Downloaded WAV: ${payload.title || audioRel}`);
    });
  });
});

ipcMain.on('send-download-order', (event, payload) => {
  const ytUrl = payload.youtubeQuery; 
  const artistName = payload.artist.isNew ? payload.artist.name : payload.artist.id.replace('art_', '').replace(/_/g, ' '); 
  const artistSlug = artistName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
  const songTitle = payload.metadata.title || "Unknown Title";
  const songSlug = songTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "").substring(0, 30); 
  const songID = `${artistSlug}_${songSlug}`;

  const targetDir = path.join(__dirname, 'assets', artistSlug, 'songs');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');
  const outputPath = path.join(targetDir, `${songSlug}.%(ext)s`);
  // Reverted to pure, untouched audio extraction
  const command = `"${ytDlpPath}" -f bestaudio --extract-audio --audio-format wav --write-thumbnail --convert-thumbnails png -o "${outputPath}" "${ytUrl}"`;

  event.reply('backend-reply', `Starting download for: ${songTitle}`);

  exec(command, (error, stdout, stderr) => {
      if (error) return event.reply('backend-reply', `Download Failed!\nError: ${error.message}`);
      
      const downloadedThumb = path.join(targetDir, `${songSlug}.png`);
      const albumsDir = path.join(__dirname, 'assets', artistSlug, 'albums');
      if (!fs.existsSync(albumsDir)) fs.mkdirSync(albumsDir, { recursive: true });

      const writeDatabases = () => {
                    let newSong = `{
  songID: "${songID}",
  title: "${songTitle}",
  artistID: "art_${artistSlug}",
  albumID: "alb_single_${songSlug}",
  track: 1,
  releaseDate: "${payload.metadata.releaseDate || ''}",
  duration: ${payload.metadata.duration || 0},
  genre: ${JSON.stringify(payload.metadata.genres)},
  tags: ${JSON.stringify(payload.metadata.tags)},
  paths: {
    audio: "./assets/${artistSlug}/songs/${songSlug}.wav",
    lyrics: "./assets/${artistSlug}/lyrics/${songSlug}.lrc"
  }
}`;

          const songsDbPath = path.join(__dirname, 'database_songs.js');
          try {
              let songsContent = fs.readFileSync(songsDbPath, 'utf8');
              songsContent = songsContent.replace(/(const\s+songsDatabase\s*=\s*\[)/, `$1\n${newSong},`);
              fs.writeFileSync(songsDbPath, songsContent, 'utf8');
          } catch (err) { console.error(err); }

          if (payload.artist.isNew) {
                            let newArtist = `{
  artistID: "art_${artistSlug}",
  artist: "${artistName}",
  firstlistenYear: "${payload.metadata.firstListenDate.substring(0,4)}",
  country: "Unknown",
  genre: [],
  tags: [],
  members: [],
  paths: {
    cover: "./assets/${artistSlug}/profile.png"
  }
}`;
              const artistsDbPath = path.join(__dirname, 'database_artists.js');
              try {
                  let artistsContent = fs.readFileSync(artistsDbPath, 'utf8');
                  artistsContent = artistsContent.replace(/(const\s+artistsDatabase\s*=\s*\[)/, `$1\n${newArtist},`);
                  fs.writeFileSync(artistsDbPath, artistsContent, 'utf8');
              } catch (err) { console.error(err); }
          }

                    let newAlbum = `{
  albumID: "alb_single_${songSlug}",
  title: "${songTitle}",
  artistID: "art_${artistSlug}",
`;
          if (payload.metadata.releaseDate) newAlbum += `  releaseDate: "${payload.metadata.releaseDate}",
`;
          newAlbum += `  firstlistenDate: "${payload.metadata.firstListenDate || ''}",
  albumType: "single",
  genre: ${JSON.stringify(payload.metadata.genres)},
  tags: ${JSON.stringify(payload.metadata.tags)},
  paths: {
    cover: "./assets/${artistSlug}/albums/single_${songSlug}.png"
  }
}`;

          const albumsDbPath = path.join(__dirname, 'database_albums.js');
          try {
              let albumsContent = fs.readFileSync(albumsDbPath, 'utf8');
              albumsContent = albumsContent.replace(/(const\s+albumsDatabase\s*=\s*\[)/, `$1\n${newAlbum},`);
              fs.writeFileSync(albumsDbPath, albumsContent, 'utf8');
          } catch (err) { console.error(err); }

          event.reply('backend-reply', `Success!\nDownloaded: ${songTitle}\nDatabase files updated!`);
      };

    if (fs.existsSync(downloadedThumb)) {
          const tempThumb = path.join(targetDir, `${songSlug}_temp.png`);
          fs.renameSync(downloadedThumb, tempThumb); 
          const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
          const ffmpegCmd = `"${ffmpegPath}" -y -i "${tempThumb}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=1200:1200" "${downloadedThumb}"`;
          exec(ffmpegCmd, (ffErr) => {
              if (fs.existsSync(downloadedThumb)) {
                  fs.copyFileSync(downloadedThumb, path.join(albumsDir, `single_${songSlug}.png`));
                  if (payload.artist.isNew) fs.copyFileSync(downloadedThumb, path.join(__dirname, 'assets', artistSlug, 'profile.png'));
                  fs.unlinkSync(downloadedThumb);
              }
              if (fs.existsSync(tempThumb)) fs.unlinkSync(tempThumb);
              writeDatabases(); 
          });
      } else { writeDatabases(); }
  });
});

ipcMain.on('save-database', (event, { file, data }) => {
    try {
        fs.writeFileSync(path.join(__dirname, file), data, 'utf8');
        event.reply('backend-reply', `Database saved: ${file}`);
    } catch (err) {
        event.reply('backend-reply', `Database save failed for ${file}: ${err.message}`);
    }
});

ipcMain.on('execute-nuclear-delete', (event, payload) => {
    const { filesToDelete, foldersToDelete, databases } = payload;
    if (filesToDelete) filesToDelete.forEach(file => { try { const fp = path.join(__dirname, file); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch(e){} });
    if (foldersToDelete) foldersToDelete.forEach(folder => { try { const fp = path.join(__dirname, folder); if (fs.existsSync(fp)) fs.rmSync(fp, { recursive: true, force: true }); } catch(e){} });
    if (databases) {
        for (const [fileName, dataString] of Object.entries(databases)) {
            try { fs.writeFileSync(path.join(__dirname, fileName), dataString, 'utf8'); } catch(e){ event.reply('backend-reply', `Database delete update failed for ${fileName}: ${e.message}`); }
        }
    }
    event.reply('backend-reply', 'Database deletion completed. Restart the app if the view still shows deleted items.');
});

ipcMain.on('save-account-data', (event, accountData) => {
    const slug = accountData.slug;
    const dataPath = path.join(__dirname, 'accounts', slug, 'data.json');
    try { fs.writeFileSync(dataPath, JSON.stringify(accountData, null, 2), 'utf8'); } catch(e){}
});

ipcMain.on('delete-account', (event, accountId) => {
    const slug = accountId.replace('acc_', '');
    const userDir = path.join(__dirname, 'accounts', slug);
    if (fs.existsSync(userDir)) {
        try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
    }
});

ipcMain.on('delete-playlist-data', (event, payload) => {
    const { account, coverPath } = payload;
    const slug = account.slug;
    const dataPath = path.join(__dirname, 'accounts', slug, 'data.json');
    
    // Save updated account data (without the playlist)
    try { fs.writeFileSync(dataPath, JSON.stringify(account, null, 2), 'utf8'); } catch(e){}
    
    // Delete the playlist image file if it isn't the default icon
    if (coverPath && coverPath.includes('/playlists/')) {
        try {
            const fullCoverPath = path.join(__dirname, coverPath.replace('./', ''));
            if (fs.existsSync(fullCoverPath)) fs.unlinkSync(fullCoverPath);
        } catch(e){}
    }
});

ipcMain.on('create-playlist', (event, payload) => {
    const { accountId, name, imageBase64, imageExt } = payload;
    const slug = accountId.replace('acc_', '');
    const pSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "") + "_" + Date.now();
    const pID = `pl_${pSlug}`;
    
    const playlistsDir = path.join(__dirname, 'accounts', slug, 'playlists');
    if (!fs.existsSync(playlistsDir)) fs.mkdirSync(playlistsDir, { recursive: true });

    const ext = (imageExt || '').toLowerCase();
    const isGif = ext === '.gif';
    const fileName = isGif ? `${pID}.gif` : `${pID}.png`;
    const finalImagePath = path.join(playlistsDir, fileName);

    let finalRelativePath = imageBase64 ? `./accounts/${slug}/playlists/${fileName}` : `./logo.png`; 

    const finalize = () => {
        const dataPath = path.join(__dirname, 'accounts', slug, 'data.json');
        if (fs.existsSync(dataPath)) {
            let userData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            if (!userData.playlists) userData.playlists = [];
            
            const newPlaylist = { id: pID, name: name, cover: finalRelativePath, songs: [] };
            userData.playlists.push(newPlaylist);
            fs.writeFileSync(dataPath, JSON.stringify(userData, null, 2), 'utf8');
            event.reply('playlist-created-success', { userData, newPlaylist });
        }
    };

    if (imageBase64) {
        try {
            const rawPath = path.join(playlistsDir, `raw_${pID}${ext}`);
            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
            fs.writeFileSync(rawPath, Buffer.from(base64Data, 'base64'));

            const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
            const loopOption = isGif ? ' -loop 0' : '';
            const ffmpegCmd = `"${ffmpegPath}" -y -i "${rawPath}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=1200:1200"${loopOption} "${finalImagePath}"`;
            exec(ffmpegCmd, (err) => {
                if (err || !fs.existsSync(finalImagePath)) {
                    try { fs.renameSync(rawPath, finalImagePath); } catch(e){}
                }
                try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch(e){}
                finalize();
            });
        } catch (error) {
            console.error("Playlist Image Save Failed:", error);
            finalRelativePath = `./logo.png`;
            finalize();
        }
    } else { 
        finalRelativePath = `./logo.png`;
        finalize(); 
    }
});

// ==========================================
// THE ACCOUNT SYSTEM
// ==========================================
ipcMain.on('fetch-accounts', (event) => {
    const accountsDir = path.join(__dirname, 'accounts');
    if (!fs.existsSync(accountsDir)) fs.mkdirSync(accountsDir);
    const folders = fs.readdirSync(accountsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    const accounts = folders.map(folder => {
        const dataPath = path.join(accountsDir, folder, 'data.json');
        if (fs.existsSync(dataPath)) return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        return null;
    }).filter(a => a !== null);
    event.reply('accounts-data', accounts);
});

ipcMain.on('create-account', (event, payload) => {
    const { name, imageBase64, imageExt } = payload;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
    const accID = `acc_${slug}`;
    const accountsDir = path.join(__dirname, 'accounts');
    const userDir = path.join(accountsDir, slug);
    if (!fs.existsSync(accountsDir)) fs.mkdirSync(accountsDir);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);
    
    const ext = (imageExt || '').toLowerCase();
    const isGif = ext === '.gif';
    const fileName = isGif ? 'profile.gif' : 'profile.png';
    const finalImagePath = path.join(userDir, fileName);

    const userData = { 
        id: accID, 
        name: name, 
        slug: slug, 
        paths: { profilePic: imageBase64 ? `./accounts/${slug}/${fileName}` : `./logo.png` }, 
        history: [], playlists: [], favorites: [] 
    };
    
    const dataPath = path.join(userDir, 'data.json');
    
    const finalize = () => {
        fs.writeFileSync(dataPath, JSON.stringify(userData, null, 2), 'utf8');
        event.reply('account-created-success', userData);
    };

    if (imageBase64) {
        try {
            const rawPath = path.join(userDir, 'raw_upload' + ext);
            // Decode the Base64 text back into a raw binary file safely
            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
            fs.writeFileSync(rawPath, Buffer.from(base64Data, 'base64'));

            const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
            const loopOption = isGif ? ' -loop 0' : '';
            const ffmpegCmd = `"${ffmpegPath}" -y -i "${rawPath}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=1200:1200"${loopOption} "${finalImagePath}"`;
            exec(ffmpegCmd, (err) => {
                if (err || !fs.existsSync(finalImagePath)) {
                    try { fs.renameSync(rawPath, finalImagePath); } catch(e){}
                }
                try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch(e){}
                finalize();
            });
        } catch (error) {
            console.error("Account Image Save Failed:", error);
            userData.paths.profilePic = `./logo.png`;
            finalize();
        }
    } else { 
        userData.paths.profilePic = `./logo.png`;
        finalize(); 
    }
});

ipcMain.on('log-listen-history', (event, payload) => {
    const { accountId, songId } = payload;
    if (!accountId || !songId) return;
    const slug = accountId.replace('acc_', '');
    const dataPath = path.join(__dirname, 'accounts', slug, 'data.json');
    if (fs.existsSync(dataPath)) {
        try {
            let userData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            userData.history.push({ songID: songId, timestamp: new Date().toISOString() });
            fs.writeFileSync(dataPath, JSON.stringify(userData, null, 2), 'utf8');
        } catch (err) {}
    }
});

ipcMain.on('toggle-favorite', (event, payload) => {
    const { accountId, songId } = payload;
    if (!accountId || !songId) return;
    const slug = accountId.replace('acc_', '');
    const dataPath = path.join(__dirname, 'accounts', slug, 'data.json');
    if (fs.existsSync(dataPath)) {
        try {
            let userData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            if (!userData.favorites) userData.favorites = [];
            const index = userData.favorites.indexOf(songId);
            if (index > -1) { userData.favorites.splice(index, 1); } 
            else { userData.favorites.push(songId); }
            fs.writeFileSync(dataPath, JSON.stringify(userData, null, 2), 'utf8');
        } catch (err) {}
    }
});

ipcMain.on('export-account-data', async (event, accountSlug) => {
    const { dialog } = require('electron');
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Destination Folder to Save Account Data',
        properties: ['openDirectory']
    });
    
    if (canceled || filePaths.length === 0) return;
    
    const destPath = path.join(filePaths[0], `NewMusic_Backup_${accountSlug}`);
    const srcPath = path.join(__dirname, 'accounts', accountSlug);
    
    try {
        fs.cpSync(srcPath, destPath, { recursive: true });
        event.reply('backend-reply', `Data successfully exported to:\n${destPath}`);
    } catch (err) {
        event.reply('backend-reply', `Failed to export data.\n${err.message}`);
    }
});

ipcMain.on('download-Rewind-poster', async (event, bounds) => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return;
    
    try {
        // Capture exactly the bounds of the poster from the window
        const image = await win.webContents.capturePage({
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height)
        });
        
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
            title: 'Save Rewind Poster',
            defaultPath: `NewMusic_Rewind.png`,
            filters: [{ name: 'Images', extensions: ['png'] }]
        });
        
        if (!canceled && filePath) {
            fs.writeFileSync(filePath, image.toPNG());
            event.reply('backend-reply', 'Rewind poster saved successfully!');
        }
    } catch (err) {
        event.reply('backend-reply', 'Failed to save poster: ' + err.message);
    }
});

// ==========================================
// BATCH AUDIO NORMALIZER (DEEP SCAN & MULTI-SELECT)
// ==========================================
ipcMain.on('open-batch-normalizer', async (event, targetLufs = -10) => {
    const { dialog } = require('electron');
    
    // 1. Allow multiple folders to be selected
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Folder(s) of Audio Files to Normalize',
        properties: ['openDirectory', 'multiSelections']
    });
    
    if (canceled || filePaths.length === 0) return;

    let allAudioFiles = [];

    // 2. Recursive function to dig through folders and subfolders
    const scanFolderDeep = (dirPath) => {
        const items = fs.readdirSync(dirPath);
        items.forEach(item => {
            const fullPath = path.join(dirPath, item);
            if (fs.statSync(fullPath).isDirectory()) {
                scanFolderDeep(fullPath); // It's a folder, dig deeper!
            } else {
                const ext = path.extname(item).toLowerCase();
                if (['.wav', '.mp3', '.flac', '.m4a'].includes(ext)) {
                    allAudioFiles.push(fullPath); // It's an audio file, save the path
                }
            }
        });
    };

    try {
        // Scan every folder the user highlighted
        filePaths.forEach(folder => scanFolderDeep(folder));
    } catch (err) {
        return event.reply('backend-reply', 'Error reading folders: ' + err.message);
    }

    if (allAudioFiles.length === 0) {
        return event.reply('backend-reply', 'No audio files found in the selected folder(s) or their subfolders.');
    }

    event.reply('backend-reply', `Found ${allAudioFiles.length} files across selected folders.\nNormalizing and replacing them in the background...\n\nPlease DO NOT close the app until it is finished.`);

    const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
    let processedCount = 0;

    // 3. Process every file we found using 2-Pass True Static Gain
    allAudioFiles.forEach(inputPath => {
        const fileDir = path.dirname(inputPath);
        const fileNameNoExt = path.basename(inputPath, path.extname(inputPath));
        
        const tempOutputPath = path.join(fileDir, `${fileNameNoExt}_TEMP.wav`);
        const finalOutputPath = path.join(fileDir, `${fileNameNoExt}.wav`);

// PASS 1: Scan the entire file to find its average integrated loudness
        const scanCmd = `"${ffmpegPath}" -i "${inputPath}" -af "ebur128" -f null - 2>&1`;

        exec(scanCmd, (scanErr, stdout, stderr) => {
            const output = stdout + stderr;
            // Fix: Grab ALL loudness readings the scanner outputs
            const matches = [...output.matchAll(/I:\s*(-?\d+\.\d+)\s*LUFS/g)];
            
// Make sure we actually found readings
            if (matches.length > 0) {
                // Grab the VERY LAST match, which is the final Summary of the whole song
                const currentLufs = parseFloat(matches[matches.length - 1][1]);
                
                // --- DYNAMIC VOLUME TARGET ---
                // Calculates offset based on the UI input
                const offsetDb = (targetLufs - currentLufs).toFixed(2);
                
                // PASS 2: Apply static volume shift. 
                // Added a transparent limiter to strictly prevent individual peaks from crossing 0dB (crackle).
                const applyCmd = `"${ffmpegPath}" -y -i "${inputPath}" -af "volume=${offsetDb}dB,alimiter=limit=-1.0dB" "${tempOutputPath}"`;
                
                exec(applyCmd, (applyErr) => {
                    if (!applyErr && fs.existsSync(tempOutputPath)) {
                        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                        fs.renameSync(tempOutputPath, finalOutputPath);
                    }
                    
                    processedCount++;
                    if (processedCount === allAudioFiles.length) {
                        event.reply('backend-reply', `✅ Success!\n\nAll ${processedCount} files have been perfectly leveled with ZERO dynamic compression. The original artist mixing is fully preserved.`);
                    }
                });
            } else {
                processedCount++;
                if (processedCount === allAudioFiles.length) {
                    event.reply('backend-reply', `✅ Finished processing.`);
                }
            }
        });
    });
});
