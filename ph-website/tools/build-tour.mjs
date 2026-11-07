// node ph-website/tools/build-tour.mjs : generates snippets/ph-industry-enhancements/tour-telco.php from tour/telco.html.
// Angie snippets accept only flat .php/.css/.js files, so the tour page ships as a PHP file that returns its HTML byte for byte
// (a nowdoc: nothing is interpolated). tour/telco.html is the repo source and is not deployed. `--check` verifies without writing.
import fs from "fs";
const dir = new URL("../snippets/ph-industry-enhancements/", import.meta.url);
const html = fs.readFileSync(new URL("tour/telco.html", dir), "utf8");
if (/^PHTOUR/m.test(html)) { console.error("build-tour: a line of telco.html starts with PHTOUR; it would end the nowdoc early"); process.exit(1); }
const php = "<?php return <<<'PHTOUR'\n" + html + "\nPHTOUR;\n";
const out = new URL("tour-telco.php", dir);
if (process.argv.includes("--check")) {
  const same = fs.existsSync(out) && fs.readFileSync(out, "utf8") === php;
  console.log(same ? "build-tour: tour-telco.php is current" : "build-tour: tour-telco.php is stale; run node ph-website/tools/build-tour.mjs");
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(out, php);
console.log("build-tour: wrote tour-telco.php (" + Buffer.byteLength(php) + " bytes)");
