const fs = require("fs");
const path = require("path");

const apiUrl = process.env.VITE_API_URL || process.env.PUBLIC_API_URL || "";
const target = path.join(__dirname, "..", "config.js");

fs.writeFileSync(
  target,
  `window.CARNIVAL_LION_API_URL = ${JSON.stringify(apiUrl.replace(/\/$/, ""))};\n`,
  "utf8",
);

console.log(`Wrote config.js with API URL: ${apiUrl || "(same origin)"}`);
