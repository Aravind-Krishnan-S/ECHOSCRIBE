/* eval/run_router_sim.js — runs the E1 grid (5 conditions x 3 scenarios x 5 seeds) and writes
   eval/results/router_sim.json (every run) and router_sim_summary.json (mean and SD per cell). */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const conditions = ['nomemory', 'fixed60', 'priority', 'round-robin', 'lkgp'];
const scenarios = ['quota', 'outage', 'mixed'];
const seeds = [1, 2, 3, 4, 5];
const runs = [];
for (const scenario of scenarios) for (const condition of conditions) for (const seed of seeds) {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'router_sim.js'), condition, scenario, String(seed)], { encoding: 'utf8' });
    runs.push(JSON.parse(out.trim().split('\n').pop()));
}
const metrics = ['success_rate', 'calls_per_request', 'failed_calls_per_request', 'latency_p50_s', 'latency_p95_s', 'latency_mean_s', 'jain_fairness'];
const summary = [];
for (const scenario of scenarios) for (const condition of conditions) {
    const cell = runs.filter(r => r.scenario === scenario && r.condition === condition);
    const row = { scenario, condition, n: cell.length };
    for (const m of metrics) {
        const v = cell.map(r => r[m]);
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
        row[m] = { mean: +mean.toFixed(4), sd: +sd.toFixed(4) };
    }
    summary.push(row);
}
fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'results', 'router_sim.json'), JSON.stringify(runs, null, 1));
fs.writeFileSync(path.join(__dirname, 'results', 'router_sim_summary.json'), JSON.stringify(summary, null, 1));
console.log('scenario  condition     success   calls/req  failed/req  p95(s)   mean(s)  Jain');
for (const r of summary) {
    const f = (m, d = 3) => r[m].mean.toFixed(d);
    console.log(`${r.scenario.padEnd(9)} ${r.condition.padEnd(12)}  ${(r.success_rate.mean * 100).toFixed(2).padStart(6)}%  ${f('calls_per_request').padStart(8)}  ${f('failed_calls_per_request').padStart(9)}  ${f('latency_p95_s', 2).padStart(6)}  ${f('latency_mean_s', 2).padStart(6)}  ${f('jain_fairness')}`);
}
