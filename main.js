const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');

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

ipcMain.on('search-youtube', (event, query) => {
  console.log(`Searching YouTube Music for: ${query}`);
  // Dynamically resolve to the app's root directory
  const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://music.youtube.com/search?q=${encodedQuery}#songs`;
  const searchCommand = `"${ytDlpPath}" "${searchUrl}" -I 1-5 --dump-json`;

  exec(searchCommand, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
    if (error) return event.reply('search-results', { error: "Search failed. Check terminal." });
    try {
      const lines = stdout.trim().split('\n');
      const results = lines.map(line => JSON.parse(line)).map(video => ({
        title: video.title,
        channel: video.uploader,
        duration: video.duration_string,
        url: video.webpage_url,
        upload_date: video.upload_date,
        thumbnail: video.thumbnail 
      }));
      event.reply('search-results', { results });
    } catch (e) {
      event.reply('search-results', { error: "Failed to parse results." });
    }
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
  const command = `"${ytDlpPath}" -f bestaudio --extract-audio --audio-format wav --write-thumbnail --convert-thumbnails png -o "${outputPath}" "${ytUrl}"`;

  event.reply('backend-reply', `Starting download for: ${songTitle}`);

  exec(command, (error, stdout, stderr) => {
      if (error) return event.reply('backend-reply', `Download Failed!\nError: ${error.message}`);
      
      const downloadedThumb = path.join(targetDir, `${songSlug}.png`);
      const albumsDir = path.join(__dirname, 'assets', artistSlug, 'albums');
      if (!fs.existsSync(albumsDir)) fs.mkdirSync(albumsDir, { recursive: true });

      const writeDatabases = () => {
          let newSong = `{\n  "songID": "${songID}",\n  "title": "${songTitle}",\n  "artistID": "art_${artistSlug}",\n  "albumID": "alb_single_${songSlug}",\n  "track": 1,\n`;
          if (payload.metadata.releaseDate) newSong += `  "releaseDate": "${payload.metadata.releaseDate}",\n`;
          newSong += `  "duration": ${payload.metadata.duration || 0},\n  "genre": ${JSON.stringify(payload.metadata.genres)},\n  "tags": ${JSON.stringify(payload.metadata.tags)},\n  "paths": {\n    "audio": "./assets/${artistSlug}/songs/${songSlug}.wav",\n    "lyrics": "./assets/${artistSlug}/lyrics/${songSlug}.lrc"\n  }\n}`;

          const songsDbPath = path.join(__dirname, 'database_songs.js');
          try {
              let songsContent = fs.readFileSync(songsDbPath, 'utf8');
              songsContent = songsContent.replace(/(const\s+songsDatabase\s*=\s*\[)/, `$1\n${newSong},`);
              fs.writeFileSync(songsDbPath, songsContent, 'utf8');
          } catch (err) { console.error(err); }

          if (payload.artist.isNew) {
              let newArtist = `{\n  "artistID": "art_${artistSlug}",\n  "artist": "${artistName}",\n  "firstlistenYear": "${payload.metadata.firstListenDate.substring(0,4)}",\n  "country": "Unknown",\n  "genre": [],\n  "tags": [],\n  "members": [],\n  "paths": {\n    "cover": "./assets/${artistSlug}/profile.png"\n  }\n}`;
              const artistsDbPath = path.join(__dirname, 'database_artists.js');
              try {
                  let artistsContent = fs.readFileSync(artistsDbPath, 'utf8');
                  artistsContent = artistsContent.replace(/(const\s+artistsDatabase\s*=\s*\[)/, `$1\n${newArtist},`);
                  fs.writeFileSync(artistsDbPath, artistsContent, 'utf8');
              } catch (err) { console.error(err); }
          }

          let newAlbum = `{\n  "albumID": "alb_single_${songSlug}",\n  "title": "${songTitle} - Single",\n  "artistID": "art_${artistSlug}",\n`;
          if (payload.metadata.releaseDate) newAlbum += `  "releaseDate": "${payload.metadata.releaseDate}",\n`;
          newAlbum += `  "firstlistenDate": "${payload.metadata.firstListenDate || ''}",\n  "albumType": "single",\n  "genre": ${JSON.stringify(payload.metadata.genres)},\n  "tags": ${JSON.stringify(payload.metadata.tags)},\n  "paths": {\n    "cover": "./assets/${artistSlug}/albums/single_${songSlug}.png"\n  }\n}`;

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
    try { fs.writeFileSync(path.join(__dirname, file), data, 'utf8'); } catch (err) {}
});

ipcMain.on('execute-nuclear-delete', (event, payload) => {
    const { filesToDelete, foldersToDelete, databases } = payload;
    if (filesToDelete) filesToDelete.forEach(file => { try { const fp = path.join(__dirname, file); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch(e){} });
    if (foldersToDelete) foldersToDelete.forEach(folder => { try { const fp = path.join(__dirname, folder); if (fs.existsSync(fp)) fs.rmSync(fp, { recursive: true, force: true }); } catch(e){} });
    if (databases) {
        for (const [fileName, dataString] of Object.entries(databases)) {
            try { fs.writeFileSync(path.join(__dirname, fileName), dataString, 'utf8'); } catch(e){}
        }
    }
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
    const { accountId, name, imagePath } = payload;
    const slug = accountId.replace('acc_', '');
    const pSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "") + "_" + Date.now();
    const pID = `pl_${pSlug}`;
    
    const playlistsDir = path.join(__dirname, 'accounts', slug, 'playlists');
    if (!fs.existsSync(playlistsDir)) fs.mkdirSync(playlistsDir, { recursive: true });

    let finalImagePath = `./logo.ico`; 
    const targetImageFile = path.join(playlistsDir, `${pID}.png`);

    const finalize = () => {
        const dataPath = path.join(__dirname, 'accounts', slug, 'data.json');
        if (fs.existsSync(dataPath)) {
            let userData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            if (!userData.playlists) userData.playlists = [];
            
            const newPlaylist = { id: pID, name: name, cover: finalImagePath, songs: [] };
            userData.playlists.push(newPlaylist);
            fs.writeFileSync(dataPath, JSON.stringify(userData, null, 2), 'utf8');
            event.reply('playlist-created-success', { userData, newPlaylist });
        }
    };

    if (imagePath && fs.existsSync(imagePath)) {
        const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
        const ffmpegCmd = `"${ffmpegPath}" -y -i "${imagePath}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=1200:1200" "${targetImageFile}"`;
        exec(ffmpegCmd, (err) => {
            if (err) {
                // FALLBACK: If FFmpeg fails for any reason, just copy the raw file
                try { fs.copyFileSync(imagePath, targetImageFile); } catch(e){}
            }
            // Always set the final path to the copied/converted image
            finalImagePath = `./accounts/${slug}/playlists/${pID}.png`;
            finalize();
        });
    } else { finalize(); }
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
    const { name, imagePath } = payload;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
    const accID = `acc_${slug}`;
    const accountsDir = path.join(__dirname, 'accounts');
    const userDir = path.join(accountsDir, slug);
    if (!fs.existsSync(accountsDir)) fs.mkdirSync(accountsDir);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);
    
    const userData = { id: accID, name: name, slug: slug, paths: { profilePic: `./accounts/${slug}/profile.png` }, history: [], playlists: [], favorites: [] };
    const dataPath = path.join(userDir, 'data.json');
    fs.writeFileSync(dataPath, JSON.stringify(userData, null, 2), 'utf8');
    
    const finalImagePath = path.join(userDir, 'profile.png');
    if (imagePath && fs.existsSync(imagePath)) {
        const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
        const ffmpegCmd = `"${ffmpegPath}" -y -i "${imagePath}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=1200:1200" "${finalImagePath}"`;
        exec(ffmpegCmd, (err) => {
            if (err) fs.copyFileSync(imagePath, finalImagePath);
            event.reply('account-created-success', userData);
        });
    } else { event.reply('account-created-success', userData); }
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