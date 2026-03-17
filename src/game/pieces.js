function cells(rows) {
  return rows.flatMap((row, y) =>
    [...row].flatMap((cell, x) => (cell === "X" ? [[x, y]] : []))
  );
}

export const PIECE_ORDER = ["I", "J", "L", "O", "S", "T", "Z"];

export const PIECES = {
  I: {
    color: "#67e8f9",
    rotations: [
      cells(["....", "XXXX", "....", "...."]),
      cells(["..X.", "..X.", "..X.", "..X."]),
      cells(["....", "....", "XXXX", "...."]),
      cells([".X..", ".X..", ".X..", ".X.."]),
    ],
  },
  J: {
    color: "#7c8eff",
    rotations: [
      cells(["X...", "XXX.", "....", "...."]),
      cells([".XX.", ".X..", ".X..", "...."]),
      cells(["....", "XXX.", "..X.", "...."]),
      cells([".X..", ".X..", "XX..", "...."]),
    ],
  },
  L: {
    color: "#ffad42",
    rotations: [
      cells(["..X.", "XXX.", "....", "...."]),
      cells([".X..", ".X..", ".XX.", "...."]),
      cells(["....", "XXX.", "X...", "...."]),
      cells(["XX..", ".X..", ".X..", "...."]),
    ],
  },
  O: {
    color: "#ffd54d",
    rotations: [
      cells([".XX.", ".XX.", "....", "...."]),
      cells([".XX.", ".XX.", "....", "...."]),
      cells([".XX.", ".XX.", "....", "...."]),
      cells([".XX.", ".XX.", "....", "...."]),
    ],
  },
  S: {
    color: "#70e27c",
    rotations: [
      cells([".XX.", "XX..", "....", "...."]),
      cells([".X..", ".XX.", "..X.", "...."]),
      cells(["....", ".XX.", "XX..", "...."]),
      cells(["X...", "XX..", ".X..", "...."]),
    ],
  },
  T: {
    color: "#c084fc",
    rotations: [
      cells([".X..", "XXX.", "....", "...."]),
      cells([".X..", ".XX.", ".X..", "...."]),
      cells(["....", "XXX.", ".X..", "...."]),
      cells([".X..", "XX..", ".X..", "...."]),
    ],
  },
  Z: {
    color: "#ff7c7c",
    rotations: [
      cells(["XX..", ".XX.", "....", "...."]),
      cells(["..X.", ".XX.", ".X..", "...."]),
      cells(["....", "XX..", ".XX.", "...."]),
      cells([".X..", "XX..", "X...", "...."]),
    ],
  },
};

const GENERIC_KICKS = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-1, -1],
  [1, -1],
  [0, -2],
  [-2, 0],
  [2, 0],
];

const I_KICKS = [
  [0, 0],
  [-2, 0],
  [2, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, -2],
];

export function getKickCandidates(type) {
  if (type === "O") {
    return [[0, 0]];
  }
  return type === "I" ? I_KICKS : GENERIC_KICKS;
}

export function createPiece(type) {
  return {
    type,
    rotation: 0,
    x: 3,
    y: 0,
  };
}

export function getPieceCells(type, rotation) {
  return PIECES[type].rotations[((rotation % 4) + 4) % 4];
}
