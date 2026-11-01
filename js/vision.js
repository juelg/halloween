// Camera + on-device perception. No frame leaves this module except through
// grabJpeg() (one in-memory frame for one Claude reaction) and grabSelfie().

import { CONFIG } from './config.js?v=20261031203544';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const GESTURE_MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

// GPU is faster but not available everywhere; fall back to CPU.
async function withDelegate(create) {
  try {
    return await create('GPU');
  } catch {
    return await create('CPU');
  }
}

export class Vision extends EventTarget {
  constructor(video) {
    super();
    this.video = video;
    this.stream = null;
    this.detector = null;
    this.gesture = null;
    this.timer = null;
    this.coverTimer = null;
    this.faces = []; // [{w, cx, cy, score}] normalised to frame width/height
    this.covered = false;
    this.coverSince = 0;
    this.coverFired = false;
    this.small = document.createElement('canvas');
    this.small.width = 32;
    this.small.height = 24;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async start(progress = () => {}) {
    const constraints = {
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      // Mic denied or missing shouldn't stop the robot from seeing.
      this.stream = await navigator.mediaDevices.getUserMedia({ video: constraints.video });
    }
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play();
    progress(`camera ${this.video.videoWidth}x${this.video.videoHeight}`);
    this.setupAudio();
    // A failed model download (party wifi…) must not stop the robot: keep the
    // camera, cover detection and manual reactions, and keep retrying.
    const load = async (attempt = 1) => {
      if (this.detector) return progress('face detector ready');
      try {
        await this.loadDetector();
        progress('face detector loaded');
      } catch (e) {
        progress(`face detector failed (${e.message}); retry ${attempt} in 15 s`);
        setTimeout(() => load(attempt + 1), 15000);
      }
    };
    await load();
  }

  setupAudio() {
    const track = this.stream.getAudioTracks()[0];
    if (!track) return;
    try {
      const ctx = (this.audioCtx = new AudioContext());
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      this.audioBuf = new Uint8Array(this.analyser.fftSize);
    } catch {}
  }

  // 0..1 rough loudness
  get audioLevel() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.audioBuf);
    let sum = 0;
    for (const v of this.audioBuf) sum += (v - 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.audioBuf.length) / 40);
  }

  async vision() {
    if (!this._vision) {
      this._vision = (async () => {
        const mp = await import(MP + '/vision_bundle.mjs');
        const fileset = await mp.FilesetResolver.forVisionTasks(MP + '/wasm');
        return { mp, fileset };
      })();
    }
    return this._vision;
  }

  async loadDetector() {
    const { mp, fileset } = await this.vision();
    this.detector = await withDelegate((delegate) =>
      mp.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: 'VIDEO',
        minDetectionConfidence: CONFIG.trigger.minDetectionScore,
      })
    );
  }

  async loadGesture() {
    if (this.gesture) return this.gesture;
    const { mp, fileset } = await this.vision();
    this.gesture = await withDelegate((delegate) =>
      mp.GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: GESTURE_MODEL, delegate },
        runningMode: 'VIDEO',
        numHands: 4,
      })
    );
    return this.gesture;
  }

  run(fps) {
    clearInterval(this.timer);
    clearInterval(this.coverTimer);
    this.timer = setInterval(() => this.detect(), 1000 / fps);
    this.coverTimer = setInterval(() => this.checkCover(), CONFIG.cover.sampleMs);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.coverTimer);
  }

  // Stop detection and turn the camera and mic off (STOP ROBOT).
  release() {
    this.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.audioCtx?.close?.().catch(() => {});
    this.audioCtx = null;
    this.analyser = null;
    this.faces = [];
  }

  detect() {
    const v = this.video;
    if (!this.detector || v.readyState < 2) return;
    try {
      const res = this.detector.detectForVideo(v, performance.now());
      const W = v.videoWidth, H = v.videoHeight;
      this.faces = (res.detections || []).map((d) => {
        const b = d.boundingBox;
        return {
          w: b.width / W,
          cx: (b.originX + b.width / 2) / W,
          cy: (b.originY + b.height / 2) / H,
          score: d.categories?.[0]?.score ?? 0,
        };
      });
      this.emit('faces', this.faces);
    } catch (e) {
      this.emit('error', e);
    }
  }

  // Dark + flat frame for a while = Tobi's hand over the lens.
  checkCover() {
    const v = this.video;
    if (v.readyState < 2) return;
    const ctx = this.small.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, 32, 24);
    const d = ctx.getImageData(0, 0, 32, 24).data;
    let sum = 0, sq = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += l;
      sq += l * l;
    }
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sq / n - mean * mean));
    this.luma = { mean, std };
    const dark = mean < CONFIG.cover.maxMeanLuma && std < CONFIG.cover.maxLumaStd;
    const now = performance.now();
    if (dark && !this.covered) {
      this.covered = true;
      this.coverSince = now;
      this.coverFired = false;
    } else if (!dark && this.covered) {
      this.covered = false;
    }
    if (this.covered && !this.coverFired && now - this.coverSince >= CONFIG.cover.holdMs) {
      this.coverFired = true;
      this.emit('cover');
    }
  }

  // Thumbs-up check on the current frame.
  thumbsUp() {
    if (!this.gesture || this.video.readyState < 2) return false;
    const res = this.gesture.recognizeForVideo(this.video, performance.now());
    return (res.gestures || []).some((g) => g[0]?.categoryName === 'Thumb_Up' && g[0].score > 0.6);
  }

  // One downscaled JPEG, base64, in memory only.
  grabJpeg() {
    const v = this.video;
    const scale = Math.min(1, CONFIG.claude.frameMaxPx / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', CONFIG.claude.jpegQuality).split(',')[1];
  }

  // Full-res frame with an overlay, as a Blob (selfies stay on the phone).
  async grabSelfie(caption) {
    const v = this.video;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0);
    const pad = Math.round(c.width * 0.02);
    const fs = Math.round(c.width * 0.035);
    ctx.font = `bold ${fs}px "Courier New", monospace`;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, c.height - fs * 2.6, c.width, fs * 2.6);
    ctx.fillStyle = '#00dcff';
    ctx.fillText('EMBODIED AGENT v0.1 // SELFIE.EXE', pad, c.height - fs * 1.4);
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.round(fs * 0.7)}px "Courier New", monospace`;
    ctx.fillText(caption, pad, c.height - fs * 0.45);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  }
}
