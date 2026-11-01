// Every tunable number lives here. Tweak at the party, not in the logic.
export const CONFIG = {
  // Mask geometry, measured on the real mask: full-face DIY images are 46 x 58
  // (an oval, column order); text/bitmaps are a 16-row band at eye level.
  mask: {
    width: 46, // text band width (about 38 columns are actually visible)
    height: 16, // the text/bitmap channel is always 16 rows
    bandTop: 21, // first face row the text band covers (simulator only)
    animFrameMs: 450, // animated faces flip between DIY slots this often
    textSpeed: 40, // SPEED byte for scrolling text
    scrollColsPerSec: 18, // used to estimate how long a scroll pass takes
    padUploadPackets: false, // official app pads to 100 bytes; mask-go doesn't
    uploadChunk: 98,
    ackTimeoutMs: 2500,
  },

  // When to react (crowded room).
  trigger: {
    detectFps: 5,
    detectFpsSaver: 2,
    minFaceWidth: 0.12, // fraction of frame width => "close" (~2 m or less)
    countFaceWidth: 0.06, // smaller faces still count for the selfie head-count
    maxCenterOffset: 0.25, // |cx - 0.5| must be below this
    holdMs: 1500, // close face must be held this long
    cooldownMs: 20000, // min gap after a reaction ends
    cooldownJitterMs: 25000, // + random 0..this, so we land at ~20–60 s
    sleepAfterMs: 60000, // nobody near this long => sleep
    minDetectionScore: 0.6,
  },

  // Covering the camera (talk mode / veto / cancel selfie).
  cover: {
    sampleMs: 200,
    maxMeanLuma: 22, // 0..255
    maxLumaStd: 10,
    holdMs: 1800,
  },

  idle: {
    minGapMs: 2500,
    maxGapMs: 7000,
    scanChance: 0.12,
  },

  claude: {
    reactModel: 'claude-haiku-5-5',
    gameModel: 'claude-sonnet-5-5',
    reactEffort: 'low',
    gameEffort: 'low',
    reactTimeoutMs: 15000,
    gameTimeoutMs: 30000,
    useFallbacks: true, // server-side refusal fallback on the Sonnet calls
    frameMaxPx: 512,
    jpegQuality: 0.7,
  },

  // Weighted routines. 'selfie' only enters the draw with >= 3 faces.
  routines: {
    rating: 3,
    detect: 2,
    hallucinate: 2,
    turing: 1,
    fortune: 2,
    mljoke: 2,
    crash: 0.4,
    selfie: 3,
  },
  selfieMinFaces: 3,
  selfieWaitMs: 12000,

  voice: { pitch: 0.4, rate: 1.0 },

  // Guest game (enforced on the phone; the relay is untrusted).
  game: {
    answerMinGapMs: 8000, // per guest
    answersPer15Min: 10, // per guest
    judgeCallsPerMin: 6, // global
    unlockCooldownMs: 15 * 60 * 1000, // one unlock per guest per 15 min
    ticketTtlMs: 5 * 60 * 1000,
    emoteQueueMax: 5,
    emoteShowMs: 10000,
    emoteGapMs: 8000,
    emoteWidth: 23, // guest pixel art, doubled to fill the 46 x 58 face
    emoteHeight: 29,
    maxRequestAgeMs: 2 * 60 * 1000,
    maxRequestsPerMin: 30, // global; anything beyond is dropped
  },

  relay: {
    thoughtsShown: 20,
    heartbeatMs: 60000,
    minThoughtGapMs: 3000,
  },
};
