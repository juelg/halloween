// Riddles for the guest page. Answers are stored only as SHA-256 hashes of the
// normalised answer; the phone checks them (see normalizeAnswer).
export const RIDDLES = [
  {
    "id": 0,
    "q": "I have keys but open no locks. I have space but no room. You can enter, but you can't go inside. What am I?",
    "h": [
      "91f060a9ad4b39eb228d9537292fab19d252faed06c169d0fdcb4a90560f5676",
      "ee4ed8b3c812514e6921028fdaa323d30a2df0a06526d210ac9777f4895bede8"
    ]
  },
  {
    "id": 1,
    "q": "There are 10 kinds of people: those who understand binary and those who don't. How many kinds is that, in decimal?",
    "h": [
      "3fc4ccfe745870e2c0d99f71f30ff0656c8dedd41cc1d7d3d376b0dbe685e2f3",
      "d4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35"
    ]
  },
  {
    "id": 2,
    "q": "I'm all you need, or so the 2017 paper claims. What am I?",
    "h": [
      "b171592fe6038258d244abdbed427e86f093bc529003597c6c31dbe5021782fc",
      "e0787d272a439bb74b762d96f1cef3d04a18328a8d900f5c13a6e925d9da681c"
    ]
  },
  {
    "id": 3,
    "q": "I memorized the whole training set and now I fail every test. What have I done?",
    "h": [
      "67e941d5fe52176717cbcee842533e4493582aa600a8a3e28f16eb6bea1e4e4e",
      "a1f32f577f69843e0c2e8a5af9c2e5c636fee5d6a48d601bc8b5acf8b417545a",
      "e3d4181db9c7b6d694ea004d99bdd884ed6171619951d7a2ce03231bcedb27a8",
      "f7b5f194f2833a73be459e0634cd47abdb3d18cf843faf5c8278e388634397e0"
    ]
  },
  {
    "id": 4,
    "q": "In JavaScript, what does 0.1 + 0.2 === 0.3 evaluate to?",
    "h": [
      "fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa"
    ]
  },
  {
    "id": 5,
    "q": "Learners chase me downhill, one small step at a time. What am I?",
    "h": [
      "1b6a3443f30a8adc08c12490d5b12cbe9a8590f6c76b73a15cdb3ac880eb7cc4",
      "2ea71c18131a7f0383294917672136b6d5beae857e6bacca02d99d83e5f7d371",
      "36200518ca7c15ba442112374b7f54cc6928a8a163e1076be421fa977893fe8b",
      "6005639506ef8763650b13c85aecc333e64e2a41839e324573659a6b2de6408e"
    ]
  },
  {
    "id": 6,
    "q": "Deep Thought took 7.5 million years to compute me. What am I?",
    "h": [
      "10a16d834f9b1e4068b25c4c46fe0284e99e44dceaf08098fc83925ba6310ff5",
      "73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049"
    ]
  },
  {
    "id": 7,
    "q": "What has a head and a tail, gets pushed and popped, but is never a coin?",
    "h": [
      "00b109cf1123a591253cc534b17e5268eb8fc2fbb7d6772de7a55c135ef1282f",
      "6ee08e6eb3bc6f45bc99fcd39fcc479286a1beb0c04d39f204c61762378075d6",
      "80624fc2d4f3d26bcdbc190a736fbb5fa9d4f9909e20a120050370dd641941b7",
      "a330395cc0a53ad1207736546afff4735940937564bbf75ce1edad40780d9139",
      "e93b27204f48c8bf4ab780aa48e4ffa0a117c783b8d8a2f6ce909c43bd2b3d83"
    ]
  }
];

export function normalizeAnswer(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/^(a|an|the) /, '')
    .replace(/\s+/g, '');
}
