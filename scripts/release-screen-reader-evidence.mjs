#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const results = [];

function usage() {
  console.log(`Usage: npm run release:screen-reader-evidence -- [options]

Options:
  --audio-file <path>       Transcribe an existing VoiceOver recording.
  --record-voiceover        On macOS, open the target URL and record audio with
                            ffmpeg. Requires VOICEOVER_AUDIO_DEVICE.
  --url <url>               URL to open before recording. Default: local home.
  --expect <phrase>         Required transcript phrase. Repeatable.
  --model <name>            Whisper model. Default: base.
  --help                    Show this help.

Environment:
  WHISPER_COMMAND           Whisper executable. Default: whisper.
  VOICEOVER_AUDIO_DEVICE    ffmpeg avfoundation input, for example ":0" or
                            "BlackHole 2ch". Required for --record-voiceover.
  VOICEOVER_OPEN_APP        Optional macOS app name to open the target URL in,
                            for example Safari.
  VOICEOVER_RECORD_SECONDS  Recording length. Default: 20.
  VOICEOVER_CONTROL         Set to ensure-on to start VoiceOver when needed and
                            restore the prior state after recording. Set to
                            toggle to send Command+F5 before and after recording.
  VOICEOVER_TOGGLE          Set to 1 to toggle VoiceOver with Command+F5 before
                            and after recording. Deprecated; prefer
                            VOICEOVER_CONTROL=ensure-on.

This command can produce assisted screen-reader evidence from real speech when
release scope explicitly requires it.`);
}

if (help) {
  usage();
  process.exit(0);
}

