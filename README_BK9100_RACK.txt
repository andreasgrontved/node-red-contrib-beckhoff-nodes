
# BK9100 Rack + runtime mapping

Files:
- `bk9100-rack.html`
- `bk9100-rack.js`
- `kl3208.patched.js`
- `kl3468.patched.js`
- `kl1808.patched.js`

Install:
1. Copy `bk9100-rack.html/js` into your nodes folder (e.g., `nodes/bk9100-rack.*`).
2. Replace your existing KL files with the `.patched.js` equivalents (or merge the "runtime mapping" blocks).
3. Add to `package.json` under `"node-red".nodes`:
   ```json
   "BK9100 Rack": "nodes/bk9100-rack.js"
   ```
4. Restart Node-RED.

Usage:
- Drop **BK9100 Rack** and add your cards in order. Set base address (usually `0`).
- Wire each rack output to the matching card node input.
- On deploy or any input, the rack outputs a config message:
  ```
  { payload:{command:"config", ...}, config:{modbus:{start,quantity,register,fc}, map:{startIndex,step}} }
  ```
- Card nodes now accept `msg.map` or `msg.config.map` to override `startIndex/step` at runtime.
