const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { spawnSync } = require('child_process');

const rootDir = __dirname;
const outDir = path.join(rootDir, 'mobile-www');
const audioCacheDir = path.join(rootDir, '.mobile-audio-cache');
const ffmpegExe = fs.existsSync(path.join(rootDir, 'ffmpeg.exe'))
    ? path.join(rootDir, 'ffmpeg.exe')
    : 'ffmpeg';

const audioBitrate = process.env.NEWMUSIC_MOBILE_AUDIO_BITRATE || '112k';
const audioExtensions = new Set(['.wav', '.flac', '.aif', '.aiff', '.m4a', '.ogg']);
const ignoredNames = new Set(['Thumbs.db', '.DS_Store', 'desktop.ini']);
const filesToCopy = [
    'index.html',
    'style.css',
    'script.js',
    'database_artists.js',
    'database_albums.js',
    'logo.ico',
    'logo.png'
];

let convertedCount = 0;
let reusedCount = 0;
let copiedCount = 0;
let mobileSongsDatabaseContent = '';

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function toPosixPath(value) {
    return value.replace(/\\/g, '/');
}

function replaceExtension(relativePath, extension) {
    return relativePath.slice(0, -path.extname(relativePath).length) + extension;
}

function copyFile(relativePath) {
    const source = path.join(rootDir, relativePath);
    if (!fs.existsSync(source)) return;

    const destination = path.join(outDir, relativePath);
    ensureDir(destination);
    fs.copyFileSync(source, destination);
    copiedCount++;
}

function writeMobileSongsDatabase() {
    const source = path.join(rootDir, 'database_songs.js');
    const destination = path.join(outDir, 'database_songs.js');
    let content = fs.readFileSync(source, 'utf8');

    content = content.replace(
        /((?:["']?audio["']?)\s*:\s*["'])(\.?\/?assets\/[^"']+?)\.(wav|flac|aif|aiff|m4a|ogg)(["'])/gi,
        (match, prefix, audioPath, _ext, suffix) => `${prefix}${audioPath}.mp3${suffix}`
    );

    ensureDir(destination);
    fs.writeFileSync(destination, content, 'utf8');
    mobileSongsDatabaseContent = content;
    copiedCount++;
}

function readDatabaseFromScript(content, globalName) {
    const context = {};
    return vm.runInNewContext(`${content}\n${globalName};`, context);
}

function hashFile(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listSyncFiles(relativeDir) {
    const sourceDir = path.join(outDir, relativeDir);
    if (!fs.existsSync(sourceDir)) return [];

    const files = [];
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (ignoredNames.has(entry.name)) continue;

        const relativePath = path.join(relativeDir, entry.name);
        const sourcePath = path.join(outDir, relativePath);

        if (entry.isDirectory()) {
            files.push(...listSyncFiles(relativePath));
            continue;
        }

        if (!entry.isFile()) continue;

        files.push({
            path: toPosixPath(relativePath),
            size: fs.statSync(sourcePath).size,
            sha256: hashFile(sourcePath)
        });
    }

    return files;
}

function writeSyncManifest() {
    const artists = readDatabaseFromScript(
        fs.readFileSync(path.join(outDir, 'database_artists.js'), 'utf8'),
        'artistsDatabase'
    );
    const albums = readDatabaseFromScript(
        fs.readFileSync(path.join(outDir, 'database_albums.js'), 'utf8'),
        'albumsDatabase'
    );
    const songs = readDatabaseFromScript(mobileSongsDatabaseContent, 'songsDatabase');
    const files = listSyncFiles('assets').sort((a, b) => a.path.localeCompare(b.path));

    const manifest = {
        schemaVersion: 1,
        app: 'NewMusic PE',
        generatedAt: new Date().toISOString(),
        audioBitrate,
        counts: {
            artists: artists.length,
            albums: albums.length,
            songs: songs.length,
            files: files.length
        },
        databases: { artists, albums, songs },
        files
    };

    fs.writeFileSync(path.join(outDir, 'sync-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function shouldConvert(source, cachedOutput) {
    if (!fs.existsSync(cachedOutput)) return true;
    const sourceStats = fs.statSync(source);
    const cachedStats = fs.statSync(cachedOutput);
    return cachedStats.size === 0 || sourceStats.mtimeMs > cachedStats.mtimeMs;
}

function convertAudio(relativePath) {
    const source = path.join(rootDir, relativePath);
    const mp3RelativePath = replaceExtension(relativePath, '.mp3');
    const cachedOutput = path.join(audioCacheDir, mp3RelativePath);
    const destination = path.join(outDir, mp3RelativePath);

    ensureDir(cachedOutput);
    ensureDir(destination);

    if (shouldConvert(source, cachedOutput)) {
        console.log(`Converting ${toPosixPath(relativePath)} -> ${toPosixPath(mp3RelativePath)}`);
        const result = spawnSync(ffmpegExe, [
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            source,
            '-vn',
            '-codec:a',
            'libmp3lame',
            '-b:a',
            audioBitrate,
            cachedOutput
        ], { stdio: 'inherit' });

        if (result.status !== 0) {
            throw new Error(`Failed to convert ${relativePath}. Make sure ffmpeg.exe is available.`);
        }
        convertedCount++;
    } else {
        reusedCount++;
    }

    fs.copyFileSync(cachedOutput, destination);
}

function copyAssetsDirectory(relativeDir) {
    const sourceDir = path.join(rootDir, relativeDir);
    if (!fs.existsSync(sourceDir)) return;

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (ignoredNames.has(entry.name)) continue;

        const relativePath = path.join(relativeDir, entry.name);
        const sourcePath = path.join(rootDir, relativePath);

        if (entry.isDirectory()) {
            copyAssetsDirectory(relativePath);
            continue;
        }

        if (!entry.isFile()) continue;

        if (audioExtensions.has(path.extname(entry.name).toLowerCase())) {
            convertAudio(relativePath);
        } else {
            const destination = path.join(outDir, relativePath);
            ensureDir(destination);
            fs.copyFileSync(sourcePath, destination);
            copiedCount++;
        }
    }
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(audioCacheDir, { recursive: true });

filesToCopy.forEach(copyFile);
writeMobileSongsDatabase();
copyAssetsDirectory('assets');
writeSyncManifest();

console.log('');
console.log(`NewMusic PE mobile web bundle written to ${outDir}`);
console.log(`Audio bitrate: ${audioBitrate}`);
console.log(`Audio converted: ${convertedCount}`);
console.log(`Audio reused from cache: ${reusedCount}`);
console.log(`Other files copied: ${copiedCount}`);