function add(status, label, detail = '') {
  results.push({ status, label, detail });
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${status.padEnd(5)} ${label}${suffix}`);
}

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return result.status === 0;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function argValue(name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || '') : fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(String(args[index + 1]));
  }
  return values;
}

function run(command, commandArgs, label, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
  if (result.status === 0) {
    add('PASS', label, options.successDetail || 'completed');
    return result;
  }
  const detail = String(result.stderr || result.stdout || `${command} failed`)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-3)
    .join(' | ');
  add('FAIL', label, detail || `${command} failed`);
  return result;
}

function activateMacApp(appName) {
  if (!appName || process.platform !== 'darwin') return;
  spawnSync('osascript', ['-e', `tell application ${JSON.stringify(appName)} to activate`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function toggleVoiceOver() {
  return spawnSync('osascript', [
    '-e',
    'tell application "System Events" to key code 96 using {command down}'
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function sleepMs(milliseconds) {
  spawnSync('sleep', [String(Math.max(milliseconds, 0) / 1000)], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore']
  });
}

function voiceOverIsRunning() {
  const result = spawnSync('pgrep', ['-x', 'VoiceOver'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return result.status === 0;
}

function closeVoiceOverQuickstart() {
  spawnSync('osascript', ['-e', 'tell application "VoiceOver Quickstart" to quit'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  spawnSync('pkill', ['-f', 'VoiceOver Quickstart'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function startVoiceOver() {
  const started = spawnSync('open', ['-a', 'VoiceOver'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  sleepMs(1500);
  closeVoiceOverQuickstart();
  sleepMs(500);
  return started;
}

function stopVoiceOver() {
  spawnSync('osascript', ['-e', 'tell application "VoiceOver" to quit'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  sleepMs(1000);
  if (voiceOverIsRunning()) {
    spawnSync('pkill', ['-x', 'VoiceOver'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    sleepMs(500);
  }
}

function recordVoiceOverAudio(outputFile) {
  if (process.platform !== 'darwin') {
    add('SKIP', 'VoiceOver audio recording', 'macOS is required for local VoiceOver automation');
    return false;
  }
  if (!commandExists('ffmpeg')) {
    add('SKIP', 'VoiceOver audio recording', 'ffmpeg is not available');
    return false;
  }
  if (!commandExists('osascript')) {
    add('SKIP', 'VoiceOver audio recording', 'osascript is not available');
    return false;
  }

  const device = String(process.env.VOICEOVER_AUDIO_DEVICE || '').trim();
  if (!device) {
    add('SKIP', 'VoiceOver audio recording', 'set VOICEOVER_AUDIO_DEVICE to an ffmpeg avfoundation audio input');
    return false;
  }

  const control = String(process.env.VOICEOVER_CONTROL || '').trim()
    || (String(process.env.VOICEOVER_TOGGLE || '').trim() === '1' ? 'toggle' : 'none');
  const initiallyRunning = voiceOverIsRunning();
  let startedByScript = false;

  if (control === 'ensure-on') {
    if (initiallyRunning) {
      add('PASS', 'VoiceOver process before recording', 'VoiceOver was already running');
    } else {
      const started = startVoiceOver();
      if (started.status === 0 && voiceOverIsRunning()) {
        startedByScript = true;
        add('PASS', 'VoiceOver start before recording', 'VoiceOver is running');
      } else {
        add('WARN', 'VoiceOver start before recording', String(started.stderr || 'VoiceOver process was not detected').trim());
      }
    }
  } else if (control === 'toggle') {
    const toggled = toggleVoiceOver();
    if (toggled.status === 0) add('PASS', 'VoiceOver toggle before recording', 'Command+F5 sent');
    else add('WARN', 'VoiceOver toggle before recording', String(toggled.stderr || 'toggle failed').trim());
    sleepMs(1500);
    closeVoiceOverQuickstart();
    if (voiceOverIsRunning()) add('PASS', 'VoiceOver process before recording', 'VoiceOver is running');
    else add('WARN', 'VoiceOver process before recording', 'VoiceOver process was not detected after toggle');
  } else {
    add('SKIP', 'VoiceOver control before recording', 'VOICEOVER_CONTROL is not set; expecting VoiceOver to already be running if needed');
    if (voiceOverIsRunning()) add('PASS', 'VoiceOver process before recording', 'VoiceOver is running');
  }

  const url = argValue('--url', 'http://127.0.0.1:4002/');
  const openApp = String(process.env.VOICEOVER_OPEN_APP || '').trim();
  const openArgs = openApp ? ['-a', openApp, url] : [url];
  const openDetail = openApp ? `${url} in ${openApp}` : url;
  run('open', openArgs, 'Open target URL for VoiceOver recording', { successDetail: openDetail });
  activateMacApp(openApp);
  sleepMs(Number(process.env.VOICEOVER_OPEN_WAIT_MS || 2500) || 2500);

  const seconds = String(Number(process.env.VOICEOVER_RECORD_SECONDS || 20) || 20);
  const recorded = run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'avfoundation',
    '-i',
    device,
    '-t',
    seconds,
    '-y',
    outputFile
  ], 'VoiceOver audio recording', { successDetail: `${seconds}s to ${outputFile}` });

  if (control === 'ensure-on' && startedByScript) {
    stopVoiceOver();
    if (voiceOverIsRunning()) add('WARN', 'VoiceOver restore after recording', 'VoiceOver is still running');
    else add('PASS', 'VoiceOver restore after recording', 'VoiceOver stopped after script-started run');
  } else if (control === 'toggle') {
    const toggled = toggleVoiceOver();
    if (toggled.status === 0) add('PASS', 'VoiceOver toggle after recording', 'Command+F5 sent');
    else add('WARN', 'VoiceOver toggle after recording', String(toggled.stderr || 'toggle failed').trim());
  }

  return recorded.status === 0 && fs.existsSync(outputFile);
}

function transcribeAudio(audioFile, outputDir) {
  const whisper = String(process.env.WHISPER_COMMAND || 'whisper').trim();
  if (!commandExists(whisper)) {
    add('SKIP', 'Whisper transcription', `${whisper} is not available`);
    return '';
  }
  const model = argValue('--model', process.env.WHISPER_MODEL || 'base');
  const result = run(whisper, [
    audioFile,
    '--model',
    model,
    '--output_format',
    'txt',
    '--output_dir',
    outputDir
  ], 'Whisper transcription', { successDetail: `model ${model}` });
  if (result.status !== 0) return '';

  const transcriptPath = path.join(outputDir, `${path.basename(audioFile, path.extname(audioFile))}.txt`);
  if (!fs.existsSync(transcriptPath)) {
    add('FAIL', 'Whisper transcript file', `missing ${transcriptPath}`);
    return '';
  }
  const transcript = fs.readFileSync(transcriptPath, 'utf8').trim();
  add('PASS', 'Whisper transcript file', transcriptPath);
  return transcript;
}

function assertTranscript(transcript, expectedPhrases) {
  if (!transcript) return;
  const normalized = transcript.toLowerCase();
  const missing = expectedPhrases.filter((phrase) => !normalized.includes(String(phrase).toLowerCase()));
  if (missing.length) {
    add('FAIL', 'Screen-reader transcript expectations', `missing: ${missing.join(', ')}`);
  } else {
    add('PASS', 'Screen-reader transcript expectations', `matched: ${expectedPhrases.join(', ')}`);
  }
}

console.log('Store release screen-reader evidence');
console.log(`Generated: ${new Date().toISOString()}`);
console.log('');

const whisper = String(process.env.WHISPER_COMMAND || 'whisper').trim();
if (commandExists(whisper)) add('PASS', 'Whisper availability', whisper);
else add('SKIP', 'Whisper availability', `${whisper} not found`);

if (process.platform === 'darwin') add('PASS', 'VoiceOver host capability', 'macOS host detected');
else add('SKIP', 'VoiceOver host capability', `current platform is ${process.platform}`);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-screen-reader-evidence-'));
let audioFile = argValue('--audio-file', '');
const recordRequested = args.includes('--record-voiceover');

if (recordRequested) {
  audioFile = path.join(tempDir, 'voiceover-evidence.wav');
  if (!recordVoiceOverAudio(audioFile)) {
    audioFile = '';
    add('FAIL', 'Screen-reader transcript evidence', 'VoiceOver recording did not produce an audio file');
  }
}

if (audioFile) {
  if (!fs.existsSync(audioFile)) {
    add('FAIL', 'Screen-reader audio file', `${audioFile} does not exist`);
  } else {
    add('PASS', 'Screen-reader audio file', audioFile);
    const transcript = transcribeAudio(audioFile, tempDir);
    const expected = argValues('--expect');
    assertTranscript(transcript, expected.length ? expected : ['Shop']);
  }
} else if (!args.includes('--record-voiceover')) {
  add('SKIP', 'Screen-reader transcript evidence', 'pass --audio-file or --record-voiceover to generate transcript evidence');
}

const failCount = results.filter((entry) => entry.status === 'FAIL').length;
const warnCount = results.filter((entry) => entry.status === 'WARN').length;
const skipCount = results.filter((entry) => entry.status === 'SKIP').length;
console.log('');
console.log(`Summary: ${failCount} fail, ${warnCount} warn, ${skipCount} skip`);
if (failCount) process.exit(1);
