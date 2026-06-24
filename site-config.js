/* =====================================================================
   site-config.js
   ---------------------------------------------------------------------
   Edit this file directly to change things about the site —
   game names, descriptions, links, the panic-key destination, etc.
   This is just a plain JS object, no login system attached to it.
   Anyone who can edit the files on disk can edit this; there is no
   real authentication layer on a static site like this one.
===================================================================== */

const SITE_CONFIG = {
  siteName: "Humaan Sciences",

  // Where Shift+Q sends you instantly, no matter what page you're on.
  panicRedirect: "index.html",

  games: [
    {
      id: "flagbearers",
      name: "Flagbearers",
      description: "3D capture-the-flag — ruins, bows, two teams.",
      path: "flagbearers/index.html",
      emoji: "🏹",
      theme: "t1"
    },
    {
      id: "2048",
      name: "2048",
      description: "Merge tiles to reach the number 2048.",
      path: "games/2048/index.html",
      emoji: "🔢",
      theme: "t2"
    },
    {
      id: "snake",
      name: "Snake",
      description: "Classic grid snake, speeds up as you grow.",
      path: "games/snake/index.html",
      emoji: "🐍",
      theme: "t3"
    },
    {
      id: "blocks",
      name: "Block Stacker",
      description: "Falling-block puzzle, clear lines to score.",
      path: "games/blocks/index.html",
      emoji: "🧩",
      theme: "t4"
    }
  ],

  // The 4-digit code on the front page.
  accessCode: "1121"
};
