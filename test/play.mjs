/* 生成可在浏览器真点的测试台 test/play.html（CDP 用，不进 git） */
import esbuild from "esbuild";
import fs from "node:fs";

await esbuild.build({
  entryPoints: ["test/play-entry.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "test/play.bundle.js",
  alias: { obsidian: "./test/obsidian-stub.ts" },
  logLevel: "error",
});

const css = fs.readFileSync("styles.css", "utf8");
fs.writeFileSync("test/play.html", `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#07070A}
  body{padding:16px}
  #host{width:1248px;height:768px;border-radius:12px;overflow:hidden;border:1px solid #26262E}
  ${css}
</style></head><body class="theme-dark"><div id="host"></div>
<script type="module" src="./play.bundle.js"></script></body></html>`);
console.log("wrote test/play.html");
