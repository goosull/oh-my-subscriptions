import { accounts, pick } from "./oms";
for (const a of accounts()) {
  const state = a.available ? "ok" : `HOLD  ${a.blocked ?? a.reason}`;
  const used = a.used_percent === undefined ? "" : `${a.used_percent.toFixed(0)}% used`;
  console.log(` ${a.name.padEnd(13)} ${a.vendor.padEnd(7)} ${used.padEnd(11)} ${state}`);
}
const p = pick();
console.log("\nnext turn would go to:", p ? `${p.name} (${p.bin} ${p.flags.join(" ")})` : "nothing safe");
